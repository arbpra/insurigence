import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { AccountForm } from '@/components/desk/accounts/AccountForm';

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const access = await deskPageAccess('AGENCY', '/desk/accounts');
  if (!access) return null;
  const { id } = await params;
  return <AccountForm key={id} accountId={id} />;
}
