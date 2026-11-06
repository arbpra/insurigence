import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { AccountForm } from '@/components/desk/accounts/AccountForm';

export default async function Page() {
  const access = await deskPageAccess('AGENCY', '/desk/accounts');
  if (!access) return null;
  return <AccountForm />;
}
