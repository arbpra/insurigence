/**
 * Demo data for The Desk (Module 45): two agencies, their people and books,
 * the Desk team, and requests at every stage, so all four views can be shown.
 *
 * Built through the same service functions people use (createTask,
 * assignTask, changeTaskStatus, ...), so routing, Account Managers, targets,
 * billing, follow-ups, history and the audit log are all real.
 *
 * Everything is marked by one email domain on the reserved `.invalid` top-level
 * domain (RFC 6761), which can never receive mail:
 *  - every demo person's email ends in `@<domain>`;
 *  - every demo agency's primary email does too.
 * Removal deletes only records tied to those agencies and people.
 *
 * Demo VAs join the real default pods (routing sends work there), and each
 * demo agency authorises only the demo VAs by name. A real agency that
 * authorises a whole pod would therefore be visible to a demo VA: remove the
 * demo before real agencies go live on the same database.
 */
import { randomBytes } from 'crypto';
import type { AmsSystem, PrismaClient, Task, UserRole } from '@prisma/client';
import { hashPassword } from '@/lib/auth';
import { resolveDeskScope } from './access';
import { ensureDeskDefaults } from './defaults';
import { insuredNameKey } from './insureds';
import { literal } from './literal-match';
import { sendMessage } from './messages';
import { addTaskNote, assignTask, changeTaskStatus, createSubtask, createTask, escalateTask } from './tasks';

type Db = PrismaClient;

export const DEMO_DOMAIN = 'desk-demo.invalid';
const DAY = 86_400_000;

/** People and agencies belonging to a demo domain. */
export async function findDemo(db: Db, domain = DEMO_DOMAIN) {
  const suffix = `@${domain}`;
  const [agencies, users] = await Promise.all([
    // endsWith goes to MongoDB as a regex: literal() keeps the domain's dots from matching any character.
    db.agency.findMany({ where: { primaryEmail: { endsWith: literal(suffix) } }, select: { id: true, name: true } }),
    db.user.findMany({ where: { email: { endsWith: literal(suffix) } }, select: { id: true, email: true } }),
  ]);
  return { agencies, users };
}

/** Removes every record of the demo on this domain. Returns what was removed. */
export async function removeDemo(db: Db, domain = DEMO_DOMAIN) {
  const found = await findDemo(db, domain);
  const agencyIds = found.agencies.map((a) => a.id);
  const userIds = found.users.map((u) => u.id);
  const agencyId = { in: agencyIds };
  const byUser = { in: userIds };
  // Nothing outside the demo may be touched: a demo agency holds only demo people.
  const outsiders = await db.user.count({ where: { agencyId, id: { notIn: userIds } } });
  if (outsiders) throw new Error(`A demo agency has ${outsiders} people who aren't part of the demo; nothing was removed.`);

  await db.deskNotification.deleteMany({ where: { OR: [{ agencyId }, { recipientId: byUser }] } });
  await db.deskMessage.deleteMany({ where: { agencyId } });
  await db.deskMessageRead.deleteMany({ where: { OR: [{ agencyId }, { userId: byUser }] } });
  await db.taskDocument.deleteMany({ where: { agencyId } });
  await db.taskEvent.deleteMany({ where: { agencyId } });
  await db.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  const tasks = await db.task.deleteMany({ where: { agencyId } });
  await db.policy.deleteMany({ where: { agencyId } });
  await db.insuredAssignment.deleteMany({ where: { agencyId } });
  await db.insuredAccount.deleteMany({ where: { agencyId } });
  await db.importRow.deleteMany({ where: { agencyId } });
  await db.importBatch.deleteMany({ where: { agencyId } });
  await db.importColumnMemory.deleteMany({ where: { agencyId } });
  await db.agencyPodAccess.deleteMany({ where: { OR: [{ agencyId }, { userId: byUser }] } });
  await db.podMember.deleteMany({ where: { userId: byUser } });
  await db.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  const plans = await db.agencyDeskPlan.findMany({ where: { agencyId }, select: { id: true } });
  await db.agencyAllowanceOverride.deleteMany({ where: { agencyDeskPlanId: { in: plans.map((p) => p.id) } } });
  await db.agencyDeskPlan.deleteMany({ where: { agencyId } });
  await db.serviceLevelTarget.deleteMany({ where: { agencyId } });
  await db.deskStaffPermission.deleteMany({ where: { userId: byUser } });
  await db.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: byUser }] } });
  await db.activityEvent.deleteMany({ where: { OR: [{ agencyId }, { userId: byUser }] } });
  await db.session.deleteMany({ where: { userId: byUser } });
  await db.inviteToken.deleteMany({ where: { userId: byUser } });
  await db.passwordResetToken.deleteMany({ where: { userId: byUser } });
  const users = await db.user.deleteMany({ where: { id: byUser } });
  const agencies = await db.agency.deleteMany({ where: { id: agencyId } });
  return { agencies: agencies.count, users: users.count, tasks: tasks.count };
}

