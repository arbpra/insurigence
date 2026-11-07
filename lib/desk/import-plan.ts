/**
 * Working out what an import will do (client answer Q2): reading each row's dates,
 * premium and status, grouping rows into accounts with several policies, matching
 * producers to the agency's people, and spotting what's already in the book.
 *
 * Pure, so the preview and the commit run exactly the same rules. A row with an
 * error is left out whole and says why; it never goes in with a field missing,
 * because a lost expiration date would quietly lose a renewal.
 */
import { ACCOUNT_NAME_MAX, CONTACT_EMAIL_MAX, INSURED_TEXT } from './account-form';
import type { ColumnMapping, ImportFieldKey } from './import-fields';
import { insuredNameKey } from './insureds';
import { MAX_PREMIUM_CENTS, POLICY_TEXT, type PolicyStatusValue } from './policy-form';

// ── Reading one value ──

/** What exports put in an empty cell. */
const NOTHING = /^(-+|n\/?a|none|null)$/i;
const isNothing = (text: string) => !text.trim() || NOTHING.test(text.trim());

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthNumber = (word: string) => {
  const lower = word.toLowerCase();
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const index = full.findIndex((m, i) => m === lower || MONTHS[i] === lower || (i === 8 && lower === 'sept'));
  return index + 1;
};
const fullYear = (text: string) => {
  if (text.length !== 2) return Number(text);
  const yy = Number(text);
  return yy < 70 ? 2000 + yy : 1900 + yy;
};

const EARLIEST_YEAR = 1950;
const LATEST_YEAR = 2150;

/**
 * A date as YYYY-MM-DD, read month first as US exports write it, so 25/01/2027 is
 * an error rather than a guess. Worked out as text, so no time zone can move it.
 */
export function parseImportDate(text: string): { date: string | null } | { error: string } {
  if (isNothing(text)) return { date: null };
  const shown = text.trim();
  const t = shown.replace(/[ T]\d{1,2}:\d{2}.*$/, '');
  let year = 0, month = 0, dayOfMonth = 0;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t))) { year = +m[1]; month = +m[2]; dayOfMonth = +m[3]; }
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(t))) { month = +m[1]; dayOfMonth = +m[2]; year = fullYear(m[3]); }
  else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t))) { month = monthNumber(m[1]); dayOfMonth = +m[2]; year = +m[3]; }
  else if ((m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?[-\s](\d{4}|\d{2})$/.exec(t))) { dayOfMonth = +m[1]; month = monthNumber(m[2]); year = fullYear(m[3]); }
  else return { error: `"${shown}" isn't a date.` };
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
  const real = year >= EARLIEST_YEAR && year <= LATEST_YEAR && month >= 1 && month <= 12 && new Date(Date.UTC(year, month - 1, dayOfMonth)).toISOString().slice(0, 10) === iso;
  return real ? { date: iso } : { error: `"${shown}" isn't a real date.` };
}

/** Whole cents, worked out from the digits. Spreadsheets can hold more than two decimals, which round to the nearest cent. */
export function parseImportPremium(text: string): { cents: number | null } | { error: string } {
  if (isNothing(text)) return { cents: null };
  const shown = text.trim();
  const m = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*$/.exec(shown.replace(/^usd\s*|\s*usd$/gi, ''));
  if (!m) return { error: `"${shown}" isn't an amount in dollars.` };
  const dollars = m[1].replace(/,/g, '');
  const decimals = m[2] ?? '';
  const cents = Number(dollars) * 100 + Number(decimals.slice(0, 2).padEnd(2, '0')) + (Number(decimals[2] ?? 0) >= 5 ? 1 : 0);
  return cents > MAX_PREMIUM_CENTS ? { error: `"${shown}" is too large.` } : { cents };
}

const STATUS_WORDS: Record<string, PolicyStatusValue> = {
  active: 'ACTIVE', 'in force': 'ACTIVE', inforce: 'ACTIVE', bound: 'ACTIVE', current: 'ACTIVE', issued: 'ACTIVE', renewed: 'ACTIVE',
  pending: 'PENDING', quote: 'PENDING', quoted: 'PENDING', proposed: 'PENDING', submitted: 'PENDING', 'renewal pending': 'PENDING',
  expired: 'EXPIRED', lapsed: 'EXPIRED', 'non renewed': 'EXPIRED', nonrenewed: 'EXPIRED', 'not renewed': 'EXPIRED',
  cancelled: 'CANCELLED', canceled: 'CANCELLED', cancel: 'CANCELLED', 'flat cancel': 'CANCELLED', terminated: 'CANCELLED', void: 'CANCELLED', voided: 'CANCELLED',
};

