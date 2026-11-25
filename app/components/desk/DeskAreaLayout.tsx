import { cache } from 'react';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { enterDeskArea, loginRedirectFor, overviewFacts, shellIdentity } from '@/lib/desk/session';
import { AREA_ROOTS, itemAllowed, navAccess, type DeskArea } from '@/lib/desk/navigation';
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
    <DeskShell area={area} access={navAccess(session.scope)} identity={shellIdentity(user)} embedded={embedded}>
      {children}
    </DeskShell>
  );
}

/**
 * The session for a page under a sidebar item, or null if the layout has already
 * shown something else. Items limited to some roles (e.g. Import for agency
 * admins) are enforced here too, not only hidden from the sidebar.
 */
export async function deskPageAccess(area: DeskArea, href: string) {
  const session = await currentDeskSession(area);
  if (!session) redirect(loginRedirectFor(area));
  if (!session.gate.ok) return null;
  if (!itemAllowed(href, navAccess(session.scope))) redirect(AREA_ROOTS[area]);
  return session;
}

/**
 * A Desk page not built yet. The area root also lists a few facts about the
 * user's Desk access.
 */
export async function DeskPage({ area, href }: { area: DeskArea; href: string }) {
  const session = await deskPageAccess(area, href);
  if (!session) return null;
  const facts = href === AREA_ROOTS[area] ? await overviewFacts(prisma, area, session.scope) : [];
  return <DeskPlaceholder href={href} facts={facts} />;
}
