import { AgencySetupForm } from '@/components/desk/admin/AgencySetupForm';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgencySetupForm agencyId={id} />;
}
