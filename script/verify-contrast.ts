/**
 * Finds white (or near-white) text sitting on a light background.
 *
 * Parses JSX at TAG level (a tag's className and style often sit on different
 * lines), tracks an ancestor stack by indentation, and treats gradients and
 * background images as "unknown" so their descendants are not falsely flagged.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const TW_BG: Record<string, string> = {
  'bg-white': '#ffffff',
  'bg-gray-50': '#f9fafb', 'bg-gray-100': '#f3f4f6', 'bg-gray-200': '#e5e7eb',
  'bg-gray-300': '#d1d5db', 'bg-gray-400': '#9ca3af', 'bg-gray-500': '#6b7280',
  'bg-gray-600': '#4b5563', 'bg-gray-700': '#374151', 'bg-gray-800': '#1f2937',
  'bg-gray-900': '#111827', 'bg-gray-950': '#030712',
  'bg-slate-50': '#f8fafc', 'bg-slate-100': '#f1f5f9', 'bg-slate-200': '#e2e8f0',
  'bg-slate-300': '#cbd5e1', 'bg-slate-700': '#334155', 'bg-slate-800': '#1e293b',
  'bg-slate-900': '#0f172a',
  'bg-green-50': '#f0fdf4', 'bg-green-100': '#dcfce7', 'bg-green-500': '#22c55e',
  'bg-green-600': '#16a34a', 'bg-green-700': '#15803d',
  'bg-red-50': '#fef2f2', 'bg-red-100': '#fee2e2', 'bg-red-500': '#ef4444',
  'bg-red-600': '#dc2626', 'bg-red-700': '#b91c1c',
  'bg-amber-50': '#fffbeb', 'bg-amber-100': '#fef3c7', 'bg-amber-500': '#f59e0b',
  'bg-amber-600': '#d97706',
  'bg-yellow-50': '#fefce8', 'bg-yellow-100': '#fef9c3', 'bg-yellow-500': '#eab308',
  'bg-blue-50': '#eff6ff', 'bg-blue-100': '#dbeafe', 'bg-blue-500': '#3b82f6',
  'bg-blue-600': '#2563eb', 'bg-blue-700': '#1d4ed8', 'bg-blue-900': '#1e3a8a',
  'bg-indigo-600': '#4f46e5', 'bg-emerald-500': '#10b981', 'bg-emerald-600': '#059669',
  'bg-teal-500': '#14b8a6', 'bg-purple-600': '#9333ea',
  'bg-black': '#000000',
};

const UNKNOWN = 'UNKNOWN';

function lum(hex: string): number {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return NaN;
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

function isTint(hex: string): boolean {
  const h = hex.replace('#', '');
  return h.length === 8 && parseInt(h.slice(6, 8), 16) < 64;
}

/** Background this tag declares: a hex, UNKNOWN (image/gradient/dynamic), or null. */
function tagBg(tag: string): string | null {
  if (/bg-gradient|backgroundImage|bg-\[url\(|bg-cover|bg-\[image:/.test(tag)) return UNKNOWN;
  // `background:` shorthand also beats a Tailwind bg class. Parse rgb() where we
  // can; anything else (gradient, url, dynamic) is unresolvable.
  const shorthandRgb = tag.match(/(?<![A-Za-z])background:\s*['"`]rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (shorthandRgb) {
    return '#' + [1, 2, 3].map((i) => Number(shorthandRgb[i]).toString(16).padStart(2, '0')).join('');
  }
  const shorthandHex = tag.match(/(?<![A-Za-z])background:\s*['"`](#[0-9a-fA-F]{3,8})['"`]/);
  if (shorthandHex) return shorthandHex[1];
  if (/(?<![A-Za-z])background:/.test(tag)) return UNKNOWN;
  // A conditional className picks a background at runtime.
  if (/\?[^:]*\bbg-[a-z[]/.test(tag) || /:\s*['"`][^'"`]*\bbg-[a-z[]/.test(tag)) return UNKNOWN;
  // A dynamic value we cannot resolve statically.
  if (/backgroundColor:\s*[^'"`\s]/.test(tag) && !/backgroundColor:\s*['"`]#/.test(tag)) return UNKNOWN;

  // Inline styles beat Tailwind classes, so check them first and in full.
  const rgb = tag.match(
    /backgroundColor:\s*['"`]rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*(?:[,/]\s*([\d.]+))?/
  );
  if (rgb) {
    // A translucent fill sits over whatever is behind it - unresolvable here.
    if (rgb[4] !== undefined && parseFloat(rgb[4]) < 0.9) return UNKNOWN;
    return (
      '#' + [1, 2, 3].map((i) => Number(rgb[i]).toString(16).padStart(2, '0')).join('')
    );
  }

  const cssVar = tag.match(/backgroundColor:\s*['"`]var\(\s*(--[\w-]+)/);
  if (cssVar) {
    const TOKENS: Record<string, string> = {
      '--brand-primary': '#0D2137',
      '--brand-accent': '#00E6A7',
      '--brand-accent-dark': '#00C992',
      '--brand-accent-text': '#00805F',
      '--brand-background': '#F5F7FA',
    };
    return TOKENS[cssVar[1]] ?? UNKNOWN;
  }

  const inline = tag.match(/backgroundColor:\s*['"`](#[0-9a-fA-F]{3,8})['"`]/);
  if (inline) return isTint(inline[1]) ? null : inline[1];

  // Any other inline background we cannot resolve.
  if (/backgroundColor:/.test(tag)) return UNKNOWN;

  const arb = tag.match(/\bbg-\[(#[0-9a-fA-F]{3,8})\]/);
  if (arb) return isTint(arb[1]) ? null : arb[1];

  // Semi-transparent Tailwind bg (bg-white/10) sits over whatever is behind it.
  if (/\bbg-(white|black|gray-\d+|slate-\d+)\/\d+/.test(tag)) return UNKNOWN;

  for (const cls of Object.keys(TW_BG)) {
    if (new RegExp(`(^|[\\s"'\`{])${cls}([\\s"'\`}]|$)`).test(tag)) return TW_BG[cls];
  }
  return null;
}

function whiteText(tag: string): boolean {
  return (
    /\btext-white\b/.test(tag) ||
    /\btext-white\/\d+/.test(tag) ||
    // Lowercase `color:` only, and not the tail of `backgroundColor:`.
    /(?<![A-Za-z])color:\s*['"`](#fff|#ffffff|white)['"`]/.test(tag) ||
    /\btext-\[#(fff|ffffff)\]/i.test(tag)
  );
}

/**
 * Any EXPLICIT foreground colour this tag sets, white or not. Catches the same
 * bug in its other form: a pale brand colour used as text on a pale ground.
 */
function fgColor(tag: string): string | null {
  if (whiteText(tag)) return '#ffffff';
  const inline = tag.match(/(?<![A-Za-z])color:\s*['"`](#[0-9a-fA-F]{3,8})['"`]/);
  if (inline) return inline[1];
  const arb = tag.match(/\btext-\[(#[0-9a-fA-F]{3,8})\]/);
  if (arb) return arb[1];
  return null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Group lines into logical JSX tags: a tag opening line plus its continuations. */
function tags(lines: string[]): { start: number; end: number; indent: number; text: string }[] {
  const out: { start: number; end: number; indent: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/<[A-Za-z]/.test(line)) continue;
    const indent = line.search(/\S/);
    let text = line;
    let j = i;
    // Keep absorbing lines until the tag closes, capped so we never run away.
    while (j < lines.length - 1 && !/\/?>\s*$/.test(lines[j].trimEnd()) && j - i < 12) {
      j++;
      text += ' ' + lines[j];
    }
    out.push({ start: i + 1, end: j + 1, indent, text });
  }
  return out;
}

const NAVY = '#0D2137';

/** Replace white foregrounds with navy on one line. Leaves hover/focus variants alone. */
function repaint(line: string): string {
  if (/^\s*(\{\s*)?\/\*/.test(line)) return line; // commented-out JSX
  return line
    .replace(/(?<!hover:|focus:|group-hover:|active:)\btext-white\/(\d+)/g, `text-[${NAVY}]/$1`)
    .replace(/(?<!hover:|focus:|group-hover:|active:)\btext-white\b/g, `text-[${NAVY}]`)
    .replace(
      /(?<![A-Za-z])color:(\s*)['"`](?:#fff|#ffffff|white)['"`]/g,
      `color:$1'${NAVY}'`
    );
}

const FIX = process.argv.includes('--fix');
const findings: { file: string; line: number; bg: string; r: number; text: string }[] = [];
let changedLines = 0;
const changedFiles = new Set<string>();

for (const file of walk('app')) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const stack: { indent: number; bg: string }[] = [];
  const toFix: number[] = []; // 0-based line indices

  for (const t of tags(lines)) {
    while (stack.length && stack[stack.length - 1].indent >= t.indent) stack.pop();
    const own = tagBg(t.text);

    const fg = fgColor(t.text);
    if (fg) {
      const bg = own ?? (stack.length ? stack[stack.length - 1].bg : null);
      if (bg && bg !== UNKNOWN) {
        const r = ratio(fg, bg);
        if (r < 3) {
          findings.push({
            file, line: t.start, bg: `${fg} on ${bg}`, r,
            text: t.text.replace(/\s+/g, ' ').trim().slice(0, 90),
          });
          for (let k = t.start - 1; k <= t.end - 1; k++) toFix.push(k);
        }
      }
    }
    if (own) stack.push({ indent: t.indent, bg: own });
  }

  if (FIX && toFix.length) {
    let touched = false;
    for (const k of new Set(toFix)) {
      const next = repaint(lines[k]);
      if (next !== lines[k]) {
        lines[k] = next;
        changedLines++;
        touched = true;
      }
    }
    if (touched) {
      writeFileSync(file, lines.join('\n'));
      changedFiles.add(file);
    }
  }
}

if (FIX) {
  console.log(`FIX MODE: repainted ${changedLines} lines across ${changedFiles.size} files\n`);
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

console.log(`${findings.length} high-confidence white-on-light findings\n`);
let last = '';
for (const f of findings) {
  if (f.file !== last) {
    console.log(`\n--- ${f.file.replace(/\\/g, '/')}`);
    last = f.file;
  }
  console.log(`  ${String(f.line).padStart(4)}  on ${f.bg.padEnd(9)} ${f.r.toFixed(2)}:1`);
  console.log(`        ${f.text}`);
}
