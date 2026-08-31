/**
 * The modular section framework behind the proposal builder.
 *
 * A proposal is an ordered list of sections. Two kinds exist and they behave
 * differently, which is the main thing this module encodes:
 *
 *   CONTENT sections hold prose the agent writes (or AI drafts). Their text is
 *   stored on the proposal, so a sent proposal keeps the exact words it was sent
 *   with even if the underlying data later changes.
 *
 *   DATA sections render from the lead's live quote options at build time —
 *   the comparison table, the coverage breakdown. Storing their text would
 *   duplicate the source of truth; instead the proposal snapshots them only when
 *   it is sent (Phase 5).
 *
 * Sections can be reordered, retitled, and switched off, but the set of keys is
 * fixed: an unknown key in stored JSON is dropped rather than rendered.
 */

export type SectionKey =
  | 'agencyHeader'
  | 'clientInformation'
  | 'executiveSummary'
  | 'recommendation'
  | 'quoteOptions'
  | 'coverageBreakdown'
  | 'coverageConsiderations'
  | 'importantNotes'
  | 'nextSteps';

export type SectionKind = 'content' | 'data';

export interface ProposalSection {
  key: SectionKey;
  /** Heading shown to the insured. Editable — agencies word these differently. */
  title: string;
  enabled: boolean;
  /** Prose for content sections. Always null for data sections. */
  body: string | null;
}

interface SectionDefinition {
  key: SectionKey;
  kind: SectionKind;
  defaultTitle: string;
  /** Shown in the builder to explain what the section is for. */
  hint: string;
  /** Sections the proposal makes no sense without. */
  required: boolean;
  defaultBody?: string;
}

const MAX_TITLE = 120;
const MAX_BODY = 20_000;

export class SectionValidationError extends Error {}

/**
 * The nine sections from the specification, in their default order.
 *
 * Order matters: this is the reading order the insured experiences, and it
 * follows the shape of a proposal conversation — who we are, who you are, what
 * we found, what we advise, the detail, the caveats, what happens next.
 */
export const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    key: 'agencyHeader', kind: 'data', required: true,
    defaultTitle: 'Prepared By',
    hint: "Your agency's logo, name, and the agent's contact details.",
  },
  {
    key: 'clientInformation', kind: 'data', required: true,
    defaultTitle: 'Prepared For',
    hint: 'Insured name, business name, effective date, and proposal date.',
  },
  {
    key: 'executiveSummary', kind: 'content', required: false,
    defaultTitle: 'Executive Summary',
    hint: 'A short summary of the insurance program being presented.',
  },
  {
    key: 'recommendation', kind: 'data', required: false,
    defaultTitle: 'Our Recommendation',
    hint: 'The option you recommended and the reasoning behind it.',
  },
  {
    key: 'quoteOptions', kind: 'data', required: true,
    defaultTitle: 'Your Options',
    hint: 'Side-by-side comparison of every option.',
  },
  {
    key: 'coverageBreakdown', kind: 'data', required: false,
    defaultTitle: 'What Your Coverage Does',
    hint: 'Plain-language explanation of each important coverage.',
  },
  {
    key: 'coverageConsiderations', kind: 'content', required: false,
    defaultTitle: 'Worth Considering',
    hint: 'Additional coverages worth discussing that are not in these quotes.',
  },
  {
    key: 'importantNotes', kind: 'content', required: false,
    defaultTitle: 'Important Notes',
    hint: 'Exclusions, assumptions, or conditions the insured should know about.',
  },
  {
    key: 'nextSteps', kind: 'content', required: true,
    defaultTitle: 'Next Steps',
    hint: 'How to select an option and approve it.',
    defaultBody:
      'Review the options above and select the one that best fits your business. ' +
      'Once you have chosen, sign electronically at the bottom of this page and we will ' +
      'take care of the rest. If anything is unclear, or you would like to talk an option ' +
      'through before deciding, get in touch — we would rather answer a question now than ' +
      'have you sign something you are unsure about.',
  },
];