/** A status this doesn't know is an error, not a guess: calling a cancelled policy active would start renewal work on it. */
export function parseImportStatus(text: string): { status: PolicyStatusValue | null } | { error: string } {
  if (isNothing(text)) return { status: null };
  const key = text.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const status = Object.prototype.hasOwnProperty.call(STATUS_WORDS, key) ? STATUS_WORDS[key] : null;
  return status ? { status } : { error: `"${text.trim()}" isn't a policy status The Desk knows. Use Active, Pending, Expired or Cancelled.` };
}

// ── Matching people ──

export interface ImportUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

const personKey = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export type ProducerMatch = { userId: string } | { unmatched: 'NOBODY' | 'SEVERAL' };

/** Finds someone by email, "Jane Smith" or "Smith, Jane". Two people with one name match neither: guessing would show an account to the wrong person. */
export function producerMatcher(users: ImportUser[]): (text: string) => ProducerMatch {
  const byEmail = new Map(users.map((u) => [u.email.trim().toLowerCase(), u.id]));
  const byName = new Map<string, Set<string>>();
  for (const u of users) {
    const key = personKey(`${u.firstName ?? ''} ${u.lastName ?? ''}`);
    if (key) byName.set(key, (byName.get(key) ?? new Set()).add(u.id));
  }
  return (text) => {
    const t = text.trim();
    const email = byEmail.get(t.toLowerCase());
    if (email) return { userId: email };
    const comma = /^([^,]+),\s*([^,]+)$/.exec(t);
    const found = byName.get(personKey(comma ? `${comma[2]} ${comma[1]}` : t));
    if (!found) return { unmatched: 'NOBODY' };
    return found.size === 1 ? { userId: [...found][0] } : { unmatched: 'SEVERAL' };
  };
}

// ── The plan ──

export type OnExisting = 'ADD' | 'SKIP';
export const isOnExisting = (value: unknown): value is OnExisting => value === 'ADD' || value === 'SKIP';

export interface ExistingAccount {
  id: string;
  name: string;
  nameKey: string;
  externalRef: string | null;
  status: string;
}

export interface ExistingPolicy {
  insuredId: string;
  policyNumber: string | null;
  lineOfBusiness: string | null;
  carrierName: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
}

export interface PlannedPolicy {
  rowNumber: number;
  policyNumber: string | null;
  lineOfBusiness: string | null;
  carrierName: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  premiumCents: number | null;
  status: PolicyStatusValue;
  notes: string | null;
  externalRef: string | null;
}

export interface PlannedAccount {
  /** Set when this goes onto an account already in the book, which is left as it is. */
  existingId: string | null;
  name: string;
  nameKey: string;
  fields: Record<string, string>;
  userIds: string[];
  policies: PlannedPolicy[];
  rowCount: number;
}

export type RowProblemKind = 'ERROR' | 'DUPLICATE' | 'WARNING';

export interface RowProblem {
  rowNumber: number;
  kind: RowProblemKind;
  name: string;
  messages: string[];
}

export interface PlanCounts {
  rows: number;
  blank: number;
  ready: number;
  errors: number;
  duplicates: number;
  warnings: number;
  accountsNew: number;
  /** Accounts in the file that are already in the book. */
  accountsExisting: number;
  policiesNew: number;
  policiesNoExpiration: number;
  assignments: number;
  /** New accounts nobody is assigned to, when a producer column was chosen. */
  accountsUnassigned: number;
}

export interface ImportPlan {
  /** Only what will be written: new accounts, and existing ones gaining a policy. */
  accounts: PlannedAccount[];
  problems: RowProblem[];
  unmatchedProducers: { name: string; rows: number }[];
  counts: PlanCounts;
}

