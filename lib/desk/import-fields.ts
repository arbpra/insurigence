/**
 * What an export's columns can be mapped to (client answer Q2), and the logic
 * for suggesting and checking a mapping. No imports, so the screen and the
 * server share one set of rules.
 *
 * A mapping is { field: column }. The keys come from this list and the values
 * are checked against the file, so a column called "__proto__" is only text.
 */

export type ImportFieldGroup = 'ACCOUNT' | 'POLICY';

interface FieldDefinition {
  key: string;
  label: string;
  group: ImportFieldGroup;
  required?: boolean;
  /** Column names this usually goes by, in the form columnKey() gives. */
  aliases: readonly string[];
}

export const IMPORT_FIELDS = [
  { key: 'name', label: 'Named insured', group: 'ACCOUNT', required: true, aliases: ['name', 'client', 'client name', 'insured', 'insured name', 'named insured', 'account', 'account name', 'customer', 'customer name', 'company name', 'business name'] },
  { key: 'dba', label: 'DBA name', group: 'ACCOUNT', aliases: ['dba', 'dba name', 'doing business as', 'trade name'] },
  { key: 'contactName', label: 'Contact name', group: 'ACCOUNT', aliases: ['contact', 'contact name', 'primary contact', 'insured contact'] },
  { key: 'contactEmail', label: 'Contact email', group: 'ACCOUNT', aliases: ['email', 'e mail', 'email address', 'contact email', 'primary email', 'client email', 'insured email'] },
  { key: 'contactPhone', label: 'Contact phone', group: 'ACCOUNT', aliases: ['phone', 'phone number', 'telephone', 'contact phone', 'main phone', 'business phone', 'primary phone', 'client phone'] },
  { key: 'website', label: 'Website', group: 'ACCOUNT', aliases: ['website', 'web site', 'url', 'web address'] },
  { key: 'addressLine1', label: 'Address', group: 'ACCOUNT', aliases: ['address', 'address 1', 'address1', 'address line 1', 'street', 'street address', 'mailing address', 'mailing address 1'] },
  { key: 'addressLine2', label: 'Address line 2', group: 'ACCOUNT', aliases: ['address 2', 'address2', 'address line 2', 'mailing address 2', 'suite', 'unit'] },
  { key: 'city', label: 'City', group: 'ACCOUNT', aliases: ['city', 'mailing city'] },
  { key: 'state', label: 'State', group: 'ACCOUNT', aliases: ['state', 'st', 'mailing state', 'province'] },
  { key: 'postalCode', label: 'Postal code', group: 'ACCOUNT', aliases: ['zip', 'zip code', 'zipcode', 'postal', 'postal code', 'mailing zip'] },
  { key: 'industry', label: 'Industry', group: 'ACCOUNT', aliases: ['industry', 'business type', 'type of business', 'class of business'] },
  { key: 'description', label: 'Description', group: 'ACCOUNT', aliases: ['description', 'business description', 'operations', 'description of operations'] },
  { key: 'notes', label: 'Account notes', group: 'ACCOUNT', aliases: ['notes', 'comments', 'account notes', 'client notes'] },
  { key: 'externalRef', label: 'AMS client code', group: 'ACCOUNT', aliases: ['client code', 'client id', 'client number', 'customer id', 'customer code', 'customer number', 'account id', 'account number', 'account code', 'ams code', 'lookup code', 'insured id', 'insured code'] },
  { key: 'producer', label: 'Assigned producer', group: 'ACCOUNT', aliases: ['producer', 'producer name', 'assigned producer', 'agent', 'agent name', 'account executive', 'ae'] },
  { key: 'policyNumber', label: 'Policy number', group: 'POLICY', aliases: ['policy', 'policy number', 'policy no', 'pol number', 'pol no', 'policy num'] },
  { key: 'lineOfBusiness', label: 'Line of business', group: 'POLICY', aliases: ['line', 'lob', 'line of business', 'lines of business', 'coverage', 'coverage type', 'policy type'] },
  { key: 'carrierName', label: 'Carrier', group: 'POLICY', aliases: ['carrier', 'carrier name', 'company', 'writing company', 'writing carrier', 'insurer', 'insurance company'] },
  { key: 'effectiveDate', label: 'Effective date', group: 'POLICY', aliases: ['effective', 'effective date', 'eff', 'eff date', 'policy effective', 'policy effective date', 'inception', 'inception date'] },
  { key: 'expirationDate', label: 'Expiration date', group: 'POLICY', aliases: ['expiration', 'expiration date', 'exp', 'exp date', 'expiry', 'expiry date', 'x date', 'xdate', 'policy expiration', 'policy expiration date', 'renewal date'] },
  { key: 'premium', label: 'Premium', group: 'POLICY', aliases: ['premium', 'annual premium', 'annualized premium', 'total premium', 'written premium', 'policy premium'] },
  { key: 'policyStatus', label: 'Policy status', group: 'POLICY', aliases: ['status', 'policy status'] },
  { key: 'policyNotes', label: 'Policy notes', group: 'POLICY', aliases: ['policy notes', 'policy comments'] },
  { key: 'policyRef', label: 'AMS policy code', group: 'POLICY', aliases: ['policy id', 'policy code', 'policy ref', 'policy reference', 'ams policy id'] },
] as const satisfies readonly FieldDefinition[];

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]['key'];
export type ColumnMapping = Partial<Record<ImportFieldKey, string>>;

