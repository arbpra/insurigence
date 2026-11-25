/**
 * The Desk, Module 14: navigation shell.
 *
 * Checks the pure navigation rules (landing pages, sidebars per role, active
 * highlighting, role-limited pages, safe login redirects), that every sidebar
 * entry has a page and every area a server layout, and — with temporary
 * agencies and users — who each area lets in, sends elsewhere or shows the
 * "not enabled" notice, and the overview facts. Uses temporary records only.
 * Run with:  npx tsx script/verify-desk-navigation.ts
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { resolveDeskScope } from '../lib/desk/access';
import {
  AREA_ROOTS, DESK_NAV, gateArea, isActivePath, itemAllowed, landingPath, mainAppAllowed,
  navFor, navItemFor, otherAreaLinks, safeRedirect, superAdminAreaAllowed, type DeskArea,
} from '../lib/desk/navigation';
import { overviewFacts } from '../lib/desk/session';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const labels = (area: DeskArea, role: string) => navFor(area, role).map((i) => i.label).join(', ');

const TAG = `m14test-${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };

async function wipe() {
  await prisma.agencyPodAccess.deleteMany({ where: { agencyId: { in: cleanup.agencyIds } } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId: { in: cleanup.agencyIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: { in: cleanup.agencyIds } } });
}

(async () => {
  try {
    console.log('Landing after sign-in');
    ok('Super Admin → /super-admin', landingPath('SUPER_ADMIN') === '/super-admin');
    ok('Operations Manager → /desk-ops', landingPath('DESK_ADMIN') === '/desk-ops');
    ok('Account Manager → /desk-ops', landingPath('ACCOUNT_MANAGER') === '/desk-ops');
    ok('VA → /desk-ops', landingPath('DESK_VA') === '/desk-ops');
    ok('agency admin, producer, CSR → /dashboard', ['ADMIN', 'AGENT', 'CSR'].every((r) => landingPath(r) === '/dashboard'));

    console.log('Sidebars per role');
    ok('agency admin sees Import and Team access', labels('AGENCY', 'ADMIN') === 'Overview, Requests, New request, Accounts, Import, Messages, Team access');
    ok('producer does not', labels('AGENCY', 'AGENT') === 'Overview, Requests, New request, Accounts, Messages');
    ok('CSR does not', labels('AGENCY', 'CSR') === labels('AGENCY', 'AGENT'));
    ok('VA: overview, queue and own tasks only', labels('OPS', 'DESK_VA') === 'Overview, Pod queue, My tasks');
    ok('Account Manager adds agencies, messages, turnaround', labels('OPS', 'ACCOUNT_MANAGER') === 'Overview, Pod queue, My tasks, Agencies, Messages, Turnaround');
    ok('Operations Manager sees every operations page', navFor('OPS', 'DESK_ADMIN').length === DESK_NAV.OPS.length);
    ok('Super Admin sees every operations page', navFor('OPS', 'SUPER_ADMIN').length === DESK_NAV.OPS.length);
    ok('Desk setup lists 8 pages for the Super Admin, 7 for an Operations Manager / COO (Positions is for the Super Admin only)', navFor('ADMIN', 'SUPER_ADMIN').length === 8 && navFor('ADMIN', 'DESK_ADMIN').length === 7);

    console.log('Every sidebar entry is real');
    const all = Object.entries(DESK_NAV).flatMap(([area, items]) => items.map((i) => ({ area: area as DeskArea, ...i })));
    ok('no duplicate paths', new Set(all.map((i) => i.href)).size === all.length);
    ok('each entry lies inside its own area', all.every((i) => i.href === AREA_ROOTS[i.area] || i.href.startsWith(AREA_ROOTS[i.area] + '/')));
    ok('each entry names the module that builds it', all.every((i) => i.module >= 14 && i.module <= 68 && i.summary.length > 10));
    const pageFile = (area: DeskArea, href: string) => join(process.cwd(), 'app', area === 'ADMIN' ? '(main)' : '(desk)', ...href.split('/').filter(Boolean), 'page.tsx');
    const missing = all.filter((i) => !existsSync(pageFile(i.area, i.href)));
    ok(`each entry has a page (${all.length})`, missing.length === 0);
    if (missing.length) console.log('    missing:', missing.map((i) => i.href).join(', '));
    const placeholderSource = (i: { area: DeskArea; href: string }) => existsSync(pageFile(i.area, i.href)) ? readFileSync(pageFile(i.area, i.href), 'utf8') : '';
    const wrong = all.filter((i) => placeholderSource(i).includes('DeskPage') && !placeholderSource(i).includes(`area="${i.area}" href="${i.href}"`));
    ok('each placeholder renders its own entry in its own area', wrong.length === 0);
    for (const area of Object.keys(AREA_ROOTS) as DeskArea[]) {
      const layout = join(process.cwd(), 'app', area === 'ADMIN' ? '(main)' : '(desk)', ...AREA_ROOTS[area].split('/').filter(Boolean), 'layout.tsx');
      ok(`${area} has a server layout checking access`, existsSync(layout)
        && readFileSync(layout, 'utf8').includes(`area="${area}"`) && !readFileSync(layout, 'utf8').includes("'use client'"));
    }
    const navSource = readFileSync(join(process.cwd(), 'lib', 'desk', 'navigation.ts'), 'utf8');
    ok('navigation rules import nothing server-side (safe in the browser)',
      !/^import (?!type )[^;]*from '\.\/access'/m.test(navSource) && !navSource.includes('@prisma/client') && !navSource.includes('next/server'));

    console.log('Highlighting');
    ok('Overview is not lit on a sub-page', !isActivePath('/desk/requests', '/desk'));
    ok('Overview is lit on itself', isActivePath('/desk', '/desk'));
    ok('Requests is lit on a request detail', isActivePath('/desk/requests/abc123', '/desk/requests'));
    ok('Requests is not lit on New request', !isActivePath('/desk/requests/new', '/desk/requests'));
    ok('New request is lit on itself', isActivePath('/desk/requests/new', '/desk/requests/new'));
    ok('/desk is not lit inside /desk-ops', !isActivePath('/desk-ops', '/desk'));
    ok('a path that only shares a prefix is not lit', !isActivePath('/desk-ops/queue-old', '/desk-ops/queue'));

    console.log('Role-limited pages (enforced, not just hidden)');
    ok('CSR cannot open Import', !itemAllowed('/desk/import', 'CSR'));
    ok('producer cannot open Team access', !itemAllowed('/desk/team', 'AGENT'));
    ok('agency admin can open Import', itemAllowed('/desk/import', 'ADMIN'));
    ok('VA cannot open Workload', !itemAllowed('/desk-ops/workload', 'DESK_VA'));
    ok('VA cannot open Agencies', !itemAllowed('/desk-ops/agencies', 'DESK_VA'));
    ok('Account Manager cannot open Usage & audit', !itemAllowed('/desk-ops/usage', 'ACCOUNT_MANAGER'));
    ok('unknown page refused', !itemAllowed('/desk/secret', 'ADMIN'));
    ok('nav entry lookup is exact', navItemFor('/desk/requests/x') === undefined);

    console.log('Agency app and Super Admin pages');
    ok('VA kept out of the agency app', !mainAppAllowed('DESK_VA', '/dashboard'));
    ok('Account Manager kept out of the agency app', !mainAppAllowed('ACCOUNT_MANAGER', '/leads'));
    ok('Operations Manager allowed in Desk setup only', mainAppAllowed('DESK_ADMIN', '/super-admin/desk/pods') && !mainAppAllowed('DESK_ADMIN', '/dashboard'));
    ok('agency users unaffected', ['ADMIN', 'AGENT', 'CSR', 'SUPER_ADMIN'].every((r) => mainAppAllowed(r, '/dashboard')));
    ok('Super Admin: all Super Admin pages', superAdminAreaAllowed('SUPER_ADMIN', '/super-admin/users'));
    ok('Operations Manager: Desk setup', superAdminAreaAllowed('DESK_ADMIN', '/super-admin/desk') && superAdminAreaAllowed('DESK_ADMIN', '/super-admin/desk/staff'));
    ok('Operations Manager: not users, agencies or a look-alike path',
      !superAdminAreaAllowed('DESK_ADMIN', '/super-admin/users') && !superAdminAreaAllowed('DESK_ADMIN', '/super-admin') && !superAdminAreaAllowed('DESK_ADMIN', '/super-admin/desk-old'));
    ok('agency users: none', ['ADMIN', 'AGENT', 'CSR'].every((r) => !superAdminAreaAllowed(r, '/super-admin/desk')));
    // Module 48: a position, not the role, opens Desk setup. The path is let through; the server layout then refuses them (gate checks below).
    ok('Account Manager and VA: the Desk setup path only, where the server checks their position',
      ['ACCOUNT_MANAGER', 'DESK_VA'].every((r) => superAdminAreaAllowed(r, '/super-admin/desk') && !superAdminAreaAllowed(r, '/super-admin') && !superAdminAreaAllowed(r, '/super-admin/users') && !superAdminAreaAllowed(r, '/super-admin/desk-old')));
    const setupPages = DESK_NAV.ADMIN.filter((i) => i.href !== '/super-admin/desk');
    ok('every setup page checks its own permission on the server', setupPages.every((i) => readFileSync(pageFile('ADMIN', i.href), 'utf8').includes(`deskPageAccess('ADMIN', '${i.href}')`))
      && readFileSync(pageFile('ADMIN', '/super-admin/desk/agencies/[id]'), 'utf8').includes("deskPageAccess('ADMIN', '/super-admin/desk/agencies')"));

    console.log('Login redirect target');
    ok('a site path is followed', safeRedirect('/desk/requests?x=1') === '/desk/requests?x=1');
    ok('another site is not (//)', safeRedirect('//evil.example') === null);
    ok('another site is not (https://)', safeRedirect('https://evil.example') === null);
    ok('backslash trick is not', safeRedirect('/\\evil.example') === null);
    ok('empty or missing is not', safeRedirect('') === null && safeRedirect(null) === null);

    console.log('Links to other areas');
    ok('Super Admin: setup and Super Admin from operations', otherAreaLinks('OPS', 'SUPER_ADMIN').map((l) => l.href).join() === '/super-admin/desk,/super-admin');
    ok('Operations Manager: operations from setup', otherAreaLinks('ADMIN', 'DESK_ADMIN').map((l) => l.href).join() === '/desk-ops');
    ok('VA: none', otherAreaLinks('OPS', 'DESK_VA').length === 0);
    ok('agency user: back to placement', otherAreaLinks('AGENCY', 'CSR').map((l) => l.href).join() === '/dashboard');

    // ── Gates against real scopes ──
    const mkAgency = async (n: string, deskEnabled: boolean) => {
      const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } });
      cleanup.agencyIds.push(a.id); return a;
    };
    const A = await mkAgency('A', true);
    const C = await mkAgency('C (no Desk)', false);
    const mkUser = async (n: string, role: UserRole, agencyId: string | null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const adminA = await mkUser('admin-a', 'ADMIN', A.id);
    const csrA = await mkUser('csr-a', 'CSR', A.id);
    const adminC = await mkUser('admin-c', 'ADMIN', C.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER', null, { firstName: 'Avery', lastName: 'Manager' });
    const va = await mkUser('va', 'DESK_VA', null);
    const vaPod = await mkUser('va-pod', 'DESK_VA', null);
    const ops = await mkUser('ops', 'DESK_ADMIN', null);
    const sa = await mkUser('sa', 'SUPER_ADMIN', null);
    const inactiveA = await mkUser('inactive', 'ADMIN', A.id, { isActive: false });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    const pod = await prisma.pod.create({ data: { name: `${TAG} Pod`, code: `${TAG}-pod` } });
    cleanup.podIds.push(pod.id);
    await prisma.podMember.create({ data: { podId: pod.id, userId: vaPod.id } });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: pod.id } });

    const gate = async (userId: string, role: string, area: DeskArea) => {
      const g = gateArea(area, role, await resolveDeskScope(prisma, userId));
      return g.ok ? 'ok' : 'redirect' in g ? g.redirect : g.notice;
    };
    console.log('Who gets into which area');
    ok('agency admin (Desk on): The Desk', await gate(adminA.id, 'ADMIN', 'AGENCY') === 'ok');
    ok('CSR (Desk on): The Desk', await gate(csrA.id, 'CSR', 'AGENCY') === 'ok');
    ok('agency admin: operations → sent to /dashboard', await gate(adminA.id, 'ADMIN', 'OPS') === '/dashboard');
    ok('agency admin: Desk setup → sent to /dashboard', await gate(adminA.id, 'ADMIN', 'ADMIN') === '/dashboard');
    ok('agency without The Desk: "not enabled" notice', await gate(adminC.id, 'ADMIN', 'AGENCY') === 'DESK_NOT_ENABLED');
    ok('deactivated agency user: sent away, not told "not enabled"', await gate(inactiveA.id, 'ADMIN', 'AGENCY') === '/dashboard');
    ok('Account Manager: operations', await gate(am.id, 'ACCOUNT_MANAGER', 'OPS') === 'ok');
    ok('Account Manager: The Desk → sent to /desk-ops', await gate(am.id, 'ACCOUNT_MANAGER', 'AGENCY') === '/desk-ops');
    ok('Account Manager: Desk setup → sent to /desk-ops', await gate(am.id, 'ACCOUNT_MANAGER', 'ADMIN') === '/desk-ops');
    ok('VA with no pod yet: operations (shown empty)', await gate(va.id, 'DESK_VA', 'OPS') === 'ok');
    ok('VA: Desk setup → sent to /desk-ops', await gate(va.id, 'DESK_VA', 'ADMIN') === '/desk-ops');
    ok('Operations Manager: operations and setup', await gate(ops.id, 'DESK_ADMIN', 'OPS') === 'ok' && await gate(ops.id, 'DESK_ADMIN', 'ADMIN') === 'ok');
    ok('Operations Manager: The Desk → sent to /desk-ops', await gate(ops.id, 'DESK_ADMIN', 'AGENCY') === '/desk-ops');
    ok('Super Admin: operations and setup', await gate(sa.id, 'SUPER_ADMIN', 'OPS') === 'ok' && await gate(sa.id, 'SUPER_ADMIN', 'ADMIN') === 'ok');
    ok('Super Admin: The Desk (an agency view) → /super-admin', await gate(sa.id, 'SUPER_ADMIN', 'AGENCY') === '/super-admin');
    const deactivatedVa = gateArea('OPS', 'DESK_VA', { kind: 'NONE', userId: va.id, role: 'DESK_VA', reason: 'inactive or missing user' });
    ok('refused from own landing area → sign in again, no loop', !deactivatedVa.ok && 'redirect' in deactivatedVa && deactivatedVa.redirect === '/login');

    console.log('Overview facts');
    const facts = async (userId: string, area: DeskArea) =>
      Object.fromEntries((await overviewFacts(prisma, area, await resolveDeskScope(prisma, userId))).map((f) => [f.label, f.value]));
    const fa = await facts(adminA.id, 'AGENCY');
    ok('agency: its name', fa['Agency'] === `${TAG} A`);
    ok('agency admin: whole book', fa['Your accounts'] === 'Whole book');
    ok('agency: Account Manager by name', fa['Account Manager'] === 'Avery Manager');
    ok('CSR: assigned accounts only', (await facts(csrA.id, 'AGENCY'))['Your accounts'] === 'Accounts assigned to you');
    ok('Account Manager: agencies managed', (await facts(am.id, 'OPS'))['Agencies you manage'] === '1');
    ok('VA without pod: none yet', (await facts(va.id, 'OPS'))['Your pods'] === 'None yet');
    const fv = await facts(vaPod.id, 'OPS');
    ok('VA in a pod: pod name and agency count', fv['Your pods'] === `${TAG} Pod` && fv['Agencies you can work for'] === '1');
    const fp = await facts(ops.id, 'ADMIN');
    ok('setup: counts of agencies, pods, staff', ['Agencies using The Desk', 'Active pods', 'Active Desk staff'].every((k) => /^\d+$/.test(fp[k] ?? '')));
    ok('setup counts include the fixture', Number(fp['Agencies using The Desk']) >= 1 && Number(fp['Active Desk staff']) >= 4);
  } catch (e) {
    fail++;
    console.error(e);
  } finally {
    await wipe();
    const left = await prisma.user.count({ where: { id: { in: cleanup.userIds } } }) + await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } })
      + await prisma.pod.count({ where: { id: { in: cleanup.podIds } } });
    ok('temporary records removed', left === 0);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
