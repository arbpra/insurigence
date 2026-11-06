/**
 * Desk setup for one agency (client answers Q1, Q6): turning The Desk on,
 * primary / backup Account Manager, AMS profile and plan with allowance
 * overrides. The only code that changes these settings; every save is one
 * transaction and one audit entry. Super Admin and Operations Managers only.
 *
 * Audit entries list which fields changed, never the instructions or the
 * password-vault pointer themselves.
 */
import { Prisma, type AmsSystem, type PrismaClient, type ServiceCategory } from '@prisma/client';
import { literal } from './literal-match';
import { DeskAccessError, isObjectId, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { classifyPendingBilling } from './billing-capture';
import { SERVICE_CATEGORY_LABELS } from './billing';
import { AMS_SYSTEM_LABELS, looksLikeCredential } from './profile';
import { BILLING_UNCLASSIFIED, CLOSED_STATUSES } from './task-filters';

type Db = PrismaClient;

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const AMS_SYSTEMS = Object.keys(AMS_SYSTEM_LABELS) as AmsSystem[];
const CATEGORIES = Object.keys(SERVICE_CATEGORY_LABELS) as ServiceCategory[];
const MAX_UNITS = 100_000;
const MAX_PRICE_CENTS = 100_000_000; // $1,000,000 a month: anything above is a typing error
const OPEN_TASK = { status: { notIn: [...CLOSED_STATUSES] } };

const bad = (message: string) => new DeskAccessError(400, message);

export function assertDeskPlatform(scope: DeskScope): void {
  if (scope.kind !== 'PLATFORM') throw new DeskAccessError(403, 'Only Insurigence admins can change Desk setup.');
}

// ── Reading ──

const personName = (u: { firstName: string | null; lastName: string | null; email: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
const PERSON = { id: true, firstName: true, lastName: true, email: true, isActive: true } as const;

export interface DeskAgencyRow {
  id: string;
  name: string;
  status: string;
  deskEnabled: boolean;
  primaryAm: string | null;
  backupAm: string | null;
  plan: string | null;
  ams: AmsSystem | null;
  amsOther: string | null;
}

/** Every agency, Desk on or off, for the setup list. */
export async function listDeskAgencies(
  db: Db, scope: DeskScope, opts: { q?: string; desk?: 'on' | 'off' } = {}
): Promise<DeskAgencyRow[]> {
  assertDeskPlatform(scope);
  const q = opts.q?.trim();
  const rows = await db.agency.findMany({
    where: {
      ...(q ? { name: { contains: literal(q), mode: 'insensitive' as const } } : {}),
      ...(opts.desk ? { deskEnabled: opts.desk === 'on' } : {}),
    },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, status: true, deskEnabled: true, amsSystem: true, amsSystemOther: true,
      deskAssignment: { select: { primaryAm: { select: PERSON }, backupAm: { select: PERSON } } },
      deskPlan: { select: { plan: { select: { name: true } } } },
    },
  });
  return rows.map((a) => ({
    id: a.id, name: a.name, status: a.status, deskEnabled: a.deskEnabled,
    primaryAm: a.deskAssignment?.primaryAm ? personName(a.deskAssignment.primaryAm) : null,
    backupAm: a.deskAssignment?.backupAm ? personName(a.deskAssignment.backupAm) : null,
    plan: a.deskPlan?.plan.name ?? null,
    ams: a.amsSystem, amsOther: a.amsSystemOther,
  }));
}

/** One agency's setup with the choices the form offers. Plain JSON. */
export async function getAgencySetup(db: Db, scope: DeskScope, agencyId: string) {
  assertDeskPlatform(scope);
  if (!isObjectId(agencyId)) throw new DeskAccessError(404, 'Not found');
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: {
      id: true, name: true, status: true, updatedAt: true,
      deskEnabled: true, deskEnabledAt: true, amsSystem: true, amsSystemOther: true, deskInstructions: true, credentialVaultRef: true,
      deskAssignment: { select: { primaryAm: { select: PERSON }, backupAm: { select: PERSON } } },
      deskPlan: { include: { allowanceOverrides: { select: { category: true, monthlyUnits: true } } } },
    },
  });
  if (!agency) throw new DeskAccessError(404, 'Not found');

  const [managers, plans, openTasks, podsAuthorized, pendingBilling] = await Promise.all([
    db.user.findMany({ where: { role: 'ACCOUNT_MANAGER', isActive: true }, select: PERSON, orderBy: [{ firstName: 'asc' }, { email: 'asc' }] }),
    db.deskPlan.findMany({
      where: { OR: [{ isActive: true }, ...(agency.deskPlan ? [{ id: agency.deskPlan.planId }] : [])] },
      orderBy: { sortOrder: 'asc' },
      include: { allowances: { select: { category: true, monthlyUnits: true } } },
    }),
    db.task.count({ where: { agencyId, ...OPEN_TASK } }),
    db.agencyPodAccess.count({ where: { agencyId } }),
    db.task.count({ where: { AND: [BILLING_UNCLASSIFIED, { agencyId, status: 'COMPLETED', nonBillable: false }] } }),
  ]);

  const person = (u: { id: string; firstName: string | null; lastName: string | null; email: string; isActive: boolean }) =>
    ({ id: u.id, name: personName(u), isActive: u.isActive });
  const primaryAm = agency.deskAssignment?.primaryAm ?? null;
  const backupAm = agency.deskAssignment?.backupAm ?? null;
  // A person assigned earlier and since deactivated stays visible so it can be replaced.
  const offered = [...managers, ...[primaryAm, backupAm].filter((u): u is NonNullable<typeof u> => !!u && !u.isActive)];

  const view = {
    id: agency.id, name: agency.name, status: agency.status,
    version: agency.updatedAt.toISOString(),
    deskEnabled: agency.deskEnabled,
    deskEnabledAt: agency.deskEnabledAt?.toISOString() ?? null,
    primaryAm: primaryAm && person(primaryAm),
    backupAm: backupAm && person(backupAm),
    amsSystem: agency.amsSystem,
    amsSystemOther: agency.amsSystemOther,
    deskInstructions: agency.deskInstructions,
    credentialVaultRef: agency.credentialVaultRef,
    plan: agency.deskPlan && {
      planId: agency.deskPlan.planId,
      startsOn: agency.deskPlan.startsOn.toISOString().slice(0, 10),
      monthlyPriceCents: agency.deskPlan.monthlyPriceCents === null ? null : Number(agency.deskPlan.monthlyPriceCents),
      managedAccountsOverride: agency.deskPlan.managedAccountsOverride,
      notes: agency.deskPlan.notes,
      overrides: agency.deskPlan.allowanceOverrides,
    },
    counts: { openTasks, podsAuthorized, pendingBilling },
    options: {
      accountManagers: offered.map(person),
      plans: plans.map((p) => ({
        id: p.id, name: p.name, monthlyPriceCents: Number(p.monthlyPriceCents), priceIsStartingAt: p.priceIsStartingAt,
        managedAccounts: p.managedAccounts, isActive: p.isActive, allowances: p.allowances,
      })),
    },
  };
  return { ...view, checklist: setupChecklist(view) };
}

