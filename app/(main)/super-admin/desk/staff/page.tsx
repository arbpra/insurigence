import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { StaffManager } from '@/components/desk/admin/StaffManager';

export default async function Page() {
  if (!(await deskPageAccess('ADMIN', '/super-admin/desk/staff'))) return null;
  return <StaffManager />;
}
