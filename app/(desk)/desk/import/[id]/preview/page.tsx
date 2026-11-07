import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { ImportPreview } from '@/components/desk/imports/ImportPreview';

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const access = await deskPageAccess('AGENCY', '/desk/import');
  if (!access) return null;
  const { id } = await params;
  return <ImportPreview key={id} importId={id} />;
}
