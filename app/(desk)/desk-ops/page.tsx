import { deskPageAccess } from '@/components/desk/DeskAreaLayout';
import { ManagerDashboard } from '@/components/desk/dashboard/ManagerDashboard';
import { VaOverview } from '@/components/desk/dashboard/VaOverview';
import { parseRenewalWindow } from '@/lib/desk/dashboard-view';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The operations overview. Account and Operations Managers get the dashboard
 * across their agencies; a VA gets their own work, not agency-wide figures (Q4).
 */
export default async function Page({ searchParams }: Props) {
  const access = await deskPageAccess('OPS', '/desk-ops');
  if (!access) return null;
  if (access.scope.kind === 'VA') return <VaOverview />;
  return <ManagerDashboard initialWindow={parseRenewalWindow((await searchParams).renewals)} />;
}
