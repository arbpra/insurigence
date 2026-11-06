/**
 * Text typed by a user is matched as text, not as a database pattern, on the
 * public signup page and the Super Admin user search (see lib/desk/literal-match.ts).
 *
 * Every name and email carries this run's tag, so no pattern used here can match
 * real data. Temporary records only, removed at the end. Signup sends no email.
 * Run with:  npx tsx script/verify-text-matching.ts
 */
import 'dotenv/config';
import { NextRequest } from 'next/server';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { POST as signup } from '../app/api/auth/signup/route';
import { GET as listUsers } from '../app/api/super-admin/users/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `textmatch${Date.now()}`;
let counter = 0;

function signupRequest(agencyName: string) {
  const email = `${TAG}-${++counter}@example.test`;
  return signup(new NextRequest('http://local.test/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ firstName: 'T', lastName: 'T', email, agencyName, password: 'temporary-pass-1', confirmPassword: 'temporary-pass-1', acceptedTerms: true }),
  }));
}

async function wipe() {
  // Signup writes its activity entries without waiting for them.
  await new Promise((r) => setTimeout(r, 1500));
  const agencies = await prisma.agency.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { email: { contains: TAG } }, select: { id: true } });
  const agencyId = { in: agencies.map((a) => a.id) };
  const userId = { in: users.map((u) => u.id) };
  await prisma.activityEvent.deleteMany({ where: { OR: [{ agencyId }, { userId }] } });
  await prisma.intakeForm.deleteMany({ where: { agencyId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

async function main() {
  console.log('Public signup');
  const taken = `Zz ${TAG} (East)`;
  const first = await signupRequest(taken);
  ok('a name with brackets can sign up', first.status === 201);
  ok('the same name again is refused', (await signupRequest(taken)).status === 409);
  ok('and in different capitals', (await signupRequest(taken.toUpperCase())).status === 409);
  ok('a name that reads as a wildcard is not taken for that name', (await signupRequest(`Zz ${TAG} .*`)).status === 201);
  ok('an unclosed bracket is not a server error', (await signupRequest(`Zz ${TAG} (West`)).status === 201);
  ok('a pattern that would match a real name is not a match', (await signupRequest(`Zz ${TAG} \\(East\\)`)).status === 201);

  console.log('Super Admin user search');
  const admin = await prisma.user.create({
    data: { email: `${TAG}+admin@example.test`, passwordHash: 'x', role: 'SUPER_ADMIN', isActive: true, firstName: 'Search', lastName: `${TAG}(Ops)` },
  });
  const token = await createSession(admin.id);
  const search = async (q: string) => {
    const res = await listUsers(new NextRequest(`http://local.test/api/super-admin/users?search=${encodeURIComponent(q)}`, { headers: { cookie: `session_token=${token}` } }));
    const body = await res.json();
    return { status: res.status, emails: ((body.users ?? []) as { email: string }[]).map((u) => u.email) };
  };
  const bracket = await search('(');
  ok('"(" is not a server error, and finds the name holding one', bracket.status === 200 && bracket.emails.includes(admin.email));
  const plus = await search(`${TAG}+admin`);
  ok('"+" in an email is matched as typed', plus.status === 200 && plus.emails.length === 1 && plus.emails[0] === admin.email);
  ok('a wildcard finds nothing', (await search(`${TAG}.*`)).emails.length === 0);
  const anyCase = await search(`${TAG}(OPS)`.toUpperCase());
  ok('capitals still ignored', anyCase.emails.length === 1 && anyCase.emails[0] === admin.email);
}

main()
  .catch((err) => { console.error(err); fail++; })
  .finally(async () => {
    await wipe().catch((err) => { console.error('cleanup failed', err); fail++; });
    const left = await prisma.agency.count({ where: { name: { contains: TAG } } }) + await prisma.user.count({ where: { email: { contains: TAG } } });
    ok('nothing left behind', left === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
