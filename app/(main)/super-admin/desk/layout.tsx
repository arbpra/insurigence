import { DeskAreaLayout } from '@/components/desk/DeskAreaLayout';

export const dynamic = 'force-dynamic';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <DeskAreaLayout area="ADMIN" embedded>{children}</DeskAreaLayout>;
}