export interface PlanInput {
  rows: { rowNumber: number; cells: string[] }[];
  headers: string[];
  mapping: ColumnMapping;
  existingAccounts: ExistingAccount[];
  existingPolicies: ExistingPolicy[];
  users: ImportUser[];
  onExisting: OnExisting;
  /** YYYY-MM-DD */
  today: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A report's closing line, not a client. */
const TOTAL_LINE = /^(grand\s+|sub\s*|report\s+)?totals?\s*:?$/i;
const ACCOUNT_TEXT_FIELDS = Object.keys(INSURED_TEXT) as (keyof typeof INSURED_TEXT & ImportFieldKey)[];
const MAX_UNMATCHED_SHOWN = 20;

interface ParsedRow {
  rowNumber: number;
  name: string;
  nameKey: string;
  ref: string | null;
  fields: Record<string, string>;
  producer: string;
  policy: Omit<PlannedPolicy, 'rowNumber'> | null;
  warnings: string[];
}

interface Group {
  name: string;
  nameKey: string;
  rows: ParsedRow[];
}

const lower = (text: string | null | undefined) => (text ?? '').trim().toLowerCase();
/** What makes a policy with no number the same as another. */
const unnumberedKey = (p: Pick<PlannedPolicy, 'lineOfBusiness' | 'carrierName' | 'effectiveDate' | 'expirationDate'>) =>
  JSON.stringify([lower(p.lineOfBusiness), lower(p.carrierName), p.effectiveDate ?? '', p.expirationDate ?? '']);

export function buildImportPlan(input: PlanInput): ImportPlan {
  const { mapping, headers, onExisting, today } = input;
  const columnOf = new Map<ImportFieldKey, number>();
  for (const [field, column] of Object.entries(mapping)) columnOf.set(field as ImportFieldKey, headers.indexOf(column as string));
  const mappedColumns = [...columnOf.values()];

  const counts: PlanCounts = {
    rows: input.rows.length, blank: 0, ready: 0, errors: 0, duplicates: 0, warnings: 0,
    accountsNew: 0, accountsExisting: 0, policiesNew: 0, policiesNoExpiration: 0, assignments: 0, accountsUnassigned: 0,
  };
  const problems: RowProblem[] = [];
  const parsed: ParsedRow[] = [];

  // ── Each row by itself ──
  for (const row of input.rows) {
    const cell = (field: ImportFieldKey) => {
      const index = columnOf.get(field);
      return index === undefined ? '' : String(row.cells[index] ?? '').trim();
    };
    if (mappedColumns.every((i) => !String(row.cells[i] ?? '').trim())) { counts.blank++; continue; }

    const errors: string[] = [];
    const warnings: string[] = [];
    const name = cell('name');
    if (!name) errors.push('It has no named insured.');
    else if (name.length > ACCOUNT_NAME_MAX) errors.push(`Named insured is longer than ${ACCOUNT_NAME_MAX} characters.`);

    const fields: Record<string, string> = {};
    for (const field of ACCOUNT_TEXT_FIELDS) {
      const value = cell(field);
      if (!value) continue;
      const rule = INSURED_TEXT[field];
      if (value.length > rule.max) errors.push(`${rule.label} is longer than ${rule.max.toLocaleString('en-US')} characters.`);
      else fields[field] = value;
    }
    const email = cell('contactEmail');
    if (email) {
      if (email.length <= CONTACT_EMAIL_MAX && EMAIL_RE.test(email)) fields.contactEmail = email.toLowerCase();
      else warnings.push(`Contact email "${email.slice(0, 80)}" isn't a valid address, so it's left blank.`);
    }

    const text = (field: ImportFieldKey, rule: { label: string; max: number }) => {
      const value = cell(field);
      if (value.length > rule.max) { errors.push(`${rule.label} is longer than ${rule.max.toLocaleString('en-US')} characters.`); return null; }
      return value || null;
    };
    const policyNumber = text('policyNumber', POLICY_TEXT.policyNumber);
    const lineOfBusiness = text('lineOfBusiness', POLICY_TEXT.lineOfBusiness);
    const carrierName = text('carrierName', POLICY_TEXT.carrierName);
    const notes = text('policyNotes', POLICY_TEXT.notes);
    const externalRef = text('policyRef', POLICY_TEXT.externalRef);
    const effective = parseImportDate(cell('effectiveDate'));
    const expiration = parseImportDate(cell('expirationDate'));
    const premium = parseImportPremium(cell('premium'));
    const status = parseImportStatus(cell('policyStatus'));
    if ('error' in effective) errors.push(`Effective date: ${effective.error}`);
    if ('error' in expiration) errors.push(`Expiration date: ${expiration.error}`);
    if ('error' in premium) errors.push(`Premium: ${premium.error}`);

    const effectiveDate = 'date' in effective ? effective.date : null;
    const expirationDate = 'date' in expiration ? expiration.date : null;
    const premiumCents = 'cents' in premium ? premium.cents : null;
    const namesPolicy = !!(policyNumber || lineOfBusiness || carrierName);
    // A status by itself may describe the client, so it doesn't make this a policy row.
    if (namesPolicy && 'error' in status) errors.push(`Policy status: ${status.error}`);
    if (!namesPolicy && (effectiveDate || expirationDate || premiumCents !== null || notes || externalRef)) {
      errors.push('It has policy details but no policy number, line of business or carrier, so nobody could tell which policy it is.');
    }
    if (effectiveDate && expirationDate && expirationDate <= effectiveDate) errors.push('Expiration date must be after the effective date.');
    if (name && !namesPolicy && TOTAL_LINE.test(name)) errors.push('This looks like a total line, not a client.');

    if (errors.length) {
      counts.errors++;
      problems.push({ rowNumber: row.rowNumber, kind: 'ERROR', name, messages: errors });
      continue;
    }

    let policy: ParsedRow['policy'] = null;
    if (namesPolicy) {
      const stated = 'status' in status ? status.status : null;
      const lapsed = !!expirationDate && expirationDate < today;
      if (!stated && lapsed) warnings.push('No status was given and its expiration date has passed, so it goes in as Expired.');
      if (stated === 'ACTIVE' && lapsed) warnings.push('It\'s marked active, but its expiration date has passed.');
      policy = { policyNumber, lineOfBusiness, carrierName, effectiveDate, expirationDate, premiumCents, status: stated ?? (lapsed ? 'EXPIRED' : 'ACTIVE'), notes, externalRef };
    }
    parsed.push({ rowNumber: row.rowNumber, name, nameKey: insuredNameKey(name), ref: fields.externalRef ?? null, fields, producer: cell('producer'), policy, warnings });
  }

  // ── Which rows are one account ──
  // A client code decides. A row with none joins the code its name goes with, if that's only one.
  const codesByName = new Map<string, Set<string>>();
  for (const r of parsed) if (r.ref) codesByName.set(r.nameKey, (codesByName.get(r.nameKey) ?? new Set()).add(lower(r.ref)));
  const groups = new Map<string, Group>();
  for (const r of parsed) {
    const codes = codesByName.get(r.nameKey);
    let key: string;
    if (r.ref) key = `code:${lower(r.ref)}`;
    else if (codes?.size === 1) key = `code:${[...codes][0]}`;
    else {
      key = `name:${r.nameKey}`;
      if (codes) r.warnings.push('Other rows give this name more than one client code, so this one, with no code, is treated as a separate account.');
    }
    const group = groups.get(key);
    if (group) {
      if (group.nameKey !== r.nameKey) r.warnings.push(`It has the same client code as "${group.name}", so it's treated as that account.`);
      group.rows.push(r);
    } else groups.set(key, { name: r.name, nameKey: r.nameKey, rows: [r] });
  }

  // ── What's already in the book ──
  const active = (list: ExistingAccount[]) => (list.some((a) => a.status === 'ACTIVE') ? list.filter((a) => a.status === 'ACTIVE') : list);
  const byCode = new Map<string, ExistingAccount[]>();
  const byNameKey = new Map<string, ExistingAccount[]>();
  for (const a of input.existingAccounts) {
    if (a.externalRef?.trim()) byCode.set(lower(a.externalRef), [...(byCode.get(lower(a.externalRef)) ?? []), a]);
    byNameKey.set(a.nameKey, [...(byNameKey.get(a.nameKey) ?? []), a]);
  }
  const accountName = new Map(input.existingAccounts.map((a) => [a.id, a.name]));
  const existingNumbers = new Map<string, Set<string>>();
  const numberOwners = new Map<string, string>();
  const existingUnnumbered = new Map<string, Set<string>>();
  for (const p of input.existingPolicies) {
    if (p.policyNumber?.trim()) {
      const n = lower(p.policyNumber);
      existingNumbers.set(p.insuredId, (existingNumbers.get(p.insuredId) ?? new Set()).add(n));
      numberOwners.set(n, p.insuredId);
    } else existingUnnumbered.set(p.insuredId, (existingUnnumbered.get(p.insuredId) ?? new Set()).add(unnumberedKey(p)));
  }

  const match = producerMatcher(input.users);
  const unmatched = new Map<string, number>();
  const accounts: PlannedAccount[] = [];
  const skipped = new Map<number, { row: ParsedRow; message: string }>();
  const numbersInFile = new Map<string, Group>();

  for (const group of groups.values()) {
    const code = group.rows.find((r) => r.ref)?.ref ?? null;
    let existing: ExistingAccount | null = null;
    let ambiguous = false;
    const codeMatches = code ? active(byCode.get(lower(code)) ?? []) : [];
    if (codeMatches.length === 1) existing = codeMatches[0];
    else if (codeMatches.length > 1) ambiguous = true;
    else {
      // The same name with a different client code is a different client.
      const sameName = active(byNameKey.get(group.nameKey) ?? []).filter((a) => !code || !a.externalRef?.trim());
      if (sameName.length === 1) existing = sameName[0];
      else if (sameName.length > 1) ambiguous = true;
      else if (code && byNameKey.has(group.nameKey)) group.rows[0].warnings.push('An account with this name is already in your book under a different client code, so this goes in as a new account.');
    }

    if (ambiguous) {
      for (const r of group.rows) skipped.set(r.rowNumber, { row: r, message: 'More than one account in your book could be this one, so it\'s left out. Add it by hand, or add client codes to tell them apart.' });
      continue;
    }
    if (existing) {
      counts.accountsExisting++;
      if (lower(existing.name) !== lower(group.name)) group.rows[0].warnings.push(`It's matched to "${existing.name}" in your book.`);
      if (existing.status !== 'ACTIVE') group.rows[0].warnings.push(`"${existing.name}" is inactive in your book, and stays inactive.`);
      if (onExisting === 'SKIP') {
        for (const r of group.rows) skipped.set(r.rowNumber, { row: r, message: `Already in your book as "${existing.name}", and you chose to leave those accounts out.` });
        continue;
      }
    }

    // The same policy twice: an export can list each past term, and renewal work needs the latest.
    const numbered = new Map<string, ParsedRow>();
    const unnumbered = new Set<string>();
    const kept: ParsedRow[] = [];
    for (const r of group.rows) {
      const p = r.policy;
      if (!p) continue;
      if (p.policyNumber) {
        const n = lower(p.policyNumber);
        const earlier = numbered.get(n);
        if (!earlier) { numbered.set(n, r); kept.push(r); continue; }
        const winner = (r.policy!.expirationDate ?? '') > (earlier.policy!.expirationDate ?? '') ? r : earlier;
        const loser = winner === r ? earlier : r;
        if (winner === r) { kept[kept.indexOf(earlier)] = r; numbered.set(n, r); }
        skipped.set(loser.rowNumber, { row: loser, message: `Policy ${p.policyNumber} is also on row ${winner.rowNumber}. The one with the later expiration date is kept.` });
      } else {
        const key = unnumberedKey(p);
        if (unnumbered.has(key)) { skipped.set(r.rowNumber, { row: r, message: 'The same policy is on an earlier row.' }); continue; }
        unnumbered.add(key);
        kept.push(r);
      }
    }

    const policies: PlannedPolicy[] = [];
    for (const r of kept) {
      const p = r.policy!;
      if (existing) {
        const already = p.policyNumber ? existingNumbers.get(existing.id)?.has(lower(p.policyNumber)) : existingUnnumbered.get(existing.id)?.has(unnumberedKey(p));
        if (already) { skipped.set(r.rowNumber, { row: r, message: `"${existing.name}" already has this policy.` }); continue; }
      }
      if (p.policyNumber) {
        const n = lower(p.policyNumber);
        const owner = numberOwners.get(n);
        const inFile = numbersInFile.get(n);
        if (owner && owner !== existing?.id) r.warnings.push(`Policy number ${p.policyNumber} is also on "${accountName.get(owner) ?? 'another account'}" in your book.`);
        else if (inFile && inFile !== group) r.warnings.push(`Policy number ${p.policyNumber} is also under "${inFile.name}" in this file.`);
        numbersInFile.set(n, group);
      }
      policies.push({ ...p, rowNumber: r.rowNumber });
      if (!p.expirationDate) counts.policiesNoExpiration++;
    }

    if (existing) {
      // An account row with nothing new to add.
      for (const r of group.rows) if (!r.policy && !skipped.has(r.rowNumber)) skipped.set(r.rowNumber, { row: r, message: `Already in your book as "${existing.name}", which is left as it is.` });
      if (!policies.length) continue;
      accounts.push({ existingId: existing.id, name: existing.name, nameKey: existing.nameKey, fields: {}, userIds: [], policies, rowCount: group.rows.length });
      counts.policiesNew += policies.length;
      continue;
    }

    // First value wins for each account field; a later row that disagrees says so.
    const fields: Record<string, string> = {};
    const firstRow = new Map<string, number>();
    for (const r of group.rows) {
      const differs: string[] = [];
      for (const [field, value] of Object.entries(r.fields)) {
        if (fields[field] === undefined) { fields[field] = value; firstRow.set(field, r.rowNumber); }
        else if (lower(fields[field]) !== lower(value)) differs.push(field === 'contactEmail' ? 'Contact email' : INSURED_TEXT[field].label);
      }
      if (differs.length) r.warnings.push(`${differs.join(', ')} differ from an earlier row for this account. The first one is used.`);
    }

    const userIds = new Set<string>();
    for (const r of group.rows) {
      if (!r.producer) continue;
      const found = match(r.producer);
      if ('userId' in found) { userIds.add(found.userId); continue; }
      r.warnings.push(found.unmatched === 'SEVERAL'
        ? `More than one person in your agency is called "${r.producer}", so nobody is assigned from this row.`
        : `"${r.producer}" isn't anyone active in your agency, so nobody is assigned from this row.`);
      unmatched.set(r.producer, (unmatched.get(r.producer) ?? 0) + 1);
    }

    accounts.push({ existingId: null, name: group.name, nameKey: group.nameKey, fields, userIds: [...userIds], policies, rowCount: group.rows.length });
    counts.accountsNew++;
    counts.policiesNew += policies.length;
    counts.assignments += userIds.size;
    if (columnOf.has('producer') && !userIds.size) counts.accountsUnassigned++;
  }

  // ── The rows' outcomes ──
  for (const { row, message } of skipped.values()) {
    counts.duplicates++;
    problems.push({ rowNumber: row.rowNumber, kind: 'DUPLICATE', name: row.name, messages: [message] });
  }
  for (const r of parsed) {
    if (skipped.has(r.rowNumber) || !r.warnings.length) continue;
    counts.warnings++;
    problems.push({ rowNumber: r.rowNumber, kind: 'WARNING', name: r.name, messages: r.warnings });
  }
  counts.ready = counts.rows - counts.blank - counts.errors - counts.duplicates;
  problems.sort((a, b) => a.rowNumber - b.rowNumber);

  const unmatchedProducers = [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_UNMATCHED_SHOWN).map(([name, rows]) => ({ name, rows }));
  return { accounts, problems, unmatchedProducers, counts };
}

// ── The template ──

/** A file that maps itself: every column name is one the mapping step already knows. */
export function importTemplateCsv(today: Date = new Date()): string {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const nextYear = new Date(Date.UTC(today.getUTCFullYear() + 1, today.getUTCMonth(), Math.min(today.getUTCDate(), 28)));
  const yearAfter = new Date(Date.UTC(today.getUTCFullYear() + 2, today.getUTCMonth(), Math.min(today.getUTCDate(), 28)));
  const header = ['Named Insured', 'DBA', 'Client Code', 'Contact Name', 'Contact Email', 'Contact Phone', 'Address', 'City', 'State', 'Zip', 'Producer', 'Policy Number', 'Line of Business', 'Carrier', 'Effective Date', 'Expiration Date', 'Premium', 'Policy Status'];
  const client = ['Example Plumbing LLC', 'Example Pipes', 'EX-1001', 'Sam Example', 'sam@example.com', '555-0100', '1 Example St', 'Exampleville', 'TX', '75001', ''];
  const rows = [
    header,
    [...client, 'EX-GL-1', 'General Liability', 'Example Carrier', iso(nextYear), iso(yearAfter), '1250.00', 'Active'],
    [...client, 'EX-AU-1', 'Commercial Auto', 'Example Carrier', iso(nextYear), iso(yearAfter), '3400.50', 'Active'],
    ['Example Bakery Inc', '', 'EX-1002', 'Pat Example', 'pat@example.com', '555-0101', '2 Example Ave', 'Exampleville', 'TX', '75001', '', '', '', '', '', '', '', ''],
  ];
  return `${rows.map((r) => r.join(',')).join('\r\n')}\r\n`;
}
