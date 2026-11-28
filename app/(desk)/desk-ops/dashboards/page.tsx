import { Suspense } from 'react';
import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { DepartmentDashboards } from '@/components/desk/dashboards/DepartmentDashboards';

/** The department dashboards (Module 52); the API decides which, and checks again. */
export default async function Page() {
  const access = await deskPageAccess('OPS', '/desk-ops/dashboards');
  if (!access) return null;
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <DepartmentDashboards />
    </Suspense>
  );
}