const BY_KEY = new Map(SECTION_DEFINITIONS.map((d) => [d.key, d]));

export function sectionDefinition(key: SectionKey): SectionDefinition | undefined {
  return BY_KEY.get(key);
}

export function isContentSection(key: SectionKey): boolean {
  return BY_KEY.get(key)?.kind === 'content';
}

/** The starting layout for a new proposal — every section on, in spec order. */
export function defaultSections(): ProposalSection[] {
  return SECTION_DEFINITIONS.map((d) => ({
    key: d.key,
    title: d.defaultTitle,
    enabled: true,
    body: d.kind === 'content' ? (d.defaultBody ?? '') : null,
  }));
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Read stored section JSON into a usable list.
 *
 * Tolerant by design — the column is untyped Json and a malformed entry should
 * not blank an entire proposal. Unknown keys are dropped, duplicates collapse to
 * the first occurrence, and any section missing from storage is appended with
 * its defaults so a proposal saved before a new section existed still gets it.
 */
export function normalizeSections(raw: unknown): ProposalSection[] {
  const stored = Array.isArray(raw) ? raw : [];
  const out: ProposalSection[] = [];
  const seen = new Set<SectionKey>();

  for (const entry of stored) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const key = e.key as SectionKey;
    const def = BY_KEY.get(key);
    if (!def || seen.has(key)) continue;
    seen.add(key);

    out.push({
      key,
      title: text(e.title, MAX_TITLE) || def.defaultTitle,
      // A required section cannot be switched off, however it was stored.
      enabled: def.required ? true : e.enabled !== false,
      body: def.kind === 'content' ? text(e.body, MAX_BODY) : null,
    });
  }

  // Append anything the stored layout predates, keeping spec order among them.
  for (const def of SECTION_DEFINITIONS) {
    if (seen.has(def.key)) continue;
    out.push({
      key: def.key,
      title: def.defaultTitle,
      enabled: true,
      body: def.kind === 'content' ? (def.defaultBody ?? '') : null,
    });
  }

  return out;
}

/**
 * Validate sections submitted by the builder. Throws so the agent gets told
 * what is wrong rather than having a bad layout silently coerced.
 */
export function parseSectionInput(raw: unknown): ProposalSection[] {
  if (!Array.isArray(raw)) throw new SectionValidationError('Sections must be a list');
  if (raw.length > SECTION_DEFINITIONS.length) {
    throw new SectionValidationError('Unexpected number of sections');
  }

  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      throw new SectionValidationError('Each section must be an object');
    }
    const key = (entry as Record<string, unknown>).key;
    if (typeof key !== 'string' || !BY_KEY.has(key as SectionKey)) {
      throw new SectionValidationError(`Unknown proposal section: ${String(key)}`);
    }
    if (seen.has(key)) throw new SectionValidationError(`Duplicate section: ${key}`);
    seen.add(key);

    const def = BY_KEY.get(key as SectionKey)!;
    if (def.required && (entry as Record<string, unknown>).enabled === false) {
      throw new SectionValidationError(`"${def.defaultTitle}" cannot be removed from a proposal`);
    }
    const body = (entry as Record<string, unknown>).body;
    if (body !== null && body !== undefined && typeof body !== 'string') {
      throw new SectionValidationError(`${def.defaultTitle}: body must be text`);
    }
    if (typeof body === 'string' && body.length > MAX_BODY) {
      throw new SectionValidationError(`${def.defaultTitle} is too long`);
    }
  }

  return normalizeSections(raw);
}

/** Only the enabled sections, in order — what the insured actually sees. */
export function visibleSections(sections: ProposalSection[]): ProposalSection[] {
  return sections.filter((s) => s.enabled);
}

/**
 * Sections that are switched on but have nothing in them. Surfaced in the
 * builder so an agent does not send a proposal with an empty heading.
 */
export function emptyContentSections(sections: ProposalSection[]): ProposalSection[] {
  return sections.filter(
    (s) => s.enabled && isContentSection(s.key) && (s.body ?? '').trim() === ''
  );
}
