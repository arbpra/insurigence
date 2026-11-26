/**
 * Module 50: reporting lines, cover for absent Account Managers, and moving
 * agencies between Account Managers.
 *
 *   npx tsx script/verify-desk-supervision.ts
 *
 * Temporary people on test copies of the default positions, temporary
 * agencies, accounts, requests and documents. It checks:
 *  - who sets reporting lines (only someone who reaches every agency), loops,
 *    and that a line widens reach only for a "supervised" position, never
 *    opening Financial files or restricted requests by itself;
 *  - a Senior AM's reach: the agencies of everyone below them, a deactivated
 *    person's included, but not someone who no longer manages agencies;
 *  - cover: dates, overlap, who may arrange it, what it gives (the absent
 *    person's agencies, never what they supervise), notifications, ending
 *    early and ending by date, and work going back to the queue;
 *  - moving agencies: in reach only, to authorised Account Managers only,
 *    open work following, work someone can no longer reach going back;
 *  - agency setup offering Account Managers by position, not role;
 *  - the one-time grant of a permission added to the catalogue;
 *  - the sidebar, the routes and the audit log.
 *
 * Every temporary record is removed at the end.
 */
import 'dotenv/config';
import { NextRequest } from 'next/server';
import type { DeskAgencyReach, DeskDepartment, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, documentWhere, insuredWhere, resolveDeskScope, taskWhere, type DeskScope } from '../lib/desk/access';
import { DEFAULT_POSITIONS, PERMISSION_ADDITIONS, type PermissionKey } from '../lib/desk/permission-catalogue';
import { navAccess, navFor } from '../lib/desk/navigation';
import { applyPermissionAdditions } from '../lib/desk/positions';
import { arrangeCover, closeEndedCovers, endCover, getTeam, reassignAgency, setReportingLine } from '../lib/desk/supervision';
import { getAgencySetup, updateAgencySetup } from '../lib/desk/agency-setup';
import { notifyTaskCreated, setNotificationSender } from '../lib/desk/notifications';
import { runAlertCheck } from '../lib/desk/alerts';
import { deactivateStaff } from '../lib/desk/staff';
import { GET as teamRoute } from '../app/api/desk/admin/account-managers/route';
import { PUT as reportingRoute } from '../app/api/desk/admin/account-managers/reporting/route';
import { POST as coverRoute } from '../app/api/desk/admin/account-managers/covers/route';
import { DELETE as endCoverRoute } from '../app/api/desk/admin/account-managers/covers/[id]/route';
import { PUT as reassignRoute } from '../app/api/desk/admin/account-managers/agencies/[agencyId]/route';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail: unknown = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail !== '' ? `  ${JSON.stringify(detail)}` : ''}`);
};
const section = (s: string) => console.log(`\n${s}`);

const TAG = `m50test${Date.now()}`;
const CTX = { ip: '203.0.113.50', userAgent: 'verify-desk-supervision' };
const MARKER = `${TAG}-addition`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[] };
const now0 = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  const userId = { in: cleanup.userIds };
  const positions = (await prisma.deskPosition.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id);
  await prisma.taskDocument.deleteMany({ where: { agencyId } });
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  // The scheduled check records covers it closes with no actor or agency: removed by the cover.
  const covers = (await prisma.deskCoverage.findMany({ where: { OR: [{ absentUserId: userId }, { coverUserId: userId }] }, select: { id: true } })).map((c) => c.id);
  await prisma.deskAuditLog.deleteMany({ where: { entityType: 'DeskCoverage', entityId: { in: covers } } });
  await prisma.deskCoverage.deleteMany({ where: { OR: [{ absentUserId: userId }, { coverUserId: userId }] } });
  await prisma.deskReportingLine.deleteMany({ where: { OR: [{ userId }, { managerId: userId }] } });
  await prisma.deskPositionHolder.deleteMany({ where: { OR: [{ userId }, { positionId: { in: positions } }] } });
  await prisma.deskPosition.deleteMany({ where: { id: { in: positions } } });
  await prisma.deskJobRun.deleteMany({ where: { id: { in: [MARKER, `${TAG}-job`] } } });
  await prisma.deskNotification.deleteMany({ where: { OR: [{ agencyId }, { recipientId: userId }] } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: userId }, { entityId: userId }] } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { OR: [{ id: userId }, { email: { startsWith: TAG } }] } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

const status = async (fn: () => Promise<unknown>) => {
  try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; throw e; }
};
const agenciesOf = (s: DeskScope) => (s.kind === 'ACCOUNT_MANAGER' ? [...s.agencyIds].sort() : s.kind);

(async () => {
  try {
    const mkAgency = async (n: string) => {
      const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } });
      cleanup.agencyIds.push(a.id);
      return a;
    };
    const A = await mkAgency('Alpha'), B = await mkAgency('Beta'), C = await mkAgency('Cedar'), D = await mkAgency('Delta'), E = await mkAgency('Elm');

    const person = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, firstName: TAG, lastName: n, role, passwordHash: `secret-${TAG}`, mustChangePassword: false, isActive: true, agencyId } });
      cleanup.userIds.push(u.id);
      return u;
    };
    const ids = new Map<string, string>();
    for (const [i, d] of DEFAULT_POSITIONS.entries()) {
      const p = await prisma.deskPosition.create({ data: { code: `${TAG}_${d.code}`, name: `${TAG} ${d.name}`, department: d.department as DeskDepartment, reach: d.reach as DeskAgencyReach, permissions: [...d.permissions], sortOrder: 900 + i } });
      ids.set(d.code, p.id);
    }
    // Supervised reach, but none of the Senior AM's document or restriction permissions.
    const lite = await prisma.deskPosition.create({ data: { code: `${TAG}_LITE`, name: `${TAG} Lite supervisor`, department: 'AGENCY_OPERATIONS', reach: 'SUPERVISED', permissions: ['requests.work', 'accounts.view', 'team.manage'], sortOrder: 990 } });
    ids.set('LITE', lite.id);
    const hold = (userId: string, ...codes: string[]) => Promise.all(codes.map((c) => prisma.deskPositionHolder.create({ data: { userId, positionId: ids.get(c)! } })));

    const coo = await person('coo', 'DESK_ADMIN'); await hold(coo.id, 'COO');
    const dao = await person('dao', 'ACCOUNT_MANAGER'); await hold(dao.id, 'DIRECTOR_AGENCY_OPS');
    const dvo = await person('dvo', 'DESK_VA'); await hold(dvo.id, 'DIRECTOR_VIRTUAL_OPS');
    const senior = await person('senior', 'ACCOUNT_MANAGER'); await hold(senior.id, 'SENIOR_AM');
    const liteSup = await person('lite', 'ACCOUNT_MANAGER'); await hold(liteSup.id, 'LITE');
    const am1 = await person('am1', 'ACCOUNT_MANAGER'); await hold(am1.id, 'AM');
    const am2 = await person('am2', 'ACCOUNT_MANAGER'); await hold(am2.id, 'AM');
    const am3 = await person('am3', 'ACCOUNT_MANAGER'); await hold(am3.id, 'AM');
    const am4 = await person('am4', 'ACCOUNT_MANAGER'); await hold(am4.id, 'AM');
    const exAm = await person('exam', 'ACCOUNT_MANAGER'); await hold(exAm.id, 'VA'); // the role, but no position that manages agencies
    const va = await person('va', 'DESK_VA'); await hold(va.id, 'VA');
    const owner = await person('owner', 'ADMIN', A.id);
    const outsider = await person('outsider', 'ADMIN', null);

    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am1.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: B.id, primaryAmId: am2.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: C.id, primaryAmId: am3.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: D.id, primaryAmId: senior.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: E.id, primaryAmId: am4.id } });

    const accA = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Acme`, nameKey: `${TAG} acme` } });
    let n = 0;
    const now = Date.now();
    const mkTask = (agencyId: string, amId: string, title: string, data: Partial<Prisma.TaskUncheckedCreateInput> = {}) => {
      n += 1;
      return prisma.task.create({ data: {
        reference: 950_000_000 + (now % 29_000_000) + n, agencyId, type: 'DOCUMENT_UPLOAD', title: `${TAG} ${title}`, amId,
        createdById: owner.id, restrictedToUserIds: [], status: 'NEW', source: 'AGENCY', ...data,
      } });
    };
    const tA = await mkTask(A.id, am1.id, 'Alpha work', { insuredId: accA.id });
    const tRestricted = await mkTask(A.id, am1.id, 'Alpha restricted', { restrictedToUserIds: [va.id], restrictionReason: 'Litigation' });
    const finDoc = await prisma.taskDocument.create({ data: { taskId: tA.id, agencyId: A.id, storageKey: `desk/${TAG}/fin`, fileName: 'fin.pdf', fileSize: 1000, contentType: 'application/pdf', visibility: 'INTERNAL', sensitivity: 'FINANCIAL', uploadedById: am1.id } });

    const scope = (id: string) => resolveDeskScope(prisma, id);
    const S = {
      coo: await scope(coo.id), dao: await scope(dao.id), dvo: await scope(dvo.id), senior: await scope(senior.id),
      am1: await scope(am1.id), va: await scope(va.id),
    };
    const denials = () => prisma.deskAuditLog.count({ where: { action: 'access.denied', actorId: { in: cleanup.userIds } } });

    section('Reporting lines: who sets them');
    {
      const before = await denials();
      ok('a Senior AM can\'t set reporting lines (it would widen their own reach)', await status(() => setReportingLine(prisma, S.senior, am3.id, senior.id, CTX)) === 403);
      ok('…nor can someone without the permission', await status(() => setReportingLine(prisma, S.dvo, am1.id, senior.id, CTX)) === 403);
      ok('…nor an Account Manager', await status(() => setReportingLine(prisma, S.am1, am3.id, am1.id, CTX)) === 403);
      ok('…and each refusal is logged', (await denials()) - before === 3, (await denials()) - before);
      ok('the Director of Agency Operations sets one', await status(() => setReportingLine(prisma, S.dao, am1.id, senior.id, CTX)) === 200);
      ok('…recorded in the audit log', await prisma.deskAuditLog.count({ where: { action: 'staff.reporting_line_changed', entityId: am1.id, actorId: dao.id } }) === 1);
      await setReportingLine(prisma, S.dao, am2.id, am1.id, CTX); // further down: am2 → am1 → senior
      ok('nobody changes who they report to themselves', await status(() => setReportingLine(prisma, S.dao, dao.id, coo.id, CTX)) === 403);
      ok('no loops, however far up', await status(() => setReportingLine(prisma, S.dao, senior.id, am2.id, CTX)) === 400);
      ok('nobody reports to themselves', await status(() => setReportingLine(prisma, S.dao, am3.id, am3.id, CTX)) === 400);
      ok('only Desk staff: an agency user is not found', await status(() => setReportingLine(prisma, S.dao, owner.id, senior.id, CTX)) === 404);
      ok('…and can\'t be a manager', await status(() => setReportingLine(prisma, S.dao, am3.id, owner.id, CTX)) === 400);
    }

    section('A Senior AM reaches the agencies of everyone below them');
    {
      S.senior = await scope(senior.id);
      ok('their own agency, and the agencies of the AM who reports to them and of the one further down', JSON.stringify(agenciesOf(S.senior)) === JSON.stringify([A.id, B.id, D.id].sort()), agenciesOf(S.senior));
      ok('not another team\'s agency', !agenciesOf(S.senior).includes(C.id));
      const am1Now = await scope(am1.id);
      ok('an Account Manager gains nothing from someone reporting to them (assigned reach)', JSON.stringify(agenciesOf(am1Now)) === JSON.stringify([A.id]), agenciesOf(am1Now));
      ok('they see the requests of their team\'s agencies', await prisma.task.count({ where: { AND: [{ id: tA.id }, taskWhere(S.senior)] } }) === 1);
      ok('…and open the accounts', await prisma.insuredAccount.count({ where: { AND: [{ id: accA.id }, insuredWhere(S.senior)] } }) === 1);

      await setReportingLine(prisma, S.dao, am1.id, liteSup.id, CTX);
      const L = await scope(liteSup.id);
      ok('a supervised position without document permissions: the agency\'s requests…', await prisma.task.count({ where: { AND: [{ id: tA.id }, taskWhere(L)] } }) === 1, agenciesOf(L));
      ok('…but not a Financial file: a reporting line opens no sensitive document', await prisma.taskDocument.count({ where: { AND: [{ id: finDoc.id }, documentWhere(L)] } }) === 0);
      ok('…nor a request restricted to someone else', await prisma.task.count({ where: { AND: [{ id: tRestricted.id }, taskWhere(L)] } }) === 0);
      await setReportingLine(prisma, S.dao, am1.id, senior.id, CTX);
      S.senior = await scope(senior.id);
      ok('back under the Senior AM, the lite supervisor loses the agency at once', !agenciesOf(await scope(liteSup.id)).includes(A.id));

      // Someone below who no longer manages agencies: their agency drops out.
      await setReportingLine(prisma, S.dao, exAm.id, senior.id, CTX);
      await prisma.agencyDeskAssignment.update({ where: { agencyId: E.id }, data: { backupAmId: exAm.id } });
      ok('someone below whose position doesn\'t manage agencies adds nothing', !agenciesOf(await scope(senior.id)).includes(E.id));
      await prisma.agencyDeskAssignment.update({ where: { agencyId: E.id }, data: { backupAmId: null } });

      // A deactivated AM's agencies stay in reach, so they can be reassigned.
      await setReportingLine(prisma, S.dao, am4.id, senior.id, CTX);
      await deactivateStaff(prisma, S.coo, am4.id, CTX);
      ok('a deactivated Account Manager\'s agency stays in their supervisor\'s reach, to be reassigned', agenciesOf(await scope(senior.id)).includes(E.id));
    }

    section('Removing a reporting line');
    {
      const held = await mkTask(B.id, am2.id, 'Beta held by the senior', { assigneeId: senior.id, status: 'IN_PROGRESS' });
      const r = await setReportingLine(prisma, S.dao, am2.id, null, CTX);
      S.senior = await scope(senior.id);
      ok('the Senior AM loses that agency at once', !agenciesOf(S.senior).includes(B.id));
      const after = await prisma.task.findUnique({ where: { id: held.id } });
      ok('…and their open work there goes back to the queue', r.tasksReturned === 1 && after?.assigneeId === null && after?.status === 'NEW', { r, after: after?.status });
      await setReportingLine(prisma, S.dao, am2.id, am1.id, CTX);
      S.senior = await scope(senior.id);
    }

    section('Cover: who may arrange it, and the dates');
    {
      const later = new Date(Date.now() + 3 * DAY).toISOString();
      const before = await denials();
      ok('a Senior AM can\'t arrange cover for someone outside their team', await status(() => arrangeCover(prisma, S.senior, { absentUserId: am3.id, coverUserId: am2.id, endsAt: later }, CTX)) === 403);
      ok('…or name someone outside it to cover', await status(() => arrangeCover(prisma, S.senior, { absentUserId: am1.id, coverUserId: am3.id, endsAt: later }, CTX)) === 403);
      ok('an Account Manager can\'t arrange cover', await status(() => arrangeCover(prisma, S.am1, { absentUserId: am1.id, coverUserId: am2.id, endsAt: later }, CTX)) === 403);
      ok('…each refusal logged', (await denials()) - before === 3, (await denials()) - before);
      ok('only an authorised Account Manager can cover', await status(() => arrangeCover(prisma, S.dao, { absentUserId: am1.id, coverUserId: va.id, endsAt: later }, CTX)) === 400);
      ok('…and someone with the role but no such position can\'t', await status(() => arrangeCover(prisma, S.dao, { absentUserId: am1.id, coverUserId: exAm.id, endsAt: later }, CTX)) === 400);
      ok('nobody covers themselves', await status(() => arrangeCover(prisma, S.dao, { absentUserId: am1.id, coverUserId: am1.id, endsAt: later }, CTX)) === 400);
      ok('the end must come after the start', await status(() => arrangeCover(prisma, S.dao, { absentUserId: am1.id, coverUserId: am2.id, startsAt: later, endsAt: new Date(Date.now() + DAY).toISOString() }, CTX)) === 400);
      ok('…and in the future', await status(() => arrangeCover(prisma, S.dao, { absentUserId: am1.id, coverUserId: am2.id, startsAt: new Date(Date.now() - 2 * DAY).toISOString(), endsAt: new Date(Date.now() - DAY).toISOString() }, CTX)) === 400);
      ok('at most 180 days', await status(() => arrangeCover(prisma, S.dao, { absentUserId: am1.id, coverUserId: am2.id, endsAt: new Date(Date.now() + 181 * DAY).toISOString() }, CTX)) === 400);
      ok('a note can\'t hold a password', await status(() => arrangeCover(prisma, S.dao, { absentUserId: am1.id, coverUserId: am2.id, endsAt: later, note: 'AMS password: hunter2' }, CTX)) === 400);
      ok('a date must be a date', await status(() => arrangeCover(prisma, S.dao, { absentUserId: am1.id, coverUserId: am2.id, endsAt: 'next week' }, CTX)) === 400);
    }

    section('Cover: what it gives');
    {
      ok('before the cover, the AM covering doesn\'t reach the agency', !agenciesOf(await scope(am2.id)).includes(A.id));
      // Upcoming cover gives nothing yet.
      const upcoming = await arrangeCover(prisma, S.senior, { absentUserId: am1.id, coverUserId: am2.id, startsAt: new Date(Date.now() + 5 * DAY).toISOString(), endsAt: new Date(Date.now() + 6 * DAY).toISOString() }, CTX);
      ok('a cover that hasn\'t started gives nothing yet', !agenciesOf(await scope(am2.id)).includes(A.id));
      ok('a second cover overlapping it is refused', await status(() => arrangeCover(prisma, S.senior, { absentUserId: am1.id, coverUserId: am2.id, startsAt: new Date(Date.now() + 5.5 * DAY).toISOString(), endsAt: new Date(Date.now() + 7 * DAY).toISOString() }, CTX)) === 409);
      ok('…and so is a cover by someone who is away then', await status(() => arrangeCover(prisma, S.senior, { absentUserId: am2.id, coverUserId: am1.id, startsAt: new Date(Date.now() + 5.5 * DAY).toISOString(), endsAt: new Date(Date.now() + 7 * DAY).toISOString() }, CTX)) === 409);
      ok('cancelling one not started', await status(() => endCover(prisma, S.senior, upcoming.id, CTX)) === 200);

      const running = await arrangeCover(prisma, S.senior, { absentUserId: am1.id, coverUserId: am2.id, endsAt: new Date(Date.now() + 2 * DAY).toISOString(), note: 'Annual leave' }, CTX);
      ok('a running cover is in the audit log', await prisma.deskAuditLog.count({ where: { action: 'coverage.arranged', entityId: running.id } }) === 1);
      const covering = await scope(am2.id);
      ok('while it runs, the cover reaches the absent AM\'s agency', agenciesOf(covering).includes(A.id) && agenciesOf(covering).includes(B.id), agenciesOf(covering));
      ok('…and its requests, with their own permissions', await prisma.task.count({ where: { AND: [{ id: tA.id }, taskWhere(covering)] } }) === 1);
      ok('the absent AM keeps theirs', agenciesOf(await scope(am1.id)).includes(A.id));

      // Told what the absent AM would be told.
      const sent: string[] = [];
      process.env.DESK_EMAIL_NOTIFICATIONS = 'on';
      setNotificationSender(async (m) => { sent.push(String(m.to)); return { ok: true, id: 'test' }; });
      try {
        await notifyTaskCreated(prisma, tA, owner.id);
      } finally {
        setNotificationSender(null);
        process.env.DESK_EMAIL_NOTIFICATIONS = 'off';
      }
      ok('a new request for the absent AM\'s agency is sent to them and to the cover', sent.includes(am1.email) && sent.includes(am2.email) && sent.length === 2, sent);

      // Covering the Senior AM gives their own agency, never what they supervise.
      const seniorCover = await arrangeCover(prisma, S.dao, { absentUserId: senior.id, coverUserId: am3.id, endsAt: new Date(Date.now() + DAY).toISOString() }, CTX);
      const am3Now = await scope(am3.id);
      ok('covering a Senior AM gives their own agency, not their team\'s', agenciesOf(am3Now).includes(D.id) && !agenciesOf(am3Now).includes(A.id) && !agenciesOf(am3Now).includes(B.id), agenciesOf(am3Now));
      await endCover(prisma, S.dao, seniorCover.id, CTX);

      // Ending early: the cover's work there goes back to the queue.
      const coverWork = await mkTask(A.id, am1.id, 'Alpha, picked up by the cover', { assigneeId: am2.id, status: 'IN_PROGRESS' });
      ok('an Account Manager can\'t end a cover', await status(() => endCover(prisma, S.am1, running.id, CTX)) === 403);
      const senior2 = await person('senior2', 'ACCOUNT_MANAGER'); await hold(senior2.id, 'SENIOR_AM');
      ok('…nor the Senior AM of another team (not found)', await status(async () => endCover(prisma, await scope(senior2.id), running.id, CTX)) === 404);
      const ended = await endCover(prisma, S.senior, running.id, CTX);
      const back = await prisma.task.findUnique({ where: { id: coverWork.id } });
      ok('ended early: the cover loses the agency at once', !agenciesOf(await scope(am2.id)).includes(A.id));
      ok('…and their open work there goes back to the queue', ended.tasksReturned === 1 && back?.assigneeId === null && back?.status === 'NEW', { ended, status: back?.status });
      ok('…recorded', await prisma.deskAuditLog.count({ where: { action: 'coverage.ended', entityId: running.id } }) === 1);
      ok('ending it again: not found', await status(() => endCover(prisma, S.senior, running.id, CTX)) === 404);
    }

    section('Cover ends by itself on its date');
    {
      // One that ended an hour ago and was never closed (as if the server was down).
      const old = await prisma.deskCoverage.create({ data: { absentUserId: am1.id, coverUserId: am2.id, startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() - HOUR), createdById: dao.id, endedAt: null } });
      const stale = await mkTask(A.id, am1.id, 'Alpha, left with the cover', { assigneeId: am2.id, status: 'ASSIGNED' });
      ok('after its end date it gives nothing, even before it is closed', !agenciesOf(await scope(am2.id)).includes(A.id));
      const test = await runAlertCheck(prisma, { now: new Date(), jobId: `${TAG}-job` });
      ok('a test run of the scheduled check leaves real covers alone', !(await prisma.deskCoverage.findUnique({ where: { id: old.id } }))?.endedAt, test);
      await runAlertCheck(prisma); // the real check, with emails off: it only closes ended covers
      const closed = await prisma.deskCoverage.findUnique({ where: { id: old.id } });
      const task = await prisma.task.findUnique({ where: { id: stale.id } });
      ok('the scheduled check closes it, at its end date', closed?.endedAt?.getTime() === closed?.endsAt.getTime(), closed?.endedAt);
      ok('…and the cover\'s open work there goes back to the queue', task?.assigneeId === null && task?.status === 'NEW', task?.status);
      ok('…recorded as automatic', await prisma.deskAuditLog.count({ where: { action: 'coverage.ended', entityId: old.id, actorId: null } }) === 1);
      ok('closing again does nothing', (await closeEndedCovers(prisma)) === 0);
    }

    section('Moving agencies between Account Managers');
    {
      const moved = await mkTask(A.id, am1.id, 'Alpha, worked by its AM', { assigneeId: am1.id, status: 'IN_PROGRESS' });
      const version = (await prisma.agency.findUnique({ where: { id: A.id } }))!.updatedAt.toISOString();
      const before = await denials();
      ok('a Senior AM can\'t move another team\'s agency: not found', await status(() => reassignAgency(prisma, S.senior, C.id, { primaryAmId: am2.id }, CTX)) === 404);
      ok('…or move one of theirs to someone outside the team', await status(() => reassignAgency(prisma, S.senior, A.id, { primaryAmId: am3.id }, CTX)) === 403);
      ok('…both logged', (await denials()) - before === 2, (await denials()) - before);
      ok('only to an authorised Account Manager', await status(() => reassignAgency(prisma, S.senior, A.id, { primaryAmId: va.id }, CTX)) === 400);
      ok('an agency needs a primary', await status(() => reassignAgency(prisma, S.senior, A.id, { primaryAmId: null }, CTX)) === 400);
      ok('primary and backup must differ', await status(() => reassignAgency(prisma, S.senior, A.id, { primaryAmId: am2.id, backupAmId: am2.id }, CTX)) === 400);
      ok('someone else saved first: refused', await status(() => reassignAgency(prisma, S.senior, A.id, { primaryAmId: am2.id, version: '2000-01-01T00:00:00.000Z' }, CTX)) === 409);
      const r = await reassignAgency(prisma, S.senior, A.id, { primaryAmId: am2.id, version }, CTX);
      const after = await prisma.task.findUnique({ where: { id: moved.id } });
      const assignment = await prisma.agencyDeskAssignment.findUnique({ where: { agencyId: A.id } });
      ok('a Senior AM moves their team\'s agency to another AM in it', assignment?.primaryAmId === am2.id, assignment);
      ok('…open requests follow the new Account Manager', r.openTasksMoved >= 1 && after?.amId === am2.id, r);
      ok('…the old AM loses the agency at once', !agenciesOf(await scope(am1.id)).includes(A.id) && agenciesOf(await scope(am2.id)).includes(A.id));
      ok('…and their open work there goes back to the queue', after?.assigneeId === null && after?.status === 'NEW', after?.status);
      ok('…recorded', await prisma.deskAuditLog.count({ where: { action: 'agency.am_reassigned', entityId: A.id, actorId: senior.id } }) === 1);
      ok('the Director of Agency Operations moves any agency', await status(() => reassignAgency(prisma, S.dao, C.id, { primaryAmId: am1.id, backupAmId: am3.id }, CTX)) === 200);
      ok('…and the Senior AM now reaches it, through the AM below them', agenciesOf(await scope(senior.id)).includes(C.id));
      ok('nothing to change: nothing changes', JSON.stringify(await reassignAgency(prisma, S.dao, C.id, { primaryAmId: am1.id }, CTX)) === JSON.stringify({ openTasksMoved: 0, stillAssigned: 0 }));
      await reassignAgency(prisma, S.dao, A.id, { primaryAmId: am1.id }, CTX);
      await reassignAgency(prisma, S.dao, C.id, { primaryAmId: am3.id, backupAmId: null }, CTX);
    }

    section('Agency setup offers Account Managers by position, not role');
    {
      const setup = await getAgencySetup(prisma, S.dao, A.id);
      const offered = setup.options.accountManagers.map((m) => m.id);
      ok('the Senior AM is offered (their position manages agencies)', offered.includes(senior.id));
      ok('someone with the Account Manager role but no such position is not', !offered.includes(exAm.id));
      ok('…and can\'t be chosen', await status(() => updateAgencySetup(prisma, S.dao, B.id, { backupAmId: exAm.id }, CTX)) === 400);
    }

    section('The page');
    {
      const seniorTeam = await getTeam(prisma, S.senior, CTX);
      const names = seniorTeam.managers.map((m) => m.id);
      ok('a Senior AM sees themselves and the AMs below them, not another team', names.includes(senior.id) && names.includes(am1.id) && names.includes(am2.id) && !names.includes(am3.id), names.length);
      ok('…their team\'s agencies, a deactivated AM\'s included, not another team\'s', seniorTeam.agencies.some((a) => a.id === E.id) && seniorTeam.agencies.some((a) => a.id === B.id) && !seniorTeam.agencies.some((a) => a.id === C.id));
      ok('…and no one to choose as a manager, since they can\'t set reporting lines', !seniorTeam.everyAgency && seniorTeam.possibleManagers.length === 0);
      const daoTeam = await getTeam(prisma, S.dao, CTX);
      ok('the Director of Agency Operations sees every Account Manager, and sets reporting lines', daoTeam.everyAgency && daoTeam.managers.some((m) => m.id === am3.id) && daoTeam.possibleManagers.some((m) => m.id === senior.id));
      ok('who reports to whom is shown', daoTeam.managers.find((m) => m.id === am2.id)?.reportsTo?.id === am1.id);
      ok('an Account Manager is refused the page', await status(() => getTeam(prisma, S.am1, CTX)) === 403);
      const has = (s: DeskScope) => navFor('OPS', navAccess(s)).some((i) => i.href === '/desk-ops/account-managers');
      ok('in the sidebar for the COO, the Director of Agency Operations and the Senior AM', has(S.coo) && has(S.dao) && has(S.senior));
      ok('…not for an Account Manager, a VA or the Director of Virtual Operations', !has(S.am1) && !has(S.va) && !has(S.dvo));
    }

    section('The routes');
    {
      const tok = (u: { id: string }) => createSession(u.id);
      const req = (path: string, method: string, token: string | null, body?: unknown) => new NextRequest(`http://localhost${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { cookie: `session_token=${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const [tSenior, tAm, tOutsider, tDao] = await Promise.all([tok(senior), tok(am1), tok(outsider), tok(dao)]);
      ok('not signed in: 401', (await teamRoute(req('/api/desk/admin/account-managers', 'GET', null))).status === 401);
      ok('an agency user: 403', (await teamRoute(req('/api/desk/admin/account-managers', 'GET', tOutsider))).status === 403);
      ok('an Account Manager: 403', (await teamRoute(req('/api/desk/admin/account-managers', 'GET', tAm))).status === 403);
      const page = await teamRoute(req('/api/desk/admin/account-managers', 'GET', tSenior));
      ok('the Senior AM: 200', page.status === 200);
      ok('a Senior AM setting a reporting line: 403', (await reportingRoute(req('/api/desk/admin/account-managers/reporting', 'PUT', tSenior, { userId: am3.id, managerId: senior.id }))).status === 403);
      ok('a bad body: 400', (await reportingRoute(req('/api/desk/admin/account-managers/reporting', 'PUT', tDao, { userId: am3.id }))).status === 400);
      const made = await coverRoute(req('/api/desk/admin/account-managers/covers', 'POST', tSenior, { absentUserId: am1.id, coverUserId: am2.id, endsAt: new Date(Date.now() + DAY).toISOString() }));
      const madeId = (await made.json()).id;
      ok('arranging cover: 201', made.status === 201);
      ok('ending it: 200', (await endCoverRoute(req(`/api/desk/admin/account-managers/covers/${madeId}`, 'DELETE', tSenior), { params: Promise.resolve({ id: madeId }) })).status === 200);
      ok('moving an agency out of reach: 404', (await reassignRoute(req(`/api/desk/admin/account-managers/agencies/${C.id}`, 'PUT', tSenior, { primaryAmId: am2.id }), { params: Promise.resolve({ agencyId: C.id }) })).status === 404);
      ok('moving one in reach: 200', (await reassignRoute(req(`/api/desk/admin/account-managers/agencies/${B.id}`, 'PUT', tSenior, { primaryAmId: am2.id, backupAmId: am1.id }), { params: Promise.resolve({ agencyId: B.id }) })).status === 200);
    }

    section('A permission added to the catalogue, given once');
    {
      ok('team.manage is given to the COO, the Director of Agency Operations and the Senior AM', JSON.stringify(PERMISSION_ADDITIONS.find((a) => a.key === 'team.manage')?.codes) === JSON.stringify(['COO', 'DIRECTOR_AGENCY_OPS', 'SENIOR_AM']));
      const sys = await prisma.deskPosition.create({ data: { code: `${TAG}_SYS`, name: `${TAG} System`, department: 'AGENCY_OPERATIONS', reach: 'ASSIGNED', permissions: ['requests.work'], isSystem: true, sortOrder: 995 } });
      const own = await prisma.deskPosition.create({ data: { code: `${TAG}_OWN`, name: `${TAG} Made by hand`, department: 'AGENCY_OPERATIONS', reach: 'ASSIGNED', permissions: ['requests.work'], isSystem: false, sortOrder: 996 } });
      const add = [{ key: 'audit.view' as PermissionKey, module: 50, codes: [sys.code, own.code], marker: MARKER }];
      const first = await applyPermissionAdditions(prisma, add);
      const perms = async (id: string) => (await prisma.deskPosition.findUnique({ where: { id } }))!.permissions;
      ok('given to the default position listed', (await perms(sys.id)).includes('audit.view'), first);
      ok('…not to a position the Super Admin made, even with the same code listed', !(await perms(own.id)).includes('audit.view'));
      await prisma.deskPosition.update({ where: { id: sys.id }, data: { permissions: ['requests.work'] } });
      const second = await applyPermissionAdditions(prisma, add);
      ok('once only: taken away by the Super Admin, the next seed doesn\'t give it back', !(await perms(sys.id)).includes('audit.view') && second.length === 0, second);
    }
  } catch (e) {
    fail++;
    console.error(e);
  } finally {
    await wipe();
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } })
      + await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } })
      + await prisma.deskPosition.count({ where: { code: { startsWith: TAG } } })
      + await prisma.deskCoverage.count({ where: { OR: [{ absentUserId: { in: cleanup.userIds } }, { coverUserId: { in: cleanup.userIds } }] } })
      + await prisma.deskReportingLine.count({ where: { OR: [{ userId: { in: cleanup.userIds } }, { managerId: { in: cleanup.userIds } }] } })
      + await prisma.deskJobRun.count({ where: { id: { in: [MARKER, `${TAG}-job`] } } })
      + await prisma.deskAuditLog.count({ where: { OR: [{ actorId: { in: cleanup.userIds } }, { agencyId: { in: cleanup.agencyIds } }, { entityId: { in: cleanup.userIds } }] } })
      + await prisma.deskAuditLog.count({ where: { entityType: 'DeskCoverage', actorId: null, createdAt: { gte: new Date(now0) } } })
      + await prisma.deskNotification.count({ where: { recipientId: { in: cleanup.userIds } } });
    ok('temporary records removed, audit entries included', left === 0, left);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
