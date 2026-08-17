import { ReactNode } from 'react';
import Header from '../../components/header/page';
import Footer from '../../components/footer/page';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "The Desk by Insurigence — Your Agency's Back Office, Fully Handled",
  description:
    'The Desk by Insurigence handles renewals, endorsements, COIs, and new business support for independent commercial insurance agencies — so you can scale without adding headcount.',
};

export default function TheDeskLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: '#F5F7FA' }}>
      <Header />
      {children}
      <Footer />
    </div>
  );
}
