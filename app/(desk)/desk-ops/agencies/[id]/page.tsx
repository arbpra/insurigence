import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { AgencyDetail } from '@/components/desk/agencies/AgencyDetail';
import { parseAgencyWork } from '@/lib/desk/agency-page-view';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** One agency, for its Account Manager: its setup, accounts, work and renewals. The API decides what is shown. */
export default async function Page({ params, searchParams }: Props) {
  const access = await deskPageAccess('OPS', '/desk-ops/agencies');
  if (!access) return null;
  const { id } = await params;
  return <AgencyDetail agencyId={id} initial={parseAgencyWork(await searchParams)} />;
}
