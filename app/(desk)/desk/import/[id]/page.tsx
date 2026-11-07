import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { ImportMapper } from '@/components/desk/imports/ImportMapper';

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const access = await deskPageAccess('AGENCY', '/desk/import');
  if (!access) return null;
  const { id } = await params;
  return <ImportMapper key={id} importId={id} />;
}
