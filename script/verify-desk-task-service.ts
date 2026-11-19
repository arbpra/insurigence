/**
 * The Desk, Module 12: task service layer.
 *
 * Creates tasks through lib/desk/tasks.ts as real users and checks routing,
 * AM attachment, service-level targets (including an agency agreement and
 * an expiration-anchored renewal), billing defaults, validation, then the
 * whole status lifecycle, assignment rules, notes, the agency view, the
 * timeline and audit entries, and concurrent changes. Uses the seeded pods
 * and routing rules, with temporary agencies, users and memberships.
 * Run with:  npx tsx script/verify-desk-task-service.ts
 */
import 'dotenv/config';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { resolveDeskScope, DeskAccessError } from '../lib/desk/access';
import {
  createTask, changeTaskStatus, assignTask, addTaskNote, agencyTaskView, agencyStatus, canTransition, STATUS_LABELS,
} from '../lib/desk/tasks';
import { addBusinessHours, addBusinessDays, expirationWindow, loadBusinessCalendar } from '../lib/desk/business-time';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const status = async (fn: () => Promise<unknown>) => {
  try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; console.error(e); return 500; }
};

const TAG = `m12test-${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[] };

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.serviceLevelTarget.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { agencyId } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.podMember.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

(async () => {
  try {
    // ── Fixture ──
    const pod = async (code: string) => (await prisma.pod.findUniqueOrThrow({ where: { code } })).id;
    const SERVICE = await pod('SERVICE_AMS'), RENEWALS = await pod('RENEWALS');
    const mkAgency = async (n: string) => {
      const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } });
      cleanup.agencyIds.push(a.id); return a;
    };
    const A = await mkAgency('A'), B = await mkAgency('B');
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId } });
      cleanup.userIds.push(u.id); return u;
    };
    const adminA = await mkUser('admin-a', 'ADMIN', A.id);
    const producerA = await mkUser('producer-a', 'AGENT', A.id);
    const adminB = await mkUser('admin-b', 'ADMIN', B.id);
    const amA = await mkUser('am-a', 'ACCOUNT_MANAGER');
    const amB = await mkUser('am-b', 'ACCOUNT_MANAGER');
    const va1 = await mkUser('va1', 'DESK_VA');
    const va2 = await mkUser('va2', 'DESK_VA');
    const vaRenewals = await mkUser('va-renewals', 'DESK_VA');
    await prisma.podMember.createMany({ data: [
      { podId: SERVICE, userId: va1.id }, { podId: SERVICE, userId: va2.id }, { podId: RENEWALS, userId: vaRenewals.id },
    ] });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: SERVICE } }); // A: Pod 1 only
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: amA.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: B.id, backupAmId: amB.id } }); // B: backup only

    const iA = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: 'Acme', nameKey: 'acme' } });
    const iOther = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: 'Other', nameKey: 'other' } });
    await prisma.insuredAssignment.create({ data: { agencyId: A.id, insuredId: iA.id, userId: producerA.id, role: 'PRODUCER' } });
    const pRenew = await prisma.policy.create({ data: { agencyId: A.id, insuredId: iA.id, policyNumber: 'GL-1', expirationDate: new Date('2027-03-01T00:00:00Z') } });
    // A's own agreement: standard endorsements in 1 business day (Desk default is 2).
    await prisma.serviceLevelTarget.create({ data: { taskType: 'ENDORSEMENT', complexity: 'STANDARD', agencyId: A.id, kind: 'BUSINESS_TIME', businessDays: 1 } });

    const S = async (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const sAdminA = await S(adminA), sProd = await S(producerA), sAdminB = await S(adminB);
    const sAmA = await S(amA), sAmB = await S(amB), sVa1 = await S(va1), sVa2 = await S(va2);
    const cal = await loadBusinessCalendar(prisma);
    const reload = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
    const events = async (taskId: string) => prisma.taskEvent.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } });

    console.log('\n━━ Status rules ━━');
    ok('agency view: New / Assigned → Received; Waiting on agency → Needs your attention; carrier, insured, QA → In progress',
      agencyStatus('NEW') === 'RECEIVED' && agencyStatus('ASSIGNED') === 'RECEIVED' && agencyStatus('WAITING_ON_AGENCY') === 'NEEDS_ATTENTION' &&
      ['IN_PROGRESS', 'WAITING_ON_CARRIER', 'WAITING_ON_INSURED', 'QA_REVIEW'].every((s) => agencyStatus(s as any) === 'IN_PROGRESS') &&
      agencyStatus('COMPLETED') === 'COMPLETED' && agencyStatus('CANCELLED') === 'CANCELLED');
    ok('every internal status has a label', Object.keys(STATUS_LABELS).length === 9);
    ok('allowed: In progress → QA → Completed; Completed → reopen', canTransition('IN_PROGRESS', 'QA_REVIEW') && canTransition('QA_REVIEW', 'COMPLETED') && canTransition('COMPLETED', 'IN_PROGRESS'));
    ok('not allowed: New → Completed, Completed → Cancelled, Waiting → QA',
      !canTransition('NEW', 'COMPLETED') && !canTransition('COMPLETED', 'CANCELLED') && !canTransition('WAITING_ON_CARRIER', 'QA_REVIEW'));

    console.log('\n━━ Creating requests ━━');
    const coi = await createTask(prisma, sProd, { type: 'COI', title: '  COI for Acme job site  ', insuredId: iA.id }, { ip: '198.51.100.7' });
    ok('a Producer files a COI for their account', coi.agencyId === A.id && coi.insuredId === iA.id && coi.title === 'COI for Acme job site');
    ok('starts New, from the agency, with the creator recorded', coi.status === 'NEW' && coi.source === 'AGENCY' && coi.createdById === producerA.id);
    ok('routed automatically to Pod 1 (Service & AMS)', coi.podId === SERVICE);
    ok('the agency\'s primary AM is attached', coi.amId === amA.id);
    ok('standard COI target: due 4 business hours after filing',
      !!coi.dueAt && coi.dueAt.getTime() === addBusinessHours(new Date((coi.slaTarget as any).appliedAt), 4, cal).getTime() && coi.slaDueAt?.getTime() === coi.dueAt.getTime());
    ok('the target is copied onto the task (so later edits never change it)', (coi.slaTarget as any)?.businessHours === 4 && !!(coi.slaTarget as any)?.targetId);
    ok('billing defaults: COI category, billable, 1 unit', coi.serviceCategory === 'COI' && !coi.nonBillable && coi.billableUnits === 1);
    ok('starts unrestricted and unassigned', coi.restrictedToUserIds.length === 0 && !coi.assigneeId);
    {
      const ev = await events(coi.id);
      ok('timeline: "created" (agency can see) and "routed" (internal)',
        ev.length === 2 && ev[0].kind === 'CREATED' && ev[0].visibility === 'AGENCY' && ev[1].kind === 'ROUTED' && ev[1].visibility === 'INTERNAL');
      const audit = await prisma.deskAuditLog.findFirst({ where: { entityId: coi.id, action: 'task.created' } });
      ok('audit entry with who, where from, and what was decided',
        !!audit && audit.actorId === producerA.id && audit.ipAddress === '198.51.100.7' && (audit.metadata as any).podId === SERVICE && (audit.metadata as any).amId === amA.id);
    }
    const coi2 = await createTask(prisma, sAdminA, { type: 'COI', title: 'Second', insuredId: iA.id });
    ok('references are unique and increasing', coi2.reference > coi.reference);

    const complexCoi = await createTask(prisma, sAdminA, { type: 'COI', title: 'Complex', complexity: 'COMPLEX', insuredId: iA.id });
    ok('complex COI: 1 business day', complexCoi.dueAt?.getTime() === addBusinessDays(new Date((complexCoi.slaTarget as any).appliedAt), 1, cal).getTime());
    const endorsement = await createTask(prisma, sAdminA, { type: 'ENDORSEMENT', title: 'Add vehicle', insuredId: iA.id });
    ok('the agency\'s own agreement beats the Desk default (1 day, not 2)', (endorsement.slaTarget as any)?.businessDays === 1);
    const renewal = await createTask(prisma, sAdminA, { type: 'RENEWAL', title: 'Renew GL', policyId: pRenew.id });
    {
      const w = expirationWindow(pRenew.expirationDate!, 120, 90, cal);
      ok('renewal on a policy: due 90 days before expiration, opening recorded at 120',
        renewal.dueAt?.getTime() === w.dueAt.getTime() && (renewal.slaTarget as any).opensAt === w.opensAt!.toISOString());
      ok('the policy fills in its account; routed to Pod 2', renewal.insuredId === iA.id && renewal.podId === RENEWALS);
    }
    const renewalNoPolicy = await createTask(prisma, sAdminA, { type: 'RENEWAL', title: 'Renewal, policy unknown', insuredId: iA.id });
    ok('renewal without a policy: target recorded, no guessed due date', !!renewalNoPolicy.slaTarget && renewalNoPolicy.dueAt === null);
    const acord = await createTask(prisma, sAdminA, { type: 'ACORD', title: 'ACORD 25' });
    ok('ACORD (no target yet, D5): no due date; still routed to Pod 1', acord.dueAt === null && acord.slaTarget === null && acord.podId === SERVICE);
    const other = await createTask(prisma, sAdminA, { type: 'OTHER', title: 'Question' });
    ok('"Other" stays unrouted for the AM to triage', other.podId === null && (await events(other.id)).every((e) => e.kind !== 'ROUTED'));
    const urgent = await createTask(prisma, sAdminA, { type: 'COI', title: 'Urgent', priority: 'URGENT' });
    ok('priority chosen by the agency is kept; default is Normal', urgent.priority === 'URGENT' && coi.priority === 'NORMAL');
    const qa = await createTask(prisma, sAmA, { type: 'QA_REVIEW', title: 'Check binder', agencyId: A.id });
    ok('AM files on the agency\'s behalf: internal source; QA is non-billable', qa.source === 'INTERNAL' && qa.agencyId === A.id && qa.nonBillable);
    const forB = await createTask(prisma, sAmB, { type: 'COI', title: 'For B', agencyId: B.id });
    ok('agency with only a backup AM: the backup is attached', forB.amId === amB.id);
    ok('Producer cannot file for an account they are not assigned to (404)',
      (await status(() => createTask(prisma, sProd, { type: 'COI', title: 'x', insuredId: iOther.id }))) === 404);
    ok('invalid type, empty title, overlong title, bad complexity: all 400', [
      await status(() => createTask(prisma, sAdminA, { type: 'PIZZA', title: 'x' })),
      await status(() => createTask(prisma, sAdminA, { type: 'COI', title: '   ' })),
      await status(() => createTask(prisma, sAdminA, { type: 'COI', title: 'x'.repeat(201) })),
      await status(() => createTask(prisma, sAdminA, { type: 'COI', title: 'x', complexity: 'HARD' })),
    ].every((s) => s === 400));
    ok('a VA cannot file requests', (await status(() => createTask(prisma, sVa1, { type: 'COI', title: 'x', agencyId: A.id }))) === 404);

    console.log('\n━━ Picking up and assigning ━━');
    ok('a VA cannot change a task they have not picked up (403)', (await status(() => changeTaskStatus(prisma, sVa1, coi.id, 'IN_PROGRESS'))) === 403);
    let t = await assignTask(prisma, sVa1, coi.id, va1.id);
    ok('VA picks up an unassigned task (field never set before): New → Assigned', t.assigneeId === va1.id && t.status === 'ASSIGNED');
    ok('another VA cannot take it over (403)', (await status(() => assignTask(prisma, sVa2, coi.id, va2.id))) === 403);
    ok('agency users cannot assign (403)', (await status(() => assignTask(prisma, sAdminA, coi.id, va2.id))) === 403);
    ok('cannot assign to someone not authorised for the agency (Pod 2 VA → 400)',
      (await status(() => assignTask(prisma, sAmA, coi2.id, vaRenewals.id))) === 400);
    ok('cannot assign to an agency user (400)', (await status(() => assignTask(prisma, sAmA, coi2.id, adminA.id))) === 400);
    t = await assignTask(prisma, sAmA, coi2.id, va2.id);
    t = await assignTask(prisma, sAmA, coi2.id, va1.id);
    ok('AM assigns, then reassigns; status stays Assigned', t.assigneeId === va1.id && t.status === 'ASSIGNED');
    t = await assignTask(prisma, sVa1, coi2.id, null);
    ok('VA releases their own task: back to New, unassigned', t.assigneeId === null && t.status === 'NEW');
    ok('assigning someone already assigned is a 409', (await status(() => assignTask(prisma, sVa1, coi.id, va1.id))) === 409);

    console.log('\n━━ Working a task ━━');
    ok('agency users can\'t move work along (403)', (await status(() => changeTaskStatus(prisma, sAdminA, coi.id, 'IN_PROGRESS'))) === 403);
    t = await changeTaskStatus(prisma, sVa1, coi.id, 'IN_PROGRESS');
    ok('VA starts work: In progress, start time recorded', t.status === 'IN_PROGRESS' && !!t.startedAt);
    ok('starting needs an assignee (409)', (await status(() => changeTaskStatus(prisma, sAmA, coi2.id, 'IN_PROGRESS'))) === 409);
    ok('waiting needs a reason (400)', (await status(() => changeTaskStatus(prisma, sVa1, coi.id, 'WAITING_ON_AGENCY'))) === 400);
    t = await changeTaskStatus(prisma, sVa1, coi.id, 'WAITING_ON_AGENCY', { reason: 'Please send the certificate holder\'s address.' });
    {
      const ev = (await events(coi.id)).filter((e) => e.kind === 'STATUS_CHANGED');
      const last = ev[ev.length - 1];
      ok('"waiting on agency" is shown to the agency with what is needed',
        t.status === 'WAITING_ON_AGENCY' && last.visibility === 'AGENCY' && last.body?.includes('certificate holder') === true);
      ok('the agency sees "Needs your attention"', agencyTaskView(t).statusLabel === 'Needs your attention');
    }
    {
      const r = await addTaskNote(prisma, sProd, coi.id, { body: '123 Main St, Springfield', visibility: 'INTERNAL' });
      const ev = await events(coi.id);
      const note = ev.find((e) => e.kind === 'NOTE');
      ok('the agency replies: note shared with the agency even if "internal" was asked for', note?.visibility === 'AGENCY');
      ok('…and the task goes back to In progress automatically', r.resumed && r.task.status === 'IN_PROGRESS' &&
        ev.some((e) => e.kind === 'STATUS_CHANGED' && (e.metadata as any)?.automatic === 'agency_replied'));
    }
    t = await changeTaskStatus(prisma, sVa1, coi.id, 'WAITING_ON_CARRIER', { reason: 'Asked carrier for endorsement copy' });
    {
      const ev = (await events(coi.id)).filter((e) => e.kind === 'STATUS_CHANGED');
      ok('internal-only changes (In progress → Waiting on carrier) stay internal', ev[ev.length - 1].visibility === 'INTERNAL');
    }
    t = await changeTaskStatus(prisma, sVa1, coi.id, 'IN_PROGRESS');
    ok('a move not in the rules is a 409 (In progress → New)', (await status(() => changeTaskStatus(prisma, sVa1, coi.id, 'NEW'))) === 409);
    ok('the same status again is a 409', (await status(() => changeTaskStatus(prisma, sVa1, coi.id, 'IN_PROGRESS'))) === 409);
    ok('an unknown status is a 400', (await status(() => changeTaskStatus(prisma, sVa1, coi.id, 'DONE'))) === 400);
    t = await changeTaskStatus(prisma, sVa1, coi.id, 'QA_REVIEW');
    t = await changeTaskStatus(prisma, sVa1, coi.id, 'COMPLETED');
    ok('through QA to Completed, completion time recorded', t.status === 'COMPLETED' && !!t.completedAt);
    ok('a VA cannot reopen (403)', (await status(() => changeTaskStatus(prisma, sVa1, coi.id, 'IN_PROGRESS', { reason: 'x' }))) === 403);
    ok('reopening needs a reason (400)', (await status(() => changeTaskStatus(prisma, sAmA, coi.id, 'IN_PROGRESS'))) === 400);
    t = await changeTaskStatus(prisma, sAmA, coi.id, 'IN_PROGRESS', { reason: 'Holder name misspelled' });
    ok('the AM reopens: back in progress, completion cleared, first start time kept',
      t.status === 'IN_PROGRESS' && t.completedAt === null && !!t.startedAt);
    ok('closed tasks cannot be assigned (409)', await (async () => {
      await changeTaskStatus(prisma, sVa1, coi.id, 'COMPLETED');
      return (await status(() => assignTask(prisma, sAmA, coi.id, va2.id))) === 409;
    })());

    console.log('\n━━ Agency cancelling ━━');
    ok('cancelling needs a reason (400)', (await status(() => changeTaskStatus(prisma, sAdminA, coi2.id, 'CANCELLED'))) === 400);
    t = await changeTaskStatus(prisma, sAdminA, coi2.id, 'CANCELLED', { reason: 'No longer needed' });
    ok('the agency cancels a request before work starts', t.status === 'CANCELLED' && !!t.cancelledAt);
    await assignTask(prisma, sAmA, complexCoi.id, va2.id);
    await changeTaskStatus(prisma, sVa2, complexCoi.id, 'IN_PROGRESS');
    ok('…but not once work has started (403)', (await status(() => changeTaskStatus(prisma, sAdminA, complexCoi.id, 'CANCELLED', { reason: 'x' }))) === 403);
    t = await changeTaskStatus(prisma, sAmA, coi2.id, 'NEW', { reason: 'Agency asked to restore it' });
    ok('the AM restores a cancelled request to New', t.status === 'NEW' && t.cancelledAt === null && !t.assigneeId);

    console.log('\n━━ Agency reply on an unassigned task ━━');
    await changeTaskStatus(prisma, sAmA, other.id, 'WAITING_ON_AGENCY', { reason: 'Which policy is this about?' });
    {
      const r = await addTaskNote(prisma, sAdminA, other.id, { body: 'The GL policy' });
      ok('no assignee yet: the reply sends it back to New (the queue), not In progress', r.resumed && r.task.status === 'NEW');
    }

    console.log('\n━━ Notes ━━');
    {
      await addTaskNote(prisma, sVa2, complexCoi.id, { body: 'Called carrier' });
      await addTaskNote(prisma, sAmA, complexCoi.id, { body: 'We are on it', visibility: 'AGENCY' });
      const notes = (await events(complexCoi.id)).filter((e) => e.kind === 'NOTE');
      ok('staff notes are internal by default; staff may share one with the agency',
        notes[0].visibility === 'INTERNAL' && notes[1].visibility === 'AGENCY');
      ok('empty note and unknown visibility: 400', (await status(() => addTaskNote(prisma, sVa2, complexCoi.id, { body: ' ' }))) === 400 &&
        (await status(() => addTaskNote(prisma, sVa2, complexCoi.id, { body: 'x', visibility: 'PUBLIC' }))) === 400);
      const audit = await prisma.deskAuditLog.findMany({ where: { entityId: complexCoi.id, action: 'task.note_added' } });
      ok('notes are audited without their text', audit.length === 2 && audit.every((a) => !JSON.stringify(a.metadata).includes('Called carrier')));
    }

    console.log('\n━━ Out of scope ━━');
    ok('another agency\'s admin: 404 on status, assignment and notes', [
      await status(() => changeTaskStatus(prisma, sAdminB, complexCoi.id, 'CANCELLED', { reason: 'x' })),
      await status(() => assignTask(prisma, sAdminB, complexCoi.id, null)),
      await status(() => addTaskNote(prisma, sAdminB, complexCoi.id, { body: 'x' })),
    ].every((s) => s === 404));
    { const sVaR = await S(vaRenewals); ok('a VA outside the pod: 404', (await status(() => addTaskNote(prisma, sVaR, complexCoi.id, { body: 'x' }))) === 404); }
    ok('the Producer: 404 on a task for an account they are not on', (await status(() => addTaskNote(prisma, sProd, acord.id, { body: 'x' }))) === 404);

    console.log('\n━━ Agency view ━━');
    {
      const v = agencyTaskView(await reload(complexCoi.id)) as Record<string, unknown>;
      const hidden = ['podId', 'assigneeId', 'amId', 'restrictedToUserIds', 'restrictionReason', 'slaTarget', 'slaDueAt', 'billingClass', 'nonBillable', 'serviceCategory', 'escalated'];
      ok('no internal fields (pod, assignee, restriction, billing, target)', hidden.every((k) => !(k in v)));
      ok('simplified status shown', v.status === 'IN_PROGRESS' && v.statusLabel === 'In progress');
    }

    console.log('\n━━ Timeline and audit ━━');
    {
      const ev = await events(coi.id);
      const changes = ev.filter((e) => e.kind === 'STATUS_CHANGED');
      ok('every status change is on the timeline with from / to', changes.length >= 8 && changes.every((e) => e.fromStatus && e.toStatus));
      const audits = await prisma.deskAuditLog.findMany({ where: { entityId: coi.id } });
      const n = (action: string) => audits.filter((a) => a.action === action).length;
      const manual = changes.filter((e) => !(e.metadata as any)?.automatic).length;
      ok(`one audit entry per action: created 1, assigned ${n('task.assigned')}, status ${n('task.status_changed')}, notes ${n('task.note_added')}`,
        n('task.created') === 1 &&
        n('task.assigned') === ev.filter((e) => e.kind === 'ASSIGNED' || e.kind === 'UNASSIGNED').length &&
        n('task.status_changed') === manual && manual === 8 &&
        n('task.note_added') === ev.filter((e) => e.kind === 'NOTE').length);
      ok('the agency reply\'s automatic resume is recorded on its note entry, not as a separate action',
        audits.some((a) => a.action === 'task.note_added' && (a.metadata as any)?.resumed === true));
      // VA before pickup, VA takeover, agency assigning, agency starting work, VA reopening.
      const denied = audits.filter((a) => a.action === 'access.denied');
      ok(`refused role actions on a visible task are audited (${denied.length} of 5) with the reason`,
        denied.length === 5 && denied.every((a) => typeof (a.metadata as any)?.reason === 'string' && (a.metadata as any)?.op));
      ok('invalid input and conflicts (400 / 409) are not logged as access attempts',
        !denied.some((a) => (a.metadata as any)?.to === 'NEW' || (a.metadata as any)?.to === 'DONE'));
    }

    console.log('\n━━ Two people at once ━━');
    {
      await assignTask(prisma, sAmA, endorsement.id, va1.id);
      await changeTaskStatus(prisma, sVa1, endorsement.id, 'IN_PROGRESS');
      // Complete vs cancel conflict whichever lands first, so exactly one may succeed.
      const results = await Promise.all([
        status(() => changeTaskStatus(prisma, sVa1, endorsement.id, 'COMPLETED')),
        status(() => changeTaskStatus(prisma, sAmA, endorsement.id, 'CANCELLED', { reason: 'duplicate' })),
      ]);
      const final = await reload(endorsement.id);
      const stamps = (await events(endorsement.id)).filter((e) => e.kind === 'STATUS_CHANGED' && e.fromStatus === 'IN_PROGRESS');
      ok(`simultaneous complete and cancel: one wins, the other gets 409 (got ${results.join(', ')})`, [...results].sort().join() === '200,409');
      ok('the task and timeline reflect only the winner', stamps.length === 1 && stamps[0].toStatus === final.status &&
        (final.status === 'COMPLETED' ? !!final.completedAt && !final.cancelledAt : !!final.cancelledAt && !final.completedAt));
      // The loser gets 409 if it raced, 403 ("already taken") if it arrived just after.
      const picks = await Promise.all([
        status(() => assignTask(prisma, sVa1, acord.id, va1.id)),
        status(() => assignTask(prisma, sVa2, acord.id, va2.id)),
      ]);
      const holder = (await reload(acord.id)).assigneeId;
      ok(`two VAs picking up the same task: exactly one gets it (got ${picks.join(', ')})`,
        picks.filter((s) => s === 200).length === 1 && picks.every((s) => s === 200 || s === 403 || s === 409) &&
        holder === (picks[0] === 200 ? va1.id : va2.id));
    }
    void renewalNoPolicy; void urgent; void qa; void forB; void sAmB;
  } finally {
    await wipe();
    const left = (await prisma.user.count({ where: { id: { in: cleanup.userIds } } })) + (await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } }));
    ok('temporary records removed', left === 0);
    console.log(`\n━━ ${pass} passed, ${fail} failed ━━`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
