/**
 * Module 45: a walkthrough of the four views' pages on a running server, as
 * each demo person, signed in through the real login.
 *
 *   BASE_URL=http://localhost:3100 npx tsx script/walkthrough-desk-demo.ts
 *
 * Seeds its own copy of the demo on its own domain, so a demo being shown is
 * never touched, and removes it at the end. For each person:
 *  - every page in their sidebar opens (200) without an error page, and the
 *    detail pages (a request, an account, an agency) do too;
 *  - the sidebar holds exactly the items their role may use;
 *  - another area's pages send them away instead of opening.
 * The pages load their data in the browser, from the API routes, which
 * script/verify-desk-demo.ts checks as the same people.
 * Not named verify-*: it needs a server, so the regression run skips it.
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { demoPassword, findDemo, removeDemo, seedDemo } from '../lib/desk/demo';
import { DESK_NAV, navFor, type DeskArea } from '../lib/desk/navigation';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';
const BASE = process.env.BASE_URL?.replace(/\/$/, '');
if (!BASE) { console.error('Set BASE_URL to a running server.'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail?: unknown) => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
};
const DOMAIN = `m45walk${Date.now()}.invalid`;
const PASSWORD = demoPassword();
// ("This page could not be found" is in every page's payload, as the not-found template: a missing page is a 404 instead.)
const ERROR_PAGE = /Application error|Internal Server Error|__next_error__|Unhandled Runtime Error/;
/** The page's text, without scripts and tags. */
const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const TITLE = 'Insurigence - Insurance Placement Intelligence';

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return /session_token=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
}
async function page(token: string, path: string) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: `session_token=${token}` }, redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') ?? '', html: res.status === 200 ? await res.text() : '', ms: Date.now() - t0 };
}
/** The sidebar's links: every DESK_NAV href that appears as a link on the page. */
const sidebar = (html: string, area: DeskArea) => DESK_NAV[area].filter((i) => html.includes(`href="${i.href}"`)).map((i) => i.href);

(async () => {
  try {
    console.log(`Seeding a copy of the demo (${DOMAIN})…`);
    await seedDemo(prisma, { password: PASSWORD, domain: DOMAIN });
    const demo = await findDemo(prisma, DOMAIN);
    const users = await prisma.user.findMany({ where: { id: { in: demo.users.map((u) => u.id) } } });
    const harbor = (await prisma.agency.findFirstOrThrow({ where: { id: { in: demo.agencies.map((a) => a.id) }, name: { startsWith: 'Harbor' } } }));
    const task = await prisma.task.findFirstOrThrow({ where: { agencyId: harbor.id, title: { startsWith: 'Certificate for Portland' } } });
    const account = await prisma.insuredAccount.findFirstOrThrow({ where: { agencyId: harbor.id, name: 'Bayside Marine Supply' } });

    const people: { local: string; areas: DeskArea[]; details: string[]; away: string[] }[] = [
      { local: 'olivia.ops', areas: ['OPS', 'ADMIN'], details: [`/desk-ops/tasks/${task.id}`, `/desk-ops/agencies/${harbor.id}`, `/super-admin/desk/agencies/${harbor.id}`], away: ['/desk', '/super-admin'] },
      { local: 'marcus.am', areas: ['OPS'], details: [`/desk-ops/tasks/${task.id}`, `/desk-ops/agencies/${harbor.id}`], away: ['/desk', '/super-admin/desk', '/dashboard'] },
      { local: 'diego.va', areas: ['OPS'], details: [`/desk-ops/tasks/${task.id}`], away: ['/desk', '/super-admin/desk', '/dashboard'] },
      { local: 'hannah.owner', areas: ['AGENCY'], details: [`/desk/requests/${task.id}`, `/desk/accounts/${account.id}`], away: ['/desk-ops', '/super-admin/desk'] },
      { local: 'carlos.csr', areas: ['AGENCY'], details: [`/desk/requests/${task.id}`], away: ['/desk-ops', '/super-admin/desk'] },
      { local: 'nina.producer', areas: ['AGENCY'], details: [`/desk/requests/${task.id}`, `/desk/accounts/${account.id}`], away: ['/desk-ops', '/super-admin/desk'] },
    ];
    const times: number[] = [];
    for (const p of people) {
      const user = users.find((u) => u.email === `${p.local}@${DOMAIN}`)!;
      console.log(`\n${user.firstName} ${user.lastName} (${user.role})`);
      const token = await signIn(user.email);
      ok('signs in', !!token);
      for (const area of p.areas) {
        const items = navFor(area, user.role);
        for (const item of items) {
          const r = await page(token, item.href);
          times.push(r.ms);
          ok(`${item.label} (${item.href}) opens`, r.status === 200 && !ERROR_PAGE.test(r.html), { status: r.status, location: r.location, ms: r.ms });
        }
        // The Desk areas draw their sidebar on the server; Desk setup sits in the
        // Super Admin layout, which draws everything in the browser.
        if (area === 'ADMIN') continue;
        const home = await page(token, items[0].href);
        const links = sidebar(home.html, area);
        const expected = items.map((i) => i.href);
        ok(`the ${area.toLowerCase()} sidebar has exactly their ${expected.length} items`, expected.every((h) => links.includes(h)) && links.every((h) => expected.includes(h)), { links, expected });
      }
      for (const d of p.details) {
        const r = await page(token, d);
        times.push(r.ms);
        ok(`${d.replace(/[0-9a-f]{24}/, '[id]')} opens`, r.status === 200 && !ERROR_PAGE.test(r.html), { status: r.status, location: r.location });
      }
      for (const a of p.away) {
        const r = await page(token, a);
        // The Desk areas redirect on the server. The main app (dashboard, Super
        // Admin) sends an empty page and redirects in the browser once it has
        // checked the session; its data comes only from the API, which refuses.
        const path = r.location.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        const redirected = r.status >= 300 && r.status < 400 && path !== a && !path.startsWith(`${a}/`);
        const emptyShell = r.status === 200 && visible(r.html) === TITLE && !/^\/desk/.test(a);
        ok(`${a} sends them away (${redirected ? `to ${path}` : emptyShell ? 'an empty page, redirected in the browser' : 'no'})`, redirected || emptyShell, { status: r.status, location: r.location, text: visible(r.html).slice(0, 200) });
      }
    }
    // Signed out, every area goes to the login.
    for (const a of ['/desk', '/desk-ops', '/super-admin/desk']) {
      const r = await fetch(`${BASE}${a}`, { redirect: 'manual' });
      ok(`${a} signed out goes to the login`, r.status >= 300 && r.status < 400 && /login/.test(r.headers.get('location') ?? ''), { status: r.status, location: r.headers.get('location') });
    }
    times.sort((a, b) => a - b);
    console.log(`\nPage times: median ${times[Math.floor(times.length / 2)]} ms, slowest ${times.at(-1)} ms, over ${times.length} pages.`);
  } catch (err) {
    console.error(err);
    fail += 1;
  } finally {
    await new Promise((r) => setTimeout(r, 1500));
    await removeDemo(prisma, DOMAIN).catch((e) => { console.error('cleanup failed', e); fail += 1; });
    const left = await findDemo(prisma, DOMAIN);
    if (left.agencies.length || left.users.length) { console.error('left behind', left); fail += 1; }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
