import Link from 'next/link';
import Herobanner from '../(landing)/home-banner/page';
import AboutUs from '../(landing)/about-us/page';
import Features from '../(landing)/features/page';
import CallToAction from '../(landing)/call-to-action/page';
import Services from '../(landing)/services/page';
import OurAim from '../(landing)/our-aim/page';
import CallToActionFooter from '../(landing)/call-to-action-footer/page';
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
