import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { Messages } from '@/components/desk/messages/Messages';

type Props = { searchParams: Promise<{ agency?: string | string[] }> };

/** Desk managers' conversations, one per agency they look after. The API decides which they may open. */
export default async function Page({ searchParams }: Props) {
  const access = await deskPageAccess('OPS', '/desk-ops/messages');
  if (!access) return null;
  const { agency } = await searchParams;
  const start = typeof agency === 'string' && /^[a-f0-9]{24}$/i.test(agency) ? agency : null;
  return <Messages mode="desk" initialAgencyId={start} />;
}
