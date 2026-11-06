/**
 * No Super Admin user response carries a password hash, and the screens' fields
 * are still there. Temporary users only; prints no hashes.
 * Run with:  npx tsx script/verify-user-responses.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { GET as listUsers, POST as createUser } from '../app/api/super-admin/users/route';
import { GET as readUser, PATCH as updateUser, DELETE as deactivateUser } from '../app/api/super-admin/users/[userId]/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `userresp${Date.now()}`;
const MARK = `hash-${TAG}`;

async function wipe() {
  const users = await prisma.user.findMany({ where: { email: { contains: TAG } }, select: { id: true } });
  const userId = { in: users.map((u) => u.id) };
  await prisma.activityEvent.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

async function main() {
  const admin = await prisma.user.create({ data: { email: `${TAG}-admin@example.test`, passwordHash: MARK, role: 'SUPER_ADMIN', isActive: true } });
  const person = await prisma.user.create({ data: { email: `${TAG}-person@example.test`, passwordHash: MARK, role: 'DESK_ADMIN', firstName: 'Pat', isActive: true } });
  const token = await createSession(admin.id);
  const headers = { cookie: `session_token=${token}` };
  const url = (path: string) => `http://local.test/api/super-admin/users${path}`;
  const ctx = { params: Promise.resolve({ userId: person.id }) };
  const clean = (body: unknown) => { const t = JSON.stringify(body); return !t.includes('passwordHash') && !t.includes(MARK); };

  const list = await (await listUsers(new NextRequest(url(`?search=${TAG}`), { headers }))).json();
  ok('list: both users returned', list.users.length === 2);
  ok('list: no hash', clean(list));
  ok('list: the screen\'s fields remain', list.users.every((u: Record<string, unknown>) => 'email' in u && 'role' in u && 'isActive' in u && 'agency' in u && '_count' in u));

  const read = await (await readUser(new NextRequest(url(`/${person.id}`), { headers }), ctx)).json();
  ok('read: returned, no hash', read.user?.email === person.email && clean(read));

  const updated = await (await updateUser(new NextRequest(url(`/${person.id}`), { method: 'PATCH', headers, body: JSON.stringify({ firstName: 'Patricia' }) }), ctx)).json();
  ok('update: saved, no hash', updated.user?.firstName === 'Patricia' && clean(updated));

  const created = await (await createUser(new NextRequest(url(''), { method: 'POST', headers, body: JSON.stringify({ email: `${TAG}-new@example.test`, role: 'DESK_ADMIN' }) }))).json();
  const createdClean = { ...created, tempPassword: undefined };
  ok('create: returned, no hash', created.user?.email === `${TAG}-new@example.test` && clean(createdClean) && !('passwordHash' in created.user));
  ok('create: the one-time password is still shown', typeof created.tempPassword === 'string' && created.tempPassword.length > 0);
  const stored = await prisma.user.findUniqueOrThrow({ where: { email: `${TAG}-new@example.test` } });
  ok('create: the hash is still stored', !!stored.passwordHash);

  const gone = await (await deactivateUser(new NextRequest(url(`/${person.id}`), { method: 'DELETE', headers }), ctx)).json();
  ok('deactivate: done, no hash', gone.success === true && gone.user?.isActive === false && clean(gone));
  ok('and the stored hash is untouched', (await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).passwordHash === MARK);

  console.log('The screens');
  for (const p of ['app/(main)/super-admin/users/page.tsx', 'app/(main)/super-admin/agencies/[id]/page.tsx']) {
    ok(`${p.split('/').slice(-2).join('/')} does not rely on it`, !readFileSync(p, 'utf8').includes('passwordHash'));
  }
}

main()
  .catch((err) => { console.error(err); fail++; })
  .finally(async () => {
    await wipe().catch((err) => { console.error('cleanup failed', err); fail++; });
    ok('nothing left behind', await prisma.user.count({ where: { email: { contains: TAG } } }) === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
