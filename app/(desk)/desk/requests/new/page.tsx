import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { RequestForm } from '@/components/desk/requests/RequestForm';

export default async function Page({ searchParams }: { searchParams: Promise<{ insuredId?: string | string[] }> }) {
  const access = await deskPageAccess('AGENCY', '/desk/requests/new');
  if (!access) return null;
  const { insuredId } = await searchParams;
  // An account chosen on its own page; the form checks it through the API like any other.
  const start = typeof insuredId === 'string' && /^[a-f0-9]{24}$/i.test(insuredId) ? insuredId : null;
  return <RequestForm insuredId={start} />;
}
