import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { TaskWorkspace } from '@/components/desk/workspace/TaskWorkspace';

type Props = { params: Promise<{ id: string }> };

/**
 * One request, for the Desk team. Open to everyone in the operations area
 * (as My tasks is); the API decides what each person may see and do on it.
 */
export default async function Page({ params }: Props) {
  const access = await deskPageAccess('OPS', '/desk-ops/my-tasks');
  if (!access) return null;
  const { id } = await params;
  return <TaskWorkspace taskId={id} userId={access.user.id} />;
}
