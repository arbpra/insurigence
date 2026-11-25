import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { CalendarEditor } from '@/components/desk/admin/CalendarEditor';

export default async function Page() {
  if (!(await deskPageAccess('ADMIN', '/super-admin/desk/calendar'))) return null;
  return <CalendarEditor />;
}
