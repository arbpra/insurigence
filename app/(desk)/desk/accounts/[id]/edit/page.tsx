import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { AccountForm } from '@/components/desk/accounts/AccountForm';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> };

export default async function Page({ params, searchParams }: Props) {
  const access = await deskPageAccess('AGENCY', '/desk/accounts');
  if (!access) return null;
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  return <AccountForm key={id} accountId={id} justCreated={created === '1'} />;
}
