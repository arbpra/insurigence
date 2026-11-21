import { Suspense } from 'react';
import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { TurnaroundView } from '@/components/desk/turnaround/TurnaroundView';

/** Account and Operations Managers (the navigation's roles); the API checks again. */
export default async function Page() {
  const access = await deskPageAccess('OPS', '/desk-ops/metrics');
  if (!access) return null;
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <TurnaroundView />
    </Suspense>
  );
}
