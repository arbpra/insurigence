/**
 * Messaging limits and wording. Pure — safe for server and browser.
 */

export const MESSAGE_MAX = 4_000;
/** The latest messages shown in a conversation; the total is always given. */
export const THREAD_LIMIT = 200;
/** Requests listed under "Conversations on requests". */
export const CONVERSATIONS_LIMIT = 15;

/** A one-line preview: whitespace collapsed, cut at 140 characters. */
export function snippet(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** "Today, 9:40 AM", "Yesterday, 4:05 PM" or "Nov 3, 2026, 9:40 AM", in the viewer's time zone. */
export function messageTime(at: string | Date, now: Date = new Date()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return `Today, ${time}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (day(d) === day(yesterday)) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${time}`;
}