const FIELD_KEYS: ReadonlySet<string> = new Set(IMPORT_FIELDS.map((f) => f.key));
export const isImportField = (value: unknown): value is ImportFieldKey => typeof value === 'string' && FIELD_KEYS.has(value);
export const importFieldLabel = (key: ImportFieldKey) => IMPORT_FIELDS.find((f) => f.key === key)!.label;

/** "Policy #" and "policy  number" compare as the same column. */
export function columnKey(column: string): string {
  return column.toLowerCase().replace(/#/g, ' number ').replace(/[^a-z0-9]+/g, ' ').trim();
}

const GUESSES = new Map<string, ImportFieldKey>(IMPORT_FIELDS.flatMap((f) => f.aliases.map((a) => [a, f.key] as [string, ImportFieldKey])));
export const guessField = (column: string): ImportFieldKey | null => GUESSES.get(columnKey(column)) ?? null;

// ── Remembering choices for the next upload ──

/** One decision about a column name. A null field: this agency doesn't import that column. */
export interface ColumnMemoryEntry {
  column: string;
  field: ImportFieldKey | null;
}

export const MAX_COLUMN_MEMORY = 500;
const GENERATED_NAME = /^column [a-z]+( \d+)?$/;

/**
 * "Column B" only says where a column with no name sat in one file, so it isn't
 * remembered. It's also what a password column becomes (see screenCredentials).
 */
const worthRemembering = (key: string) => !!key && !GENERATED_NAME.test(key);

/** What's stored, trusted only as far as it checks out. */
export function parseColumnMemory(stored: unknown): ColumnMemoryEntry[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry) => {
    const { column, field } = (entry ?? {}) as { column?: unknown; field?: unknown };
    return typeof column === 'string' && (field === null || isImportField(field)) ? [{ column, field }] : [];
  });
}

/**
 * This batch's choices over the agency's earlier ones. A column left out is only
 * remembered if it would otherwise be suggested again, so a stray client name
 * from a wrongly chosen header row isn't kept in here.
 */
export function mergeColumnMemory(previous: ColumnMemoryEntry[], headers: string[], mapping: ColumnMapping): ColumnMemoryEntry[] {
  const fieldOf = new Map<string, ImportFieldKey>();
  for (const [field, column] of Object.entries(mapping)) fieldOf.set(column as string, field as ImportFieldKey);
  const decided = new Set<string>();
  const fresh: ColumnMemoryEntry[] = [];
  for (const header of headers) {
    const key = columnKey(header);
    if (!worthRemembering(key) || decided.has(key)) continue;
    decided.add(key);
    const field = fieldOf.get(header) ?? null;
    if (field || guessField(header)) fresh.push({ column: key, field });
  }
  return [...fresh, ...previous.filter((e) => !decided.has(e.column))].slice(0, MAX_COLUMN_MEMORY);
}

// ── Suggesting ──

export type MappingSource = 'saved' | 'remembered' | 'guessed' | null;

export interface MappedColumn {
  column: string;
  field: ImportFieldKey | null;
  source: MappingSource;
}

