import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { Messages } from '@/components/desk/messages/Messages';

/** The agency's conversation with its Desk team, and the latest conversations on its requests. */
export default async function Page() {
  const access = await deskPageAccess('AGENCY', '/desk/messages');
  if (!access) return null;
  return <Messages mode="agency" initialAgencyId={null} />;
}