export type AgencySetupView = Awaited<ReturnType<typeof getAgencySetup>>;

export interface ChecklistItem {
  key: 'am' | 'plan' | 'ams' | 'pods';
  label: string;
  done: boolean;
}

/** What an agency still needs. Advisory: none of it blocks turning The Desk on. */
export function setupChecklist(v: {
  primaryAm: { isActive: boolean } | null;
  plan: unknown;
  amsSystem: AmsSystem | null;
  counts: { podsAuthorized: number };
}): ChecklistItem[] {
  return [
    { key: 'am', label: 'Primary Account Manager assigned', done: !!v.primaryAm?.isActive },
    { key: 'plan', label: 'Plan selected', done: !!v.plan },
    { key: 'ams', label: 'AMS recorded', done: !!v.amsSystem },
    { key: 'pods', label: 'At least one pod authorized', done: v.counts.podsAuthorized > 0 },
  ];
}

// ── Validation ──

export interface PlanInput {
  planId: string;
  /** YYYY-MM-DD */
  startsOn: string;
  monthlyPriceCents?: number | null;
  managedAccountsOverride?: number | null;
  notes?: string | null;
  /** The whole set: a category left out uses the plan's allowance. monthlyUnits null = unlimited. */
  overrides?: { category: ServiceCategory; monthlyUnits: number | null }[];
}

