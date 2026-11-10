import { Suspense } from 'react';
import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { TaskQueue } from '@/components/desk/queue/TaskQueue';

export default async function Page() {
  const access = await deskPageAccess('OPS', '/desk-ops/queue');
  if (!access) return null;
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <TaskQueue mode="queue" userId={access.user.id} />
    </Suspense>
  );
}
