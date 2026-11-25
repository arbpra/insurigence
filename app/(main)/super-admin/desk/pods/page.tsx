import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { PodManager } from '@/components/desk/admin/PodManager';
import { can } from '@/lib/desk/access';

/** Each tab needs its own permission; the APIs check again. */
export default async function Page() {
  const session = await deskPageAccess('ADMIN', '/super-admin/desk/pods');
  if (!session) return null;
  const { scope } = session;
  const pods = can(scope, 'pods.manage');
  return (
    <PodManager tabs={[
      ...(pods ? ['pods' as const] : []),
      ...(pods || can(scope, 'agencies.setup') ? ['agencies' as const] : []),
      ...(can(scope, 'documents.grant') ? ['permissions' as const] : []),
    ]} />
  );
}
