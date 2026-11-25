import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { AgencySetupForm } from '@/components/desk/admin/AgencySetupForm';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!(await deskPageAccess('ADMIN', '/super-admin/desk/agencies'))) return null;
  const { id } = await params;
  return <AgencySetupForm agencyId={id} />;
}
