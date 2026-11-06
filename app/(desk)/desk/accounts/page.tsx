import { Suspense } from 'react';
import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { AccountList } from '@/components/desk/accounts/AccountList';

export default async function Page() {
  const access = await deskPageAccess('AGENCY', '/desk/accounts');
  if (!access || access.scope.kind !== 'AGENCY') return null;
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <AccountList wholeBook={access.scope.book === 'ALL'} canImport={access.scope.role === 'ADMIN'} />
    </Suspense>
  );
}
