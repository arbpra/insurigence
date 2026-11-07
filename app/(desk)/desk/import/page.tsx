import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { ImportCenter } from '@/components/desk/imports/ImportCenter';

export default async function Page() {
  const access = await deskPageAccess('AGENCY', '/desk/import');
  if (!access) return null;
  return <ImportCenter />;
}
