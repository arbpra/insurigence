import { Suspense } from 'react';
import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { UsageAuditView } from '@/components/desk/usage/UsageAuditView';

/** Operations Managers and the Super Admin (the navigation's roles); the API checks again. */
export default async function Page() {
  const access = await deskPageAccess('OPS', '/desk-ops/usage');
  if (!access) return null;
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <UsageAuditView />
    </Suspense>
  );
}