/** What this agency chose before comes first, then what the column's name suggests. A field goes to one column. */
export function suggestColumns(headers: string[], memory: ColumnMemoryEntry[]): MappedColumn[] {
  const remembered = new Map(memory.map((e) => [e.column, e.field]));
  const taken = new Set<ImportFieldKey>();
  const out: MappedColumn[] = headers.map((column) => ({ column, field: null, source: null }));
  for (const c of out) {
    const key = columnKey(c.column);
    if (!remembered.has(key)) continue;
    const field = remembered.get(key)!;
    if (field === null) c.source = 'remembered';
    else if (!taken.has(field)) { taken.add(field); c.field = field; c.source = 'remembered'; }
  }
  for (const c of out) {
    if (c.source) continue;
    const field = guessField(c.column);
    if (field && !taken.has(field)) { taken.add(field); c.field = field; c.source = 'guessed'; }
  }
  return out;
}

export function columnsFromMapping(headers: string[], mapping: ColumnMapping): MappedColumn[] {
  const fieldOf = new Map<string, ImportFieldKey>();
  for (const [field, column] of Object.entries(mapping)) fieldOf.set(column as string, field as ImportFieldKey);
  return headers.map((column) => ({ column, field: fieldOf.get(column) ?? null, source: fieldOf.has(column) ? 'saved' : null }));
}

export function mappingFromColumns(columns: MappedColumn[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const c of columns) if (c.field) mapping[c.field] = c.column;
  return mapping;
}

/** Gives a column a field. A field goes to one column, so one already holding it lets go. */
export function assignField(columns: MappedColumn[], column: string, field: ImportFieldKey | null): MappedColumn[] {
  return columns.map((c) => {
    if (c.column === column) return { ...c, field, source: null };
    return field && c.field === field ? { ...c, field: null, source: null } : c;
  });
}

// ── Checking ──

/** Reasons a mapping can't be used. Written for the person choosing. */
export function validateMapping(input: unknown, headers: string[]): { mapping: ColumnMapping; errors: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { mapping: {}, errors: ['Choose which columns to import.'] };
  const known = new Set(headers);
  const usedBy = new Map<string, string>();
  const mapping: ColumnMapping = {};
  const errors: string[] = [];
  for (const [field, column] of Object.entries(input)) {
    if (!isImportField(field)) { errors.push('One of the fields chosen is not one The Desk knows.'); continue; }
    const label = importFieldLabel(field);
    if (typeof column !== 'string' || !known.has(column)) { errors.push(`${label}: that column is not in this file.`); continue; }
    const other = usedBy.get(column);
    if (other) { errors.push(`The column "${column}" can't be both ${other} and ${label}.`); continue; }
    usedBy.set(column, label);
    mapping[field] = column;
  }
  for (const f of IMPORT_FIELDS.filter((d) => 'required' in d && d.required)) {
    if (!mapping[f.key] && !errors.some((e) => e.startsWith(`${f.label}:`))) errors.push(`Choose the column that holds the ${f.label.toLowerCase()}. Every account needs one.`);
  }
  return { mapping, errors };
}

/** Worth knowing, but allowed: Q2 allows files with no policies, and Q2 calls expiration dates key. */
export function mappingNotes(mapping: ColumnMapping): string[] {
  const policyFields = IMPORT_FIELDS.filter((f) => f.group === 'POLICY' && mapping[f.key]);
  if (!policyFields.length) return ['No policy columns are chosen, so this will add accounts only.'];
  return mapping.expirationDate ? [] : ['No expiration date is chosen. Renewal work relies on it.'];
}

// ── Showing ──

/** A few values from a column, to recognise it by. */
export function sampleValues(rows: { cells: string[] }[], columnIndex: number, howMany = 3): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = (row.cells[columnIndex] ?? '').trim();
    if (value) seen.add(value);
    if (seen.size >= howMany) break;
  }
  return [...seen];
}

export function importStatusLabel(status: string, mapped: boolean): string {
  if (status === 'STAGED') return mapped ? 'Columns chosen' : 'Choose columns';
  if (status === 'COMMITTED') return 'Imported';
  if (status === 'UNDONE') return 'Undone';
  return 'Didn\'t finish';
}
