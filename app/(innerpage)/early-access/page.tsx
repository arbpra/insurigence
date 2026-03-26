import Link from 'next/link';
import EarlyAccessBanner from '../../components/home-banner/early-access-banner';
import EarlyAccessAbout from '../../components/about-us/early-access-about';
import WhyShouldJoin from '../../components/features/why-should-join';
import EarlyAccessCTA from '../../components/call-to-action-footer/early-access-cta';
import WhatToExpect from '../../components/what-to-expect/page';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Commercial Insurance Appetite Intelligence Software | Insurigence',
  description: 'Insurigence is commercial insurance appetite intelligence software that helps agencies determine standard vs E&S market fit, reduce carrier declinations, and improve placement decisions.',
};

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: '#F5F7FA' }}>
      <EarlyAccessBanner />
      <EarlyAccessAbout />
      <WhatToExpect />
      <WhyShouldJoin />
      <EarlyAccessCTA />
    </div>
  );
}
