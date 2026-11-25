import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { PositionManager } from '@/components/desk/admin/PositionManager';

/** Super Admin only: an Operations Manager / COO is sent back to Desk setup (and the API refuses them too). */
export default async function Page() {
  const session = await deskPageAccess('ADMIN', '/super-admin/desk/positions');
  if (!session) return null;
  return <PositionManager />;
}
