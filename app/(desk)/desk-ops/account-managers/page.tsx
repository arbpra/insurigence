import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { AccountManagersView } from '@/components/desk/team/AccountManagersView';

/** Whoever may cover and reassign Account Managers (`team.manage`); the API checks again. */
export default async function Page() {
  if (!(await deskPageAccess('OPS', '/desk-ops/account-managers'))) return null;
  return <AccountManagersView />;
}
