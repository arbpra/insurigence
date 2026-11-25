import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { FollowUpEditor } from '@/components/desk/admin/FollowUpEditor';

export default async function Page() {
  if (!(await deskPageAccess('ADMIN', '/super-admin/desk/follow-ups'))) return null;
  return <FollowUpEditor />;
}