export interface DemoLogin { view: string; who: string; email: string }

/**
 * Creates the demo. Refuses if any demo record on this domain already exists
 * (remove it first). `password` is the one password for every demo login.
 */
export async function seedDemo(db: Db, opts: { password: string; domain?: string; now?: Date }) {
  const domain = opts.domain ?? DEMO_DOMAIN;
  const now = opts.now ?? new Date();
  const existing = await findDemo(db, domain);
  if (existing.agencies.length || existing.users.length) {
    throw new Error(`The demo already exists (${existing.agencies.length} agencies, ${existing.users.length} people). Remove it first.`);
  }
  if (opts.password.length < 12) throw new Error('Use a demo password of at least 12 characters.');

  await ensureDeskDefaults(db);
  const pods = Object.fromEntries((await db.pod.findMany({ where: { isActive: true } })).map((p) => [p.code, p]));
  for (const code of ['SERVICE_AMS', 'RENEWALS', 'NEW_BUSINESS', 'QA']) {
    if (!pods[code]) throw new Error(`The default pod ${code} is missing or switched off.`);
  }
  const [growth, core] = await Promise.all([
    db.deskPlan.findUnique({ where: { code: 'GROWTH' } }),
    db.deskPlan.findUnique({ where: { code: 'CORE' } }),
  ]);
  if (!growth || !core) throw new Error('The Desk plans are missing.');

  const passwordHash = await hashPassword(opts.password);
  const logins: DemoLogin[] = [];
  const person = async (view: string, local: string, firstName: string, lastName: string, role: UserRole, extra: { agencyId?: string; bookAccess?: 'ALL' | 'ASSIGNED' } = {}) => {
    const email = `${local}@${domain}`;
    const user = await db.user.create({
      data: { email, firstName, lastName, role, passwordHash, mustChangePassword: false, isActive: true, agencyId: extra.agencyId ?? null, bookAccess: extra.bookAccess ?? null },
    });
    logins.push({ view, who: `${firstName} ${lastName}`, email });
    return user;
  };
  const agency = (name: string, local: string, ams: AmsSystem, instructions: string) => db.agency.create({
    data: {
      name, primaryEmail: `${local}@${domain}`, phone: '(555) 010-0100', deskEnabled: true, deskEnabledAt: new Date(now.getTime() - 60 * DAY),
      amsSystem: ams, deskInstructions: instructions,
    },
  });

  // ── The Desk team ──
  const ops = await person('Insurigence Admin', 'olivia.ops', 'Olivia', 'Reyes', 'DESK_ADMIN');
  const am1 = await person('Account Manager', 'marcus.am', 'Marcus', 'Chen', 'ACCOUNT_MANAGER');
  const am2 = await person('Account Manager', 'priya.am', 'Priya', 'Natarajan', 'ACCOUNT_MANAGER');
  const vaService = await person('Pod / VA', 'diego.va', 'Diego', 'Santos', 'DESK_VA');
  const vaRenewals = await person('Pod / VA', 'grace.va', 'Grace', 'Okafor', 'DESK_VA');
  const vaNewBiz = await person('Pod / VA', 'liam.va', 'Liam', 'Walsh', 'DESK_VA');
  await db.podMember.createMany({
    data: [
      { podId: pods.SERVICE_AMS.id, userId: vaService.id, isLead: true },
      { podId: pods.RENEWALS.id, userId: vaRenewals.id, isLead: true },
      { podId: pods.NEW_BUSINESS.id, userId: vaNewBiz.id, isLead: true },
      { podId: pods.QA.id, userId: am1.id },
    ],
  });
  // Diego handles certificates and premium questions, so he may open Financial files.
  await db.deskStaffPermission.create({ data: { userId: vaService.id, allowedSensitivities: ['FINANCIAL'], grantedById: ops.id } });

  // ── Agencies ──
  const harbor = await agency('Harbor & Pine Insurance (demo)', 'office.harborpine', 'APPLIED_EPIC',
    'Certificates go to the holder and copy the producer. Use the agency letterhead for renewal summaries.');
  const summit = await agency('Summit Ridge Agency (demo)', 'office.summitridge', 'HAWKSOFT',
    'Service requests only for now; new business stays in-house.');
  const hAdmin = await person('Agency', 'hannah.owner', 'Hannah', 'Pierce', 'ADMIN', { agencyId: harbor.id });
  const hCsr = await person('Agency', 'carlos.csr', 'Carlos', 'Mendez', 'CSR', { agencyId: harbor.id, bookAccess: 'ALL' });
  const hProducer = await person('Agency', 'nina.producer', 'Nina', 'Brooks', 'AGENT', { agencyId: harbor.id });
  const sAdmin = await person('Agency', 'sam.owner', 'Sam', 'Whitfield', 'ADMIN', { agencyId: summit.id });

  await db.agencyDeskAssignment.createMany({
    data: [
      { agencyId: harbor.id, primaryAmId: am1.id, backupAmId: am2.id },
      { agencyId: summit.id, primaryAmId: am2.id, backupAmId: am1.id },
    ],
  });
  const startsOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  await db.agencyDeskPlan.create({ data: { agencyId: harbor.id, planId: growth.id, startsOn } });
  await db.agencyDeskPlan.create({ data: { agencyId: summit.id, planId: core.id, startsOn } });
  // Named VAs only, so no one outside the demo is let in to its work.
  await db.agencyPodAccess.createMany({
    data: [
      { agencyId: harbor.id, podId: pods.SERVICE_AMS.id, userId: vaService.id },
      { agencyId: harbor.id, podId: pods.RENEWALS.id, userId: vaRenewals.id },
      { agencyId: harbor.id, podId: pods.NEW_BUSINESS.id, userId: vaNewBiz.id },
      { agencyId: harbor.id, podId: pods.QA.id, userId: am1.id },
      { agencyId: summit.id, podId: pods.SERVICE_AMS.id, userId: vaService.id },
    ],
  });

  // ── Books ──
  const day = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
  const account = async (agencyId: string, createdById: string, a: { name: string; industry: string; city: string; state: string; contact: string; policies: [string, string, string, number, number][] }) => {
    const insured = await db.insuredAccount.create({
      data: {
        agencyId, name: a.name, nameKey: insuredNameKey(a.name), industry: a.industry, city: a.city, state: a.state,
        contactName: a.contact, contactEmail: `${a.contact.split(' ')[0].toLowerCase()}@${domain}`, createdById,
      },
    });
    const policies = [];
    for (const [lineOfBusiness, carrierName, policyNumber, expiresIn, premium] of a.policies) {
      policies.push(await db.policy.create({
        data: {
          agencyId, insuredId: insured.id, lineOfBusiness, carrierName, policyNumber, createdById,
          effectiveDate: day(expiresIn - 365), expirationDate: day(expiresIn), premiumCents: BigInt(premium * 100),
        },
      }));
    }
    return { insured, policies };
  };
  const bayside = await account(harbor.id, hAdmin.id, { name: 'Bayside Marine Supply', industry: 'Wholesale', city: 'Portland', state: 'ME', contact: 'Ellen Hart',
    policies: [['General Liability', 'Atlantic Mutual', 'GL-204811', 75, 8_400], ['Commercial Auto', 'Northline Casualty', 'CA-551902', 75, 12_950]] });
  const cedar = await account(harbor.id, hAdmin.id, { name: 'Cedar Lane Dental Group', industry: 'Healthcare', city: 'Augusta', state: 'ME', contact: 'Dr. Raj Patel',
    policies: [['Business Owners', 'Keystone Indemnity', 'BOP-77120', 48, 3_200], ['Professional Liability', 'MedShield', 'PL-90314', 200, 6_100]] });
  const northwind = await account(harbor.id, hAdmin.id, { name: 'Northwind Logistics LLC', industry: 'Transportation', city: 'Bangor', state: 'ME', contact: 'Tom Riley',
    policies: [['Commercial Auto', 'Northline Casualty', 'CA-660417', 140, 38_700], ['Cargo', 'Atlantic Mutual', 'IM-30218', 140, 4_450]] });
  const greenleaf = await account(harbor.id, hAdmin.id, { name: 'Greenleaf Landscaping', industry: 'Construction', city: 'Lewiston', state: 'ME', contact: 'Maria Lopez',
    policies: [['General Liability', 'Keystone Indemnity', 'GL-118204', 100, 5_600], ['Workers Compensation', 'Pine State WC', 'WC-402177', 100, 9_800]] });
  const harborView = await account(harbor.id, hAdmin.id, { name: 'Harbor View Bistro', industry: 'Restaurant', city: 'Portland', state: 'ME', contact: 'Jules Martin',
    policies: [['Business Owners', 'Keystone Indemnity', 'BOP-80455', 300, 4_100]] });
  const summitA = await account(summit.id, sAdmin.id, { name: 'Alpine Outfitters', industry: 'Retail', city: 'Burlington', state: 'VT', contact: 'Kate Moreau',
    policies: [['Business Owners', 'Green Mountain Mutual', 'BOP-3310', 90, 2_900]] });
  const summitB = await account(summit.id, sAdmin.id, { name: 'Ridgeline Builders', industry: 'Construction', city: 'Montpelier', state: 'VT', contact: 'Owen Price',
    policies: [['General Liability', 'Green Mountain Mutual', 'GL-7781', 160, 11_200], ['Inland Marine', 'Granite Specialty', 'IM-2290', 160, 1_800]] });

  // The Producer looks after two accounts; the CSR services the book.
  await db.insuredAssignment.createMany({
    data: [
      { agencyId: harbor.id, insuredId: bayside.insured.id, userId: hProducer.id, role: 'PRODUCER', createdById: hAdmin.id },
      { agencyId: harbor.id, insuredId: northwind.insured.id, userId: hProducer.id, role: 'PRODUCER', createdById: hAdmin.id },
      { agencyId: harbor.id, insuredId: greenleaf.insured.id, userId: hCsr.id, role: 'SERVICE', createdById: hAdmin.id },
    ],
  });

  // ── Work, through the service layer ──
  const scope = async (id: string) => resolveDeskScope(db, id);
  const [sHannah, sCarlos, sNina, sSam, sMarcus, sPriya, sDiego, sGrace, sLiam, sOlivia] = await Promise.all(
    [hAdmin, hCsr, hProducer, sAdmin, am1, am2, vaService, vaRenewals, vaNewBiz, ops].map((u) => scope(u.id)));
  const file = (s: typeof sHannah, input: Parameters<typeof createTask>[2]) => createTask(db, s, input);
  const status = (s: typeof sHannah, t: Task, to: string, reason?: string) => changeTaskStatus(db, s, t.id, to, { reason });
  const note = (s: typeof sHannah, t: Task, body: string, shared = false) => addTaskNote(db, s, t.id, { body, visibility: shared ? 'AGENCY' : 'INTERNAL' });
  const take = (s: typeof sHannah, t: Task, userId: string) => assignTask(db, s, t.id, userId);

  // 1. A certificate in progress, with an internal note and one shared with the agency.
  const coi = await file(sCarlos, { type: 'COI', title: 'Certificate for Portland Harbor Authority (dock lease)', description: 'Holder: Portland Harbor Authority, 1 Commercial St. Additional insured on GL, 30-day notice of cancellation.', insuredId: bayside.insured.id, policyId: bayside.policies[0].id });
  await take(sDiego, coi, vaService.id);
  await status(sDiego, coi, 'IN_PROGRESS');
  await note(sDiego, coi, 'Additional insured wording checked against the GL form CG 20 26. Waiting on the carrier portal to issue.');
  await note(sDiego, coi, 'Drafting the certificate now; you will have it today.', true);

  // 2. An endorsement waiting on the agency, with the question shown to them.
  const vehicle = await file(sNina, { type: 'ENDORSEMENT', title: 'Add 2026 Ford Transit to the auto policy', insuredId: bayside.insured.id, policyId: bayside.policies[1].id });
  await take(sMarcus, vehicle, vaService.id);
  await status(sDiego, vehicle, 'IN_PROGRESS');
  await status(sDiego, vehicle, 'WAITING_ON_AGENCY', 'Please send the VIN and the garaging address for the new van.');

  // 3. A renewal with the carrier, a team subtask, and a follow-up waiting at the end.
  const renewal = await file(sHannah, { type: 'RENEWAL', title: 'Greenleaf Landscaping renewal (GL and WC)', insuredId: greenleaf.insured.id, policyId: greenleaf.policies[0].id });
  await take(sGrace, renewal, vaRenewals.id);
  await status(sGrace, renewal, 'IN_PROGRESS');
  await createSubtask(db, sGrace, renewal.id, { type: 'LOSS_RUNS', title: 'Request 5-year loss runs from Pine State WC' });
  await status(sGrace, renewal, 'WAITING_ON_CARRIER', 'Keystone underwriting reviewing the payroll change before quoting.');

  // 4. New requests still in the queue.
  await file(sHannah, { type: 'LOSS_RUNS', title: 'Loss runs for Cedar Lane Dental (all lines)', insuredId: cedar.insured.id });
  await file(sNina, { type: 'POLICY_UPDATE', title: 'Update the mailing address for Northwind Logistics', insuredId: northwind.insured.id, policyId: northwind.policies[0].id, priority: 'LOW' });

  // 5. Completed work: an AMS entry, and a renewal whose completion creates its follow-up.
  const ams = await file(sCarlos, { type: 'AMS_ENTRY', title: 'Enter the Harbor View Bistro BOP in Epic', insuredId: harborView.insured.id, policyId: harborView.policies[0].id });
  await take(sDiego, ams, vaService.id);
  await status(sDiego, ams, 'IN_PROGRESS');
  await status(sDiego, ams, 'COMPLETED');
  const cedarRenewal = await file(sHannah, { type: 'RENEWAL', title: 'Cedar Lane Dental BOP renewal', insuredId: cedar.insured.id, policyId: cedar.policies[0].id });
  await take(sGrace, cedarRenewal, vaRenewals.id);
  await status(sGrace, cedarRenewal, 'IN_PROGRESS');
  await note(sGrace, cedarRenewal, 'Renewed as expiring with Keystone, premium up 4%. Summary sent to Hannah.', true);
  await status(sGrace, cedarRenewal, 'COMPLETED');

  // 6. New business, escalated by the Account Manager.
  const newBiz = await file(sNina, { type: 'NEW_BUSINESS', title: 'Quote umbrella for Northwind Logistics', description: '$5M umbrella over auto and GL. Client wants options before the board meets.', insuredId: northwind.insured.id, priority: 'HIGH' });
  await take(sLiam, newBiz, vaNewBiz.id);
  await status(sLiam, newBiz, 'IN_PROGRESS');
  await escalateTask(db, sMarcus, newBiz.id, { escalate: true, reason: 'Board meeting moved up; Hannah asked for options by Friday.' });

  // 7. A request restricted to one VA (a sensitive matter).
  const restricted = await file(sHannah, { type: 'DOCUMENT_UPLOAD', title: 'File the coverage dispute correspondence for Bayside', insuredId: bayside.insured.id });
  await db.task.update({ where: { id: restricted.id }, data: { restrictedToUserIds: [vaService.id], restrictionReason: 'Open litigation: only the assigned specialist works this one.' } });
  await take(sMarcus, restricted, vaService.id);

  // 8. The other agency: a certificate in progress, a cancelled request.
  const sCoi = await file(sSam, { type: 'COI', title: 'Certificate for Burlington Parks (event permit)', insuredId: summitA.insured.id, policyId: summitA.policies[0].id });
  await take(sDiego, sCoi, vaService.id);
  await status(sDiego, sCoi, 'IN_PROGRESS');
  const sCancel = await file(sSam, { type: 'POLICY_UPDATE', title: 'Change of address for Ridgeline Builders', insuredId: summitB.insured.id });
  await status(sSam, sCancel, 'CANCELLED', 'Sent in twice by mistake.');

  // An overdue one, so alerts and turnaround show something: the target moved into the past.
  const past = new Date(now.getTime() - 2 * DAY);
  await db.task.update({ where: { id: vehicle.id }, data: { createdAt: new Date(now.getTime() - 5 * DAY) } });
  await db.task.update({ where: { id: newBiz.id }, data: { dueAt: past, slaDueAt: past, createdAt: new Date(now.getTime() - 4 * DAY) } });

  // ── Conversations ──
  await sendMessage(db, sHannah, harbor.id, { body: 'Hi Marcus, we are onboarding two new commercial accounts next month. Can the team take their AMS setup?' });
  await sendMessage(db, sMarcus, harbor.id, { body: 'Absolutely. Send them over as requests when ready and I will make sure Pod 1 has capacity.' });
  await sendMessage(db, sSam, summit.id, { body: 'Thanks for the quick turnaround on last week\'s certificates.' });
  void sPriya; void sOlivia;

  return { logins, agencies: [harbor.name, summit.name] };
}

/** A random password for the demo logins: 16 characters, letters and digits. */
export function demoPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return [...randomBytes(16)].map((b) => chars[b % chars.length]).join('');
}
