import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { RoutingEditor } from '@/components/desk/admin/RoutingEditor';

export default async function Page() {
  if (!(await deskPageAccess('ADMIN', '/super-admin/desk/routing'))) return null;
  return <RoutingEditor />;
}
