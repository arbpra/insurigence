import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { MemberAccounts } from '@/components/desk/team/MemberAccounts';

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const access = await deskPageAccess('AGENCY', '/desk/team');
  if (!access) return null;
  const { id } = await params;
  return <MemberAccounts key={id} userId={id} />;
}
