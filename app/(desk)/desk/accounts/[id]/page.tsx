import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { AccountDetail } from '@/components/desk/accounts/AccountDetail';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> };

export default async function Page({ params, searchParams }: Props) {
  const access = await deskPageAccess('AGENCY', '/desk/accounts');
  if (!access) return null;
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  return <AccountDetail key={id} accountId={id} justCreated={created === '1'} />;
}
