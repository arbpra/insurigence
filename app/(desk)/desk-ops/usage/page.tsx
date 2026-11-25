import { Suspense } from 'react';
import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { can } from '@/lib/desk/access';
import { UsageAuditView } from '@/components/desk/usage/UsageAuditView';

/** Positions with usage or the audit log (the navigation's rule), each its own tab; the API checks again. */
export default async function Page() {
  const access = await deskPageAccess('OPS', '/desk-ops/usage');
  if (!access) return null;
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <UsageAuditView tabs={[...(can(access.scope, 'usage.view') ? ['usage' as const] : []), ...(can(access.scope, 'audit.view') ? ['audit' as const] : [])]} />
    </Suspense>
  );
}
