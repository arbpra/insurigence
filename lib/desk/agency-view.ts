/**
 * The Account Manager's agency pages: the list of agencies they manage, and
 * one agency's summary. Its accounts and its work are listed by the existing
 * accounts and task APIs (?agencyId=), which apply the same access rules.
 *
 * Managers whose position opens agency books (`accounts.view`). An Account Manager sees only agencies they are the primary
 * or backup AM for; any other agency is refused as not found, and logged
 * (Q4). Opening an agency's page is logged too: it shows the instructions
 * for Desk staff and where its logins are kept (a pointer, never a secret).
 */
import type { PrismaClient } from '@prisma/client';
import { can, DeskAccessError, isObjectId, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { amsDisplayName } from './profile';
import { resolveManagedAccounts } from './billing';
import { countBy, forAgency, listRenewals, managersOnly, workFilters } from './manager-dashboard';

type Db = PrismaClient;

/** Policies expiring within this many days are listed on an agency's page. */
export const AGENCY_RENEWAL_DAYS = 90;
export const AGENCY_RENEWAL_LIMIT = 20;

const PERSON = { select: { id: true, firstName: true, lastName: true, email: true, isActive: true } } as const;
type Person = { id: string; firstName: string | null; lastName: string | null; email: string; isActive: boolean };
const person = (p: Person | null | undefined) =>
  p ? { id: p.id, name: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email, isActive: p.isActive } : null;

/** Primary or backup, for the Account Manager looking; null for anyone else. */
function roleOf(scope: DeskScope, a: { primaryAmId: string | null; backupAmId: string | null } | null): 'PRIMARY' | 'BACKUP' | null {
  if (scope.kind !== 'ACCOUNT_MANAGER' || !a) return null;
  if (a.primaryAmId === scope.userId) return 'PRIMARY';
  if (a.backupAmId === scope.userId) return 'BACKUP';
  return null;
}

/** The agency pages hold its contacts and where its logins are kept, so overseeing work isn't enough. */
async function agencyPagesOnly(db: Db, scope: DeskScope, ctx: GuardContext, op: string): Promise<void> {
  await managersOnly(db, scope, ctx, op);
  if (can(scope, 'accounts.view')) return;
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'access.denied', entityType: 'Agency', entityId: null,
    metadata: { scope: scope.kind, op, needs: ['accounts.view'] }, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  throw new DeskAccessError(404, 'Not found.');
}

/** The agencies this manager looks after, with their work at a glance. */
export async function managedAgencies(db: Db, scope: DeskScope, ctx: GuardContext = {}) {
  await agencyPagesOnly(db, scope, ctx, 'agencies');
  const f = workFilters(scope, new Date());
  const [agencies, accounts, openBy, overdueBy, waitingBy, reviewBy] = await Promise.all([
    db.agency.findMany({
      where: f.agencies,
      select: {
        id: true, name: true,
        deskAssignment: { select: { primaryAmId: true, backupAmId: true, primaryAm: PERSON, backupAm: PERSON } },
        deskPlan: { select: { managedAccountsOverride: true, plan: { select: { name: true, managedAccounts: true } } } },
      },
      orderBy: { name: 'asc' },
    }),
    db.insuredAccount.groupBy({ by: ['agencyId'], where: { status: 'ACTIVE', agency: { is: f.agencies } }, _count: { _all: true } }),
    db.task.groupBy({ by: ['agencyId'], where: f.open, _count: { _all: true } }),
    db.task.groupBy({ by: ['agencyId'], where: f.overdue, _count: { _all: true } }),
    db.task.groupBy({ by: ['agencyId'], where: f.waiting, _count: { _all: true } }),
    db.task.groupBy({ by: ['agencyId'], where: f.review, _count: { _all: true } }),
  ]);
  const [acc, open, overdue, waiting, review] = [accounts, openBy, overdueBy, waitingBy, reviewBy].map(countBy);
  return {
    agencies: agencies.map((a) => ({
      id: a.id, name: a.name,
      yourRole: roleOf(scope, a.deskAssignment),
      primaryAm: person(a.deskAssignment?.primaryAm)?.name ?? null,
      backupAm: person(a.deskAssignment?.backupAm)?.name ?? null,
      plan: a.deskPlan?.plan.name ?? null,
      activeAccounts: acc.get(a.id) ?? 0,
      includedAccounts: a.deskPlan ? resolveManagedAccounts(a.deskPlan.plan, a.deskPlan) : null,
      open: open.get(a.id) ?? 0, overdue: overdue.get(a.id) ?? 0, waitingOnAgency: waiting.get(a.id) ?? 0, review: review.get(a.id) ?? 0,
    })),
  };
}

/** One agency: who looks after it, how it is set up, its work at a glance and its renewals. */
export async function agencySummary(db: Db, scope: DeskScope, agencyId: string, ctx: GuardContext = {}) {
  await agencyPagesOnly(db, scope, ctx, 'agency');
  const inScope = isObjectId(agencyId) && (scope.kind === 'PLATFORM' || (scope.kind === 'ACCOUNT_MANAGER' && scope.agencyIds.includes(agencyId)));
  const agency = inScope
    ? await db.agency.findFirst({
        where: { id: agencyId, deskEnabled: true },
        select: {
          id: true, name: true, status: true, primaryEmail: true, phone: true, website: true, deskEnabledAt: true,
          amsSystem: true, amsSystemOther: true, deskInstructions: true, credentialVaultRef: true,
          deskAssignment: { select: { primaryAmId: true, backupAmId: true, primaryAm: PERSON, backupAm: PERSON } },
          deskPlan: { select: { startsOn: true, managedAccountsOverride: true, plan: { select: { name: true, managedAccounts: true } } } },
        },
      })
    : null;
  if (!agency) {
    // Another AM's agency, one with the Desk off, or no such agency: all look the same, and are logged.
    await recordAudit(db, {
      actor: { id: scope.userId, role: scope.role }, action: 'access.denied', entityType: 'Agency',
      entityId: isObjectId(agencyId) ? agencyId : null, agencyId: isObjectId(agencyId) ? agencyId : null,
      metadata: { scope: scope.kind, op: 'agency' }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    throw new DeskAccessError(404, 'Not found.');
  }

  const now = new Date();
  const f = workFilters(scope, now, AGENCY_RENEWAL_DAYS);
  const one = <T extends Record<string, unknown>>(w: T) => forAgency(w, agency.id);
  const [pods, activeAccounts, inactiveAccounts, open, overdue, dueSoon, waiting, review, unrouted, renewalsTotal, renewals] = await Promise.all([
    db.agencyPodAccess.findMany({ where: { agencyId: agency.id }, select: { userId: true, pod: { select: { id: true, name: true, isActive: true } } } }),
    db.insuredAccount.count({ where: { agencyId: agency.id, status: 'ACTIVE' } }),
    db.insuredAccount.count({ where: { agencyId: agency.id, status: 'INACTIVE' } }),
    db.task.count({ where: one(f.open) }),
    db.task.count({ where: one(f.overdue) }),
    db.task.count({ where: one(f.dueSoon) }),
    db.task.count({ where: one(f.waiting) }),
    db.task.count({ where: one(f.review) }),
    db.task.count({ where: one(f.unrouted) }),
    db.policy.count({ where: one(f.renewals) }),
    listRenewals(db, one(f.renewals), f.visible, f.today, AGENCY_RENEWAL_LIMIT),
  ]);

  // Pods that serve the agency: the whole pod, or only some of its people.
  const byPod = new Map<string, { id: string; name: string; isActive: boolean; wholePod: boolean; people: number }>();
  for (const row of pods) {
    const entry = byPod.get(row.pod.id) ?? { ...row.pod, wholePod: false, people: 0 };
    if (row.userId) entry.people += 1; else entry.wholePod = true;
    byPod.set(row.pod.id, entry);
  }

  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'agency.viewed', entityType: 'Agency', entityId: agency.id, agencyId: agency.id,
    metadata: { scope: scope.kind }, ...ctx,
  });

  return {
    id: agency.id, name: agency.name, status: agency.status,
    contact: { email: agency.primaryEmail, phone: agency.phone, website: agency.website },
    deskSince: agency.deskEnabledAt,
    yourRole: roleOf(scope, agency.deskAssignment),
    primaryAm: person(agency.deskAssignment?.primaryAm),
    backupAm: person(agency.deskAssignment?.backupAm),
    ams: amsDisplayName(agency.amsSystem, agency.amsSystemOther),
    instructions: agency.deskInstructions,
    credentialVaultRef: agency.credentialVaultRef,
    plan: agency.deskPlan
      ? { name: agency.deskPlan.plan.name, since: agency.deskPlan.startsOn.toISOString().slice(0, 10), includedAccounts: resolveManagedAccounts(agency.deskPlan.plan, agency.deskPlan) }
      : null,
    accounts: { active: activeAccounts, inactive: inactiveAccounts },
    pods: [...byPod.values()].sort((a, b) => a.name.localeCompare(b.name)),
    counts: { open, overdue, dueSoon, waitingOnAgency: waiting, review, unrouted },
    renewalDays: AGENCY_RENEWAL_DAYS,
    renewalsTotal,
    renewals,
  };
}
