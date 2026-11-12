import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { AgencyRequest } from '@/components/desk/tracker/AgencyRequest';

type Props = { params: Promise<{ id: string }> };

/** One request, as the agency sees it. The API decides what is shown. */
export default async function Page({ params }: Props) {
  const access = await deskPageAccess('AGENCY', '/desk/requests');
  if (!access) return null;
  const { id } = await params;
  return <AgencyRequest taskId={id} />;
}
