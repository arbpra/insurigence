import Link from 'next/link';
import WhoIsItForBanner from '../../components/home-banner/platform-banner';
import WhoIsItForAbout from '../../components/about-us/platform-about';
import PlatformFeatures from '../../components/features/platform-features';
import WhoIsItForCTA from '../../components/call-to-action-footer/platform-cta-2';
import PlatformForCTA from '../../components/call-to-action-footer/platform-below-cta-2';
import PlatformAim from '../../components/our-aim/platform-aim';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Commercial Insurance Appetite Intelligence Software | Insurigence',
  description: 'Insurigence is commercial insurance appetite intelligence software that helps agencies determine standard vs E&S market fit, reduce carrier declinations, and improve placement decisions.',
};

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: '#F5F7FA' }}>
      <WhoIsItForBanner />
      <PlatformFeatures />
      <WhoIsItForAbout />
      <PlatformAim />      
      <WhoIsItForCTA />
      <PlatformForCTA />
    </div>
  );
}
