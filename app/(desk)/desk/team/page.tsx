import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { TeamList } from '@/components/desk/team/TeamList';

export default async function Page() {
  const access = await deskPageAccess('AGENCY', '/desk/team');
  if (!access) return null;
  return <TeamList />;
}