/** Only the fields present are changed. */
export interface AgencySetupInput {
  /** The `version` the form was loaded with; a later save by someone else is refused. */
  version?: string;
  deskEnabled?: boolean;
  /** Required to turn The Desk off while the agency has open work. */
  confirmDisable?: boolean;
  primaryAmId?: string | null;
  backupAmId?: string | null;
  amsSystem?: AmsSystem | null;
  amsSystemOther?: string | null;
  deskInstructions?: string | null;
  credentialVaultRef?: string | null;
  plan?: PlanInput | null;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw bad(`${field} must be text.`);
  const t = value.trim();
  if (t.length > max) throw bad(`${field} must be ${max} characters or fewer.`);
  return t || null;
}

/** Refuses a value that reads like a password: credentials are never stored in The Desk. */
function noCredential(value: string | null): string | null {
  const reason = looksLikeCredential(value);
  if (reason) throw bad(reason);
  return value;
}

function wholeNumber(value: unknown, field: string, max: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) throw bad(`${field} must be a whole number from 0 to ${max.toLocaleString('en-US')}.`);
  return value;
}

function parseDay(value: unknown): Date {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) throw bad('Plan start date is required (YYYY-MM-DD).');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.toISOString().slice(0, 10) !== value) throw bad('Plan start date is not a real date.');
  return d;
}

function parseOverrides(value: unknown): { category: ServiceCategory; monthlyUnits: number | null }[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw bad('Allowance overrides must be a list.');
  const seen = new Set<string>();
  return value.map((row) => {
    const { category, monthlyUnits } = (row ?? {}) as { category?: unknown; monthlyUnits?: unknown };
    if (!CATEGORIES.includes(category as ServiceCategory)) throw bad('Unknown service category in allowance overrides.');
    if (seen.has(category as string)) throw bad('Each service category can have only one allowance override.');
    seen.add(category as string);
    return { category: category as ServiceCategory, monthlyUnits: wholeNumber(monthlyUnits, 'Monthly allowance', MAX_UNITS) };
  });
}

// ── Saving ──

export interface AgencySetupResult {
  setup: AgencySetupView;
  /** Things worth telling the admin about what the save left behind. */
  notices: string[];
}

