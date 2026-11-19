/**
 * Module 39: follow-up rules.
 *
 *   npx tsx script/verify-desk-follow-ups.ts
 *
 * Titles (placeholders, checks, length); the editor (who may, adding, the
 * same pair twice, bad input, editing, switching off and on, every change
 * audited, the Desk defaults untouched); the engine (completing a request
 * creates its follow-ups as internal subtasks, in the right pod, billed by
 * the rule, with the request's priority and need-to-know restriction, in the
 * same save; once per rule per request, even when completed again; never for
 * a subtask or a rule that is off; a pod that is off falls back to routing);
 * follow-ups don't hold their request open and aren't cancelled with it, and
 * can be reopened while it stays completed; never shown to the agency; the
 * real route; the screens. Against the shared database, with temporary
 * agencies, people, pods, requests and rules, all removed at the end. Emails
 * are off for this run.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { followUpTitle, templateProblem } from '../lib/desk/follow-ups';
import { getFollowUpSetup, saveFollowUpRule, setFollowUpRuleActive } from '../lib/desk/follow-up-admin';
import { getTaskDetail, listTasks, setTaskAssignee, setTaskStatus, submitSubtask, submitTask } from '../lib/desk/task-api';
import { eventTitle, type StaffEvent } from '../lib/desk/task-workspace';
import { TASK_TYPE_LABELS } from '../lib/desk/service-levels';
import { changeTaskStatus } from '../lib/desk/tasks';
import { GET as getRoute, PATCH as patchRoute, POST as postRoute } from '../app/api/desk/admin/follow-ups/route';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m39test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[], ruleIds: [] as string[], coiFree: false };
const read = (p: string) => readFileSync(p, 'utf8');
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  // Leaves first, so a subtask is never deleted before one of its own.
  for (let left = 1; left > 0;) {
    const parents = (await prisma.task.findMany({ where: { agencyId, parentTaskId: { not: null } }, select: { parentTaskId: true } })).map((t) => t.parentTaskId!);
    await prisma.task.deleteMany({ where: { agencyId, id: { notIn: parents } } });
    left = await prisma.task.count({ where: { agencyId } });
  }
  // Only the rules this run made; the Desk's own rules are never touched. Certificates had no
  // rule when the run started, so any one now is this run's, even one a save wasn't meant to make.
  await prisma.taskFollowUpRule.deleteMany({ where: cleanup.coiFree ? { OR: [{ id: { in: cleanup.ruleIds } }, { triggerType: 'COI' }] } : { id: { in: cleanup.ruleIds } } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ agencyId }, { podId: { in: cleanup.podIds } }] } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

const refusal = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { if (e instanceof DeskAccessError) return e; throw e; }
};

function pureLogic() {
  console.log('Titles');
  ok('the request number and account are filled in', followUpTitle('Update AMS for #{reference} ({insured})', { reference: 1042, insuredName: 'Acme' }) === 'Update AMS for #1042 (Acme)');
  ok('a request with no account says so', followUpTitle('For {insured}', { reference: 1, insuredName: null }) === 'For no account');
  ok('a long account name is clipped to a title\'s length', followUpTitle('{insured}', { reference: 1, insuredName: 'x'.repeat(300) }).length === 200);
  ok('only {reference} and {insured} may be used', templateProblem('For {policy}')?.startsWith('{policy} isn\'t something') === true
    && templateProblem('Check #{reference')?.startsWith('Check the braces') === true && templateProblem('AMS for #{reference} {insured}') === null);
  ok('a title is needed, and not too long', templateProblem('  ') === 'Enter a title for the follow-up.' && !!templateProblem('x'.repeat(151)) && templateProblem('x'.repeat(150)) === null);
  ok('the client\'s example title is valid', templateProblem('Update AMS for completed renewal #{reference}') === null);

  console.log('History wording');
  const e = (kind: string, details: Record<string, unknown>) => ({ id: 'x', kind, visibility: 'INTERNAL', actorName: null, body: null, fromStatus: null, toStatus: null, details, createdAt: '' }) as StaffEvent;
  ok('the request\'s history: "Follow-up #N created"', eventTitle(e('SUBTASK_CREATED', { reference: 1043, followUp: true })) === 'Follow-up #1043 created'
    && eventTitle(e('SUBTASK_CREATED', { reference: 1043 })) === 'Subtask #1043 added');
  ok('the follow-up\'s own history: made by a rule', eventTitle(e('CREATED', { automatic: 'follow_up' })) === 'Created by a follow-up rule' && eventTitle(e('CREATED', {})) === 'Request filed');
}

(async () => {
  try {
    pureLogic();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, passwordHash: 'x', mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const mkPod = async (n: string) => { const p = await prisma.pod.create({ data: { code: `${TAG}${n}`, name: `${TAG} ${n}` } }); cleanup.podIds.push(p.id); return p; };
    const A = await mkAgency('Harbor');
    const owner = await mkUser('owner', 'ADMIN', A.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    const va2 = await mkUser('va2', 'DESK_VA');
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    const P1 = await mkPod('One');
    const P2 = await mkPod('Two');
    const Off = await mkPod('Off');
    await prisma.pod.update({ where: { id: Off.id }, data: { isActive: false } });
    await prisma.podMember.createMany({ data: [{ podId: P1.id, userId: va.id }, { podId: P2.id, userId: va2.id }] });
    await prisma.agencyPodAccess.createMany({ data: [{ agencyId: A.id, podId: P1.id }, { agencyId: A.id, podId: P2.id }] });
    const acme = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Acme Trucking`, nameKey: `${TAG} acme trucking` } });
    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sOwner, sAm, sOps, sVa, sVa2] = await Promise.all([owner, am, ops, va, va2].map(scope));
    const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
    const followUpsOf = (id: string) => prisma.task.findMany({ where: { parentTaskId: id, followUpRuleId: { not: null } }, orderBy: { reference: 'asc' } });

    // Test rules start from Certificates (COI), which no Desk rule uses; checked first so nothing real is changed.
    const realRules = await prisma.taskFollowUpRule.findMany({ orderBy: { id: 'asc' } });
    if (realRules.some((r) => r.triggerType === 'COI')) throw new Error('A follow-up rule for Certificates already exists; this suite needs that type free.');
    cleanup.coiFree = true;
    const realSnapshot = JSON.stringify(realRules);

    console.log('The editor: who may');
    const amRefused = await refusal(() => saveFollowUpRule(prisma, sAm, { triggerType: 'COI', createType: 'ENDORSEMENT', titleTemplate: 'x' }));
    ok('an Account Manager can\'t change rules', amRefused?.status === 403);
    ok('nor the agency, nor a VA', (await refusal(() => getFollowUpSetup(prisma, sOwner)))?.status === 403 && (await refusal(() => getFollowUpSetup(prisma, sVa)))?.status === 403);

    console.log('The editor: adding');
    const r1 = await saveFollowUpRule(prisma, sOps, { triggerType: 'COI', createType: 'ENDORSEMENT', podId: P2.id, titleTemplate: `${TAG} Endorse after #{reference} for {insured}`, billable: false });
    cleanup.ruleIds.push(r1.id);
    const setup = await getFollowUpSetup(prisma, sOps);
    const shown = setup.rules.find((r) => r.id === r1.id);
    ok('an Operations Manager adds one; it is listed', !!shown && shown.isActive && shown.triggerLabel === TASK_TYPE_LABELS.COI && shown.createLabel === 'Endorsement', JSON.stringify(shown));
    ok('with where it goes and an example title', shown?.goesTo === P2.name && shown.viaRouting === false && shown.example === `${TAG} Endorse after #1042 for Acme Trucking` && shown.billable === false);
    const r1Audit = await prisma.deskAuditLog.findFirst({ where: { action: 'follow_up_rule.changed', entityId: r1.id } });
    ok('audited, with what it is', (r1Audit?.metadata as Json)?.from === null && (r1Audit?.metadata as Json)?.to?.createType === 'ENDORSEMENT' && r1Audit?.actorId === ops.id);
    const r2 = await saveFollowUpRule(prisma, sOps, { triggerType: 'COI', createType: 'OTHER', podId: null, titleTemplate: `${TAG} Check {insured}'s file`, billable: true });
    cleanup.ruleIds.push(r2.id);
    const shown2 = (await getFollowUpSetup(prisma, sOps)).rules.find((r) => r.id === r2.id);
    ok('no pod: wherever its type is routed (here: nowhere)', shown2?.podId === null && shown2.viaRouting === true && shown2.goesTo === null);
    const routedRules = setup.rules.filter((r) => r.viaRouting && setup.types.find((t) => t.type === r.createType)?.routedTo);
    ok('no pod, but its type is routed: it goes where that type is routed', routedRules.length > 0 && routedRules.every((r) => r.goesTo === setup.types.find((t) => t.type === r.createType)?.routedTo), JSON.stringify(routedRules.map((r) => [r.createType, r.goesTo])));
    ok('the routing for each type is shown for the form', setup.types.find((t) => t.type === 'ENDORSEMENT')?.routedTo !== undefined && setup.pods.every((p) => p.id !== Off.id));

    console.log('The editor: refused');
    const dup = await refusal(() => saveFollowUpRule(prisma, sOps, { triggerType: 'COI', createType: 'ENDORSEMENT', titleTemplate: 'Again' }));
    ok('the same pair twice: 409, and why', dup?.status === 409 && dup.message.includes('Edit that one instead.'), dup?.message);
    ok('an unknown placeholder or no title: 400', (await refusal(() => saveFollowUpRule(prisma, sOps, { triggerType: 'COI', createType: 'ACORD', titleTemplate: 'For {policy}' })))?.status === 400
      && (await refusal(() => saveFollowUpRule(prisma, sOps, { triggerType: 'COI', createType: 'ACORD', titleTemplate: ' ' })))?.status === 400);
    ok('an unknown type: 400', (await refusal(() => saveFollowUpRule(prisma, sOps, { triggerType: 'NOPE', createType: 'ACORD', titleTemplate: 'x' })))?.status === 400
      && (await refusal(() => saveFollowUpRule(prisma, sOps, { triggerType: 'COI', createType: 'NOPE', titleTemplate: 'x' })))?.status === 400);
    ok('a pod that is off: 409; an unknown pod: 400', (await refusal(() => saveFollowUpRule(prisma, sOps, { triggerType: 'COI', createType: 'ACORD', podId: Off.id, titleTemplate: 'x' })))?.status === 409
      && (await refusal(() => saveFollowUpRule(prisma, sOps, { triggerType: 'COI', createType: 'ACORD', podId: '000000000000000000000000', titleTemplate: 'x' })))?.status === 400);
    ok('billable must be yes or no', (await refusal(() => saveFollowUpRule(prisma, sOps, { triggerType: 'COI', createType: 'ACORD', titleTemplate: 'x', billable: 'yes' })))?.status === 400);
    ok('nothing was saved by anything refused', await prisma.taskFollowUpRule.count({ where: { triggerType: 'COI' } }) === 2);

    console.log('The editor: editing, switching off and on');
    await saveFollowUpRule(prisma, sOps, { id: r2.id, podId: P1.id, titleTemplate: `${TAG} Check the file for #{reference}`, billable: true });
    const r2Row = await prisma.taskFollowUpRule.findUniqueOrThrow({ where: { id: r2.id } });
    ok('edited: pod and title; the request types stay', r2Row.podId === P1.id && r2Row.titleTemplate === `${TAG} Check the file for #{reference}` && r2Row.triggerType === 'COI' && r2Row.createType === 'OTHER');
    const editAudit = await prisma.deskAuditLog.findFirst({ where: { action: 'follow_up_rule.changed', entityId: r2.id }, orderBy: { createdAt: 'desc' } });
    ok('audited from and to', (editAudit?.metadata as Json)?.from?.podId === null && (editAudit?.metadata as Json)?.to?.podId === P1.id);
    const audits = () => prisma.deskAuditLog.count({ where: { action: 'follow_up_rule.changed', entityId: r2.id } });
    const before = await audits();
    await saveFollowUpRule(prisma, sOps, { id: r2.id, podId: P1.id, titleTemplate: `${TAG} Check the file for #{reference}`, billable: true });
    ok('saving with no change records nothing', await audits() === before);
    ok('an unknown rule: 404', (await refusal(() => saveFollowUpRule(prisma, sOps, { id: '000000000000000000000000', titleTemplate: 'x' })))?.status === 404
      && (await refusal(() => setFollowUpRuleActive(prisma, sOps, 'nope', false)))?.status === 404);
    await setFollowUpRuleActive(prisma, sOps, r2.id, false);
    ok('switched off, and audited', !(await prisma.taskFollowUpRule.findUniqueOrThrow({ where: { id: r2.id } })).isActive && await audits() === before + 1);
    const again = await saveFollowUpRule(prisma, sOps, { triggerType: 'COI', createType: 'OTHER', podId: P1.id, titleTemplate: `${TAG} Check the file for #{reference}`, billable: true });
    ok('adding the same pair again switches it back on, as the same rule', again.id === r2.id && (await prisma.taskFollowUpRule.findUniqueOrThrow({ where: { id: r2.id } })).isActive);
    await setFollowUpRuleActive(prisma, sOps, r2.id, false);
    await setFollowUpRuleActive(prisma, sOps, r2.id, true);
    ok('switched off and on directly', (await prisma.taskFollowUpRule.findUniqueOrThrow({ where: { id: r2.id } })).isActive);
    ok('an AM can\'t switch rules', (await refusal(() => setFollowUpRuleActive(prisma, sAm, r2.id, false)))?.status === 403);

    console.log('Completing a request creates its follow-ups');
    /** A Certificate request from the agency, in pod One, held by the VA and in progress. */
    const request = async (title: string, extra: object = {}) => {
      const view = await submitTask(prisma, sOwner, { type: 'COI', title: `${TAG} ${title}`, insuredId: acme.id, ...extra }) as Json;
      await prisma.task.update({ where: { id: view.id }, data: { podId: P1.id } });
      await setTaskAssignee(prisma, sAm, view.id, { assigneeId: va.id });
      await setTaskStatus(prisma, sVa, view.id, { status: 'IN_PROGRESS' });
      return view.id as string;
    };
    const R = await request('Certificate for the fleet', { priority: 'URGENT' });
    const rRow = await row(R);
    await setTaskStatus(prisma, sVa, R, { status: 'COMPLETED' });
    const made = await followUpsOf(R);
    const endorse = made.find((t) => t.followUpRuleId === r1.id);
    const check = made.find((t) => t.followUpRuleId === r2.id);
    ok('the request is completed, with one follow-up per rule', (await row(R)).status === 'COMPLETED' && made.length === 2 && !!endorse && !!check, String(made.length));
    ok('each is a subtask of the request, new and in nobody\'s hands', made.every((t) => t.parentTaskId === R && t.status === 'NEW' && !t.assigneeId && t.agencyId === A.id && t.insuredId === acme.id));
    ok('titled from the rule', endorse?.title === `${TAG} Endorse after #${rRow.reference} for ${TAG} Acme Trucking` && check?.title === `${TAG} Check the file for #${rRow.reference}`, endorse?.title);
    ok('in the rule\'s pod', endorse?.podId === P2.id && check?.podId === P1.id);
    ok('billed as the rule says', endorse?.nonBillable === true && check?.nonBillable === false);
    ok('with the request\'s priority', made.every((t) => t.priority === 'URGENT'));
    ok('typed as the rule says', endorse?.type === 'ENDORSEMENT' && check?.type === 'OTHER');
    const fuEvents = await prisma.taskEvent.findMany({ where: { taskId: endorse!.id } });
    const created = fuEvents.find((ev) => ev.kind === 'CREATED');
    ok('its history: made by the rule, internal', !!created && created.actorId === null && (created.metadata as Json)?.automatic === 'follow_up' && fuEvents.every((ev) => ev.visibility === 'INTERNAL'));
    const parentEvents = await prisma.taskEvent.findMany({ where: { taskId: R, kind: 'SUBTASK_CREATED' } });
    ok('the request\'s history records each, internally', parentEvents.length === 2 && parentEvents.every((ev) => ev.visibility === 'INTERNAL' && (ev.metadata as Json)?.followUp === true));
    const doneAudit = await prisma.deskAuditLog.findFirst({ where: { action: 'task.status_changed', entityId: R }, orderBy: { createdAt: 'desc' } });
    const madeAudit = await prisma.deskAuditLog.findFirst({ where: { action: 'task.created', entityId: endorse!.id } });
    ok('audited: the completion lists them; each, with its rule', ((doneAudit?.metadata as Json)?.followUpsCreated ?? []).length === 2
      && (madeAudit?.metadata as Json)?.followUpRuleId === r1.id && (madeAudit?.metadata as Json)?.parentTaskId === R && madeAudit?.actorId === va.id);

    console.log('Never shown to the agency');
    const ownerView = await getTaskDetail(prisma, sOwner, R) as Json;
    ok('the agency\'s request: no follow-ups, nothing in its history', !('subtasks' in ownerView) && !JSON.stringify(ownerView).includes('Endorse after') && !ownerView.events.some((ev: Json) => ev.kind === 'SUBTASK_CREATED'));
    ok('not in its list, not by address', !(await listTasks(prisma, sOwner, { pageSize: 100 }) as Json).rows.some((t: Json) => t.id === endorse!.id)
      && (await refusal(() => getTaskDetail(prisma, sOwner, endorse!.id)))?.status === 404);

    console.log('Shown to staff');
    const amView = await getTaskDetail(prisma, sAm, R) as Json;
    ok('the request lists them as follow-ups', amView.subtasks.length === 2 && amView.subtasks.every((s: Json) => s.followUp === true));
    ok('a follow-up names the request it follows', (await getTaskDetail(prisma, sAm, endorse!.id) as Json).parentRequest.followUp === true);
    const staffRows = (await listTasks(prisma, sAm, { pageSize: 100 }) as Json).rows;
    ok('lists mark it as a follow-up', staffRows.find((t: Json) => t.id === endorse!.id)?.followUp === true && staffRows.find((t: Json) => t.id === R)?.followUp === false);

    console.log('Follow-ups come after the request');
    await setTaskStatus(prisma, sAm, R, { status: 'IN_PROGRESS', reason: 'One more certificate holder' });
    const reopenedView = await getTaskDetail(prisma, sVa, R) as Json;
    ok('reopened, its open follow-ups don\'t hold it', reopenedView.openSubtasks === 0 && reopenedView.permissions.statusMoves.includes('COMPLETED'));
    await setTaskStatus(prisma, sVa, R, { status: 'COMPLETED' });
    ok('completed again: no second follow-up from the same rule', (await row(R)).status === 'COMPLETED' && (await followUpsOf(R)).length === 2);
    await setTaskAssignee(prisma, sAm, endorse!.id, { assigneeId: va2.id });
    await setTaskStatus(prisma, sVa2, endorse!.id, { status: 'IN_PROGRESS' });
    await setTaskStatus(prisma, sVa2, endorse!.id, { status: 'COMPLETED' });
    ok('a follow-up is worked and completed like any task, non-billable', (await row(endorse!.id)).status === 'COMPLETED' && (await row(endorse!.id)).billingClass === 'NON_BILLABLE');
    await setTaskStatus(prisma, sAm, endorse!.id, { status: 'IN_PROGRESS', reason: 'Wrong form' });
    ok('it can be reopened while its request stays completed', (await row(endorse!.id)).status === 'IN_PROGRESS' && (await row(R)).status === 'COMPLETED');
    await setTaskStatus(prisma, sAm, R, { status: 'IN_PROGRESS', reason: 'The agency changed its mind' });
    await setTaskStatus(prisma, sAm, R, { status: 'CANCELLED', reason: 'Not needed after all' });
    ok('cancelling the request leaves its follow-ups', (await row(R)).status === 'CANCELLED' && (await row(endorse!.id)).status === 'IN_PROGRESS' && (await row(check!.id)).status === 'NEW');

    console.log('When follow-ups are not made');
    const S = await request('Certificate with its own subtask');
    const own = await submitSubtask(prisma, sAm, S, { type: 'COI', title: `${TAG} A second certificate` }) as Json;
    ok('a request\'s own subtask still holds it open', (await refusal(() => setTaskStatus(prisma, sVa, S, { status: 'COMPLETED' })))?.code === 'OPEN_SUBTASKS');
    await prisma.task.update({ where: { id: own.id }, data: { podId: P1.id } });
    await setTaskAssignee(prisma, sAm, own.id, { assigneeId: va.id });
    await setTaskStatus(prisma, sVa, own.id, { status: 'IN_PROGRESS' });
    await setTaskStatus(prisma, sVa, own.id, { status: 'COMPLETED' });
    ok('a subtask completed: no follow-up, even of a type with rules', (await prisma.task.count({ where: { parentTaskId: own.id } })) === 0);
    await setFollowUpRuleActive(prisma, sOps, r2.id, false);
    await setTaskStatus(prisma, sVa, S, { status: 'COMPLETED' });
    const sMade = await followUpsOf(S);
    ok('a rule that is off makes none; the others still do', sMade.length === 1 && sMade[0].followUpRuleId === r1.id);
    await setFollowUpRuleActive(prisma, sOps, r2.id, true);

    console.log('Its pod switched off');
    await prisma.pod.update({ where: { id: P2.id }, data: { isActive: false } });
    const T = await request('Certificate while pod Two is off');
    await setTaskStatus(prisma, sVa, T, { status: 'COMPLETED' });
    const tEndorse = (await followUpsOf(T)).find((t) => t.followUpRuleId === r1.id);
    const routed = await prisma.taskRoutingRule.findFirst({ where: { taskType: 'ENDORSEMENT', isActive: true, pod: { isActive: true } } });
    ok('it goes where its type is routed instead', !!tEndorse && tEndorse.podId === (routed?.podId ?? P1.id), `${tEndorse?.podId}`);
    ok('switching the rule on again is refused while its pod is off', await (async () => {
      await setFollowUpRuleActive(prisma, sOps, r1.id, false);
      const e = await refusal(() => setFollowUpRuleActive(prisma, sOps, r1.id, true));
      return e?.status === 409;
    })());
    await prisma.pod.update({ where: { id: P2.id }, data: { isActive: true } });
    await setFollowUpRuleActive(prisma, sOps, r1.id, true);

    console.log('The need-to-know restriction');
    const V = await request('Certificate for a VIP');
    await prisma.task.update({ where: { id: V }, data: { restrictedToUserIds: [va.id], restrictionReason: 'VIP' } });
    await setTaskStatus(prisma, sVa, V, { status: 'COMPLETED' });
    const vMade = await followUpsOf(V);
    ok('follow-ups keep the request\'s restriction', vMade.length === 2 && vMade.every((t) => t.restrictedToUserIds.join() === va.id && t.restrictionReason === 'VIP'));
    ok('so a VA outside it can\'t open them', (await refusal(() => getTaskDetail(prisma, sVa2, vMade[0].id)))?.status === 404);

    console.log('All or nothing');
    // A follow-up that can't be saved: the completion isn't saved either.
    const W = await request('Certificate whose follow-up fails');
    const broken = new Proxy(prisma, { get(t, k) {
      const v = Reflect.get(t, k);
      if (k !== '$transaction') return typeof v === 'function' ? v.bind(t) : v;
      return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, opts?: object) => t.$transaction((tx) => fn(new Proxy(tx, { get(tt, kk) {
        const vv = Reflect.get(tt, kk);
        if (kk !== 'task') return vv;
        return new Proxy(vv as object, { get(m, mk) {
          const f = Reflect.get(m, mk);
          if (mk !== 'create') return typeof f === 'function' ? f.bind(m) : f;
          return (a: { data: { followUpRuleId?: string | null } }) => { if (a.data.followUpRuleId) throw new Error('follow-up failed'); return (f as (x: unknown) => unknown).call(m, a); };
        } });
      } }) as Prisma.TransactionClient), opts);
    } }) as typeof prisma;
    const failed = await changeTaskStatus(broken, sVa, W, 'COMPLETED').then(() => null, (e: Error) => e);
    const wRow = await row(W);
    ok('the completion fails with it: still in progress, nothing billed, nothing made', failed?.message === 'follow-up failed' && wRow.status === 'IN_PROGRESS' && !wRow.billingClass && !wRow.completedAt
      && (await followUpsOf(W)).length === 0, failed?.message);
    await setTaskStatus(prisma, sVa, W, { status: 'COMPLETED' });
    ok('and completes, with its follow-ups, once they can be saved', (await row(W)).status === 'COMPLETED' && (await followUpsOf(W)).length === 2);

    console.log('The Desk\'s own rules');
    const defaultsNow = await prisma.taskFollowUpRule.findMany({ where: { id: { notIn: cleanup.ruleIds } }, orderBy: { id: 'asc' } });
    ok('untouched by this run', JSON.stringify(defaultsNow) === realSnapshot);
    const renewal = defaultsNow.find((r) => r.triggerType === 'RENEWAL' && r.createType === 'AMS_ENTRY');
    ok('the client\'s example is there: Renewal completed → AMS entry', !!renewal && renewal.titleTemplate.includes('{reference}') && renewal.billable === false);
    if (renewal?.isActive) {
      const view = await submitTask(prisma, sOwner, { type: 'RENEWAL', title: `${TAG} Renewal for the fleet`, insuredId: acme.id }) as Json;
      await prisma.task.update({ where: { id: view.id }, data: { podId: P1.id } });
      await setTaskAssignee(prisma, sAm, view.id, { assigneeId: va.id });
      await setTaskStatus(prisma, sVa, view.id, { status: 'IN_PROGRESS' });
      await setTaskStatus(prisma, sVa, view.id, { status: 'COMPLETED' });
      const ams = (await followUpsOf(view.id)).find((t) => t.followUpRuleId === renewal.id);
      const amsRoute = await prisma.taskRoutingRule.findFirst({ where: { taskType: 'AMS_ENTRY', isActive: true }, include: { pod: true } });
      ok('and works: an AMS entry, non-billable, where AMS entry is routed', !!ams && ams.type === 'AMS_ENTRY' && ams.nonBillable && ams.podId === (amsRoute?.pod.isActive ? amsRoute.podId : P1.id)
        && ams.title === `Update AMS for completed renewal #${view.reference}`, ams?.title);
    } else {
      ok('(the client\'s example is switched off here, so not run)', true);
    }

    console.log('The real route');
    const tOps = await createSession(ops.id);
    const tAm = await createSession(am.id);
    const call = (fn: (r: NextRequest) => Promise<Response>, method: string, token: string, body?: unknown) => fn(new NextRequest('http://local.test/api/desk/admin/follow-ups', {
      method, headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    }));
    const listed = await call(getRoute, 'GET', tOps);
    ok('GET: the rules', listed.status === 200 && ((await listed.json()) as Json).rules.some((r: Json) => r.id === r1.id));
    const r3 = await call(postRoute, 'POST', tOps, { triggerType: 'COI', createType: 'ACORD', titleTemplate: `${TAG} ACORD for #{reference}` });
    const r3Body = await r3.json() as Json;
    if (r3Body.id) cleanup.ruleIds.push(r3Body.id);
    ok('POST: added', r3.status === 200 && !!r3Body.id);
    ok('PATCH: switched off', (await call(patchRoute, 'PATCH', tOps, { id: r3Body.id, isActive: false })).status === 200 && !(await prisma.taskFollowUpRule.findUniqueOrThrow({ where: { id: r3Body.id } })).isActive);
    ok('an AM: 403, logged; not JSON: 400', (await call(getRoute, 'GET', tAm)).status === 403 && (await call(postRoute, 'POST', tOps, 'nope')).status === 400
      && !!(await prisma.deskAuditLog.findFirst({ where: { actorId: am.id, action: 'access.denied', entityType: 'DeskSetup' } })));

    console.log('The screens');
    const editor = read('app/components/desk/admin/FollowUpEditor.tsx');
    ok('the admin page is the editor', read('app/(main)/super-admin/desk/follow-ups/page.tsx').includes('<FollowUpEditor />'));
    ok('it adds, edits and switches rules through the route', editor.includes("'/api/desk/admin/follow-ups'") && editor.includes("method: 'PATCH'") && editor.includes("method: 'POST'"));
    ok('it previews the title as it will be written, and checks it', editor.includes('followUpTitle(draft.titleTemplate, setup.example)') && editor.includes('templateProblem(draft.titleTemplate)'));
    ok('it says the agency doesn\'t see follow-ups', editor.includes('the agency doesn&apos;t see it'));
    const ws = read('app/components/desk/workspace/TaskWorkspace.tsx');
    ok('the workspace marks follow-ups and names the request they follow', /\{st\.followUp && <span[^>]*data-testid="desk-task-subtask-followup"/.test(ws) && ws.includes("task.parentRequest.followUp ? 'Follow-up to' : 'Subtask of'"));
    ok('queue rows too', read('app/components/desk/queue/TaskQueue.tsx').includes("{task.followUp ? 'Follow-up to' : 'Subtask of'} #{task.parent.reference}"));
  } catch (err) {
    fail++;
    console.error(err);
  } finally {
    await wipe();
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.task.count({ where: { title: { startsWith: TAG } } })
      + await prisma.pod.count({ where: { code: { startsWith: TAG } } }) + await prisma.taskFollowUpRule.count({ where: { titleTemplate: { startsWith: TAG } } })
      + (cleanup.coiFree ? await prisma.taskFollowUpRule.count({ where: { triggerType: 'COI' } }) : 0);
    ok('nothing left behind', left === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
