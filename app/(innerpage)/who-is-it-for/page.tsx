import Link from 'next/link';
import WhoIsItForBanner from '../../components/home-banner/who-is-it-for-banner';
import WhoIsItForAbout from '../../components/about-us/who-is-it-for-about';
import InsuranceFor from '../../components/insurance-for/page';
import WhoIsItForCTA from '../../components/call-to-action-footer/who-is-it-for-cta';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Commercial Insurance Appetite Intelligence Software | Insurigence',
  description: 'Insurigence is commercial insurance appetite intelligence software that helps agencies determine standard vs E&S market fit, reduce carrier declinations, and improve placement decisions.',
};

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: '#F5F7FA' }}>
      <WhoIsItForBanner />
      <WhoIsItForAbout />
      <InsuranceFor />
      <WhoIsItForCTA />
    </div>
  );
}
