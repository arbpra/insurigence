/**
 * Follow-up rule titles (Module 39). Pure, so the admin editor previews a
 * title exactly as the engine will write it.
 *
 * A template may name the request it follows, as {reference}, and its account,
 * as {insured}. A title is internal: follow-ups are subtasks, which agencies
 * never see.
 */

export const FOLLOW_UP_TEMPLATE_MAX = 150;
/** As for any request (lib/desk/tasks.ts). */
const TITLE_MAX = 200;

export const FOLLOW_UP_PLACEHOLDERS = ['reference', 'insured'] as const;
export const FOLLOW_UP_PLACEHOLDER_HELP = '{reference} is the request number; {insured} is its account.';

/** What is wrong with a template, or null. */
export function templateProblem(template: string): string | null {
  const t = template.trim();
  if (!t) return 'Enter a title for the follow-up.';
  if (t.length > FOLLOW_UP_TEMPLATE_MAX) return `The title must be ${FOLLOW_UP_TEMPLATE_MAX} characters or fewer.`;
  for (const [, name] of t.matchAll(/\{([^{}]*)\}/g)) {
    if (!(FOLLOW_UP_PLACEHOLDERS as readonly string[]).includes(name)) return `{${name}} isn't something the title can include. ${FOLLOW_UP_PLACEHOLDER_HELP}`;
  }
  if (/[{}]/.test(t.replace(/\{(reference|insured)\}/g, ''))) return `Check the braces in the title. ${FOLLOW_UP_PLACEHOLDER_HELP}`;
  return null;
}

/** The follow-up's title for one request. A request with no account reads "no account". */
export function followUpTitle(template: string, request: { reference: number; insuredName: string | null }): string {
  const title = template.trim()
    .replace(/\{reference\}/g, String(request.reference))
    .replace(/\{insured\}/g, request.insuredName?.trim() || 'no account');
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}