/** Saves the fields present in `input`. See AgencySetupInput. */
export async function updateAgencySetup(
  db: Db, scope: DeskScope, agencyId: string, input: AgencySetupInput, ctx: GuardContext = {}
): Promise<AgencySetupResult> {
  assertDeskPlatform(scope);
  if (!isObjectId(agencyId)) throw new DeskAccessError(404, 'Not found');
  if (input.deskEnabled !== undefined && typeof input.deskEnabled !== 'boolean') throw bad('deskEnabled must be true or false.');

  const current = await db.agency.findUnique({
    where: { id: agencyId },
    select: {
      id: true, updatedAt: true, deskEnabled: true, amsSystem: true, amsSystemOther: true, deskInstructions: true, credentialVaultRef: true,
      deskAssignment: { select: { primaryAmId: true, backupAmId: true } },
      deskPlan: { include: { allowanceOverrides: { select: { category: true, monthlyUnits: true } } } },
    },
  });
  if (!current) throw new DeskAccessError(404, 'Not found');
  if (input.version !== undefined && input.version !== current.updatedAt.toISOString()) throw changedElsewhere();

  const changed: string[] = [];
  const metadata: Record<string, unknown> = {};
  const agencyData: Prisma.AgencyUpdateInput = {};
  const notices: string[] = [];

  // Turning The Desk on or off
  const turningOff = input.deskEnabled === false && current.deskEnabled;
  if (input.deskEnabled !== undefined && input.deskEnabled !== current.deskEnabled) {
    changed.push('deskEnabled');
    metadata.deskEnabled = { from: current.deskEnabled, to: input.deskEnabled };
    agencyData.deskEnabled = input.deskEnabled;
    agencyData.deskEnabledAt = input.deskEnabled ? new Date() : null;
  }
  if (turningOff && !input.confirmDisable) {
    const open = await db.task.count({ where: { agencyId, ...OPEN_TASK } });
    if (open > 0) throw new DeskAccessError(409, `This agency has ${open} open request${open === 1 ? '' : 's'}. Turning The Desk off removes them from every Desk queue. Confirm to continue.`);
  }

  // Account Managers
  const before = { primary: current.deskAssignment?.primaryAmId ?? null, backup: current.deskAssignment?.backupAmId ?? null };
  const after = {
    primary: input.primaryAmId !== undefined ? input.primaryAmId || null : before.primary,
    backup: input.backupAmId !== undefined ? input.backupAmId || null : before.backup,
  };
  if (after.primary && after.primary === after.backup) throw bad('The primary and backup Account Manager must be different people.');
  if (after.backup && !after.primary) throw bad('Choose a primary Account Manager before a backup.');
  const amsChanged = after.primary !== before.primary || after.backup !== before.backup;
  if (amsChanged) {
    // Only newly chosen people are checked, so someone deactivated later does
    // not stop an admin saving unrelated changes.
    for (const id of [after.primary !== before.primary ? after.primary : null, after.backup !== before.backup ? after.backup : null]) {
      if (id) await assertAccountManager(db, id);
    }
    changed.push('accountManagers');
    metadata.accountManagers = { from: before, to: after };
  }

  // AMS profile
  if (input.amsSystem !== undefined || input.amsSystemOther !== undefined) {
    if (input.amsSystem !== undefined && input.amsSystem !== null && !AMS_SYSTEMS.includes(input.amsSystem)) throw bad('Unknown AMS system.');
    const system = input.amsSystem !== undefined ? input.amsSystem : current.amsSystem;
    const other = system === 'OTHER'
      ? noCredential(optionalText(input.amsSystemOther !== undefined ? input.amsSystemOther : current.amsSystemOther, 'AMS name', 100))
      : null;
    if (system === 'OTHER' && !other) throw bad('Enter the name of the agency\'s AMS.');
    if (system !== current.amsSystem || other !== (current.amsSystemOther ?? null)) {
      agencyData.amsSystem = system;
      agencyData.amsSystemOther = other;
      changed.push('ams');
      metadata.ams = { from: current.amsSystem, to: system };
    }
  }
  if (input.deskInstructions !== undefined) {
    const text = noCredential(optionalText(input.deskInstructions, 'Instructions', 5000));
    if (text !== (current.deskInstructions ?? null)) {
      agencyData.deskInstructions = text;
      changed.push('deskInstructions');
    }
  }
  if (input.credentialVaultRef !== undefined) {
    const text = noCredential(optionalText(input.credentialVaultRef, 'Password-manager location', 300));
    if (text !== (current.credentialVaultRef ?? null)) {
      agencyData.credentialVaultRef = text;
      changed.push('credentialVaultRef');
    }
  }

  // Plan
  let planData: Omit<Prisma.AgencyDeskPlanUncheckedCreateInput, 'agencyId'> | null = null;
  let overrides: { category: ServiceCategory; monthlyUnits: number | null }[] = [];
  if (input.plan) {
    const p = input.plan;
    if (!isObjectId(p.planId)) throw bad('Choose a plan.');
    const plan = await db.deskPlan.findUnique({ where: { id: p.planId }, select: { isActive: true, priceIsStartingAt: true } });
    if (!plan) throw bad('Choose a plan.');
    if (!plan.isActive && p.planId !== current.deskPlan?.planId) throw bad('That plan is no longer offered.');
    const price = wholeNumber(p.monthlyPriceCents, 'Monthly price', MAX_PRICE_CENTS);
    if (plan.priceIsStartingAt && price === null) throw bad('This plan is priced per agency: enter the agreed monthly price.');
    planData = {
      planId: p.planId,
      startsOn: parseDay(p.startsOn),
      monthlyPriceCents: price === null ? null : BigInt(price),
      managedAccountsOverride: wholeNumber(p.managedAccountsOverride, 'Managed accounts', MAX_UNITS),
      notes: noCredential(optionalText(p.notes, 'Plan notes', 1000)),
    };
    overrides = parseOverrides(p.overrides);
    if (samePlan(current.deskPlan, planData, overrides)) {
      planData = null;
    } else {
      changed.push('plan');
      metadata.plan = { from: current.deskPlan?.planId ?? null, to: p.planId, overrides: overrides.length };
    }
  } else if (input.plan === null && current.deskPlan) {
    changed.push('plan');
    metadata.plan = { from: current.deskPlan.planId, to: null };
  }
  const planTouched = changed.includes('plan');

  if (changed.length === 0) return { setup: await getAgencySetup(db, scope, agencyId), notices };

  const effective = { before: before.primary ?? before.backup, after: after.primary ?? after.backup };

  try {
    await db.$transaction(async (tx) => {
      // Changes Agency.updatedAt on every save (Prisma sets it), so two saves
      // from the same loaded form cannot both succeed.
      const { count } = await tx.agency.updateMany({ where: { id: agencyId, updatedAt: current.updatedAt }, data: { ...(agencyData as Prisma.AgencyUpdateManyMutationInput), updatedAt: new Date() } });
      if (count !== 1) throw changedElsewhere();

      if (amsChanged) {
        await tx.agencyDeskAssignment.upsert({
          where: { agencyId },
          create: { agencyId, primaryAmId: after.primary, backupAmId: after.backup },
          update: { primaryAmId: after.primary, backupAmId: after.backup },
        });
        // Open work follows the agency's Account Manager, as new work does.
        if (effective.after !== effective.before) {
          const moved = await tx.task.updateMany({ where: { agencyId, ...OPEN_TASK }, data: { amId: effective.after } });
          metadata.openTasksMoved = moved.count;
        }
      }

      if (planData) {
        const saved = await tx.agencyDeskPlan.upsert({ where: { agencyId }, create: { agencyId, ...planData }, update: planData, select: { id: true } });
        await tx.agencyAllowanceOverride.deleteMany({ where: { agencyDeskPlanId: saved.id } });
        if (overrides.length) await tx.agencyAllowanceOverride.createMany({ data: overrides.map((o) => ({ agencyDeskPlanId: saved.id, ...o })) });
      } else if (planTouched) {
        const existing = await tx.agencyDeskPlan.findUnique({ where: { agencyId }, select: { id: true } });
        if (existing) {
          await tx.agencyAllowanceOverride.deleteMany({ where: { agencyDeskPlanId: existing.id } });
          await tx.agencyDeskPlan.delete({ where: { id: existing.id } });
        }
      }

      await recordAudit(tx, {
        actor: { id: scope.userId, role: scope.role },
        action: 'agency.desk_updated', entityType: 'Agency', entityId: agencyId, agencyId,
        metadata: { changed, ...metadata }, ip: ctx.ip, userAgent: ctx.userAgent,
      });
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') throw changedElsewhere();
    throw err;
  }

  // Someone removed as Account Manager loses sight of the agency's work, so
  // anything still assigned to them needs a new owner.
  const removed = [before.primary, before.backup].filter((id): id is string => !!id && id !== after.primary && id !== after.backup);
  if (removed.length) {
    const stranded = await db.task.count({ where: { agencyId, assigneeId: { in: removed }, ...OPEN_TASK } });
    if (stranded) notices.push(`${stranded} open request${stranded === 1 ? ' is' : 's are'} still assigned to the Account Manager you removed and should be reassigned.`);
  }

  // Work completed before this agency had an allowance can now be classified.
  // The save stands either way; a failure here can be retried by saving again.
  if (planData) {
    try {
      const { classified } = await classifyPendingBilling(db, { agencyId });
      if (classified) notices.push(`${classified} completed request${classified === 1 ? ' was' : 's were'} classified for billing against this plan.`);
    } catch (err) {
      console.error('[desk/agency-setup] billing classification failed', err);
      notices.push('Saved, but waiting work could not be classified for billing. Save again to retry.');
    }
  }

  return { setup: await getAgencySetup(db, scope, agencyId), notices };
}

function samePlan(
  stored: { planId: string; startsOn: Date; monthlyPriceCents: bigint | null; managedAccountsOverride: number | null; notes: string | null; allowanceOverrides: { category: ServiceCategory; monthlyUnits: number | null }[] } | null,
  next: Omit<Prisma.AgencyDeskPlanUncheckedCreateInput, 'agencyId'>,
  overrides: { category: ServiceCategory; monthlyUnits: number | null }[]
): boolean {
  if (!stored) return false;
  const units = (rows: { category: ServiceCategory; monthlyUnits: number | null }[]) =>
    JSON.stringify([...rows].sort((a, b) => a.category.localeCompare(b.category)).map((r) => [r.category, r.monthlyUnits]));
  return stored.planId === next.planId
    && stored.startsOn.getTime() === (next.startsOn as Date).getTime()
    && stored.monthlyPriceCents === (next.monthlyPriceCents ?? null)
    && stored.managedAccountsOverride === (next.managedAccountsOverride ?? null)
    && (stored.notes ?? null) === (next.notes ?? null)
    && units(stored.allowanceOverrides) === units(overrides);
}

const changedElsewhere = () => new DeskAccessError(409, 'Someone else just changed this agency. Reload to see their changes, then try again.');

async function assertAccountManager(db: Db, userId: string): Promise<void> {
  if (!isObjectId(userId)) throw bad('Choose an active Account Manager.');
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!user || user.role !== 'ACCOUNT_MANAGER' || !user.isActive) throw bad('Choose an active Account Manager.');
}
