import { cache } from 'react';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { enterDeskArea, loginRedirectFor, overviewFacts, shellIdentity } from '@/lib/desk/session';
import { AREA_ROOTS, itemAllowed, type DeskArea } from '@/lib/desk/navigation';
import { DeskShell } from './DeskShell';
import { DeskNotEnabled } from './DeskNotEnabled';
import { DeskPlaceholder } from './DeskPlaceholder';

/** One scope lookup per request, shared by the layout and its page. */
const currentDeskSession = cache((area: DeskArea) => enterDeskArea(prisma, area));

/**
 * Server layout for a Desk area. Checks the signed-in user's Desk scope on
 * every request and either renders the shell, shows the "not enabled" notice,
 * or redirects the user to where they belong.
 */
export async function DeskAreaLayout({ area, embedded, children }: { area: DeskArea; embedded?: boolean; children: React.ReactNode }) {
  const session = await currentDeskSession(area);
  if (!session) redirect(loginRedirectFor(area));

  const { gate, user } = session;
  if (!gate.ok) {
    if ('redirect' in gate) redirect(gate.redirect);
    return <DeskNotEnabled />;
  }

  return (
    <DeskShell area={area} role={user.role} identity={shellIdentity(user)} embedded={embedded}>
      {children}
    </DeskShell>
  );
}

/**
 * A Desk page not built yet. Items limited to some roles (e.g. Import for
 * agency admins) are enforced here too, not only hidden from the sidebar.
 * The area root also lists a few facts about the user's Desk access.
 */
export async function DeskPage({ area, href }: { area: DeskArea; href: string }) {
  const session = await currentDeskSession(area);
  if (!session) redirect(loginRedirectFor(area));
  if (!session.gate.ok) return null; // the layout has already handled it
  if (!itemAllowed(href, session.user.role)) redirect(AREA_ROOTS[area]);
  const facts = href === AREA_ROOTS[area] ? await overviewFacts(prisma, area, session.scope) : [];
  return <DeskPlaceholder href={href} facts={facts} />;
}
