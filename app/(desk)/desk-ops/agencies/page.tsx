import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { AgencyList } from '@/components/desk/agencies/AgencyList';

/** The agencies an Account Manager looks after (all Desk agencies for an Operations Manager). */
export default async function Page() {
  const access = await deskPageAccess('OPS', '/desk-ops/agencies');
  if (!access) return null;
  return <AgencyList />;
}
