import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { AgencyList } from '@/components/desk/admin/AgencyList';

export default async function Page() {
  if (!(await deskPageAccess('ADMIN', '/super-admin/desk/agencies'))) return null;
  return <AgencyList />;
}
