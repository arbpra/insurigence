import Link from 'next/link';
import Herobanner from '../components/home-banner/page';
import AboutUs from '../components/about-us/page';
import Features from '../components/features/page';
import CallToAction from '../components/call-to-action/page';
import Services from '../components/services/page';
import OurAim from '../components/our-aim/page';
import CallToActionFooter from '../components/call-to-action-footer/page';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Commercial Insurance Appetite Intelligence Software | Insurigence',
  description: 'Insurigence is commercial insurance appetite intelligence software that helps agencies determine standard vs E&S market fit, reduce carrier declinations, and improve placement decisions.',
};

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: '#F5F7FA' }}>
      <Herobanner />
      <AboutUs />
      <Features />
      <CallToAction />
      <Services />
      <OurAim />
      <CallToActionFooter />
    </div>
  );
}
