import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { RequestTracker } from '@/components/desk/tracker/RequestTracker';
import { parseTrackerFilters } from '@/lib/desk/tracker-view';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The agency's requests: what needs them, what's open, what's done. */
export default async function Page({ searchParams }: Props) {
  const access = await deskPageAccess('AGENCY', '/desk/requests');
  if (!access) return null;
  return <RequestTracker initial={parseTrackerFilters(await searchParams)} />;
}
