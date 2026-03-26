import Link from 'next/link';
import TalkToInsurigenceBanner from '../../components/home-banner/talk-to-insurigence-banner';
import TalkToInsurigenceAbout from '../../components/about-us/talk-to-insurigence-about';
import WhyShouldJoin from '../../components/features/why-should-join';
import TalkToInsurigenceCTA from '../../components/call-to-action-footer/talk-to-insurigence-cta';
import TalkToInsurigenceCTA2 from '../../components/call-to-action-footer/talk-to-insurigence-cta-2';
import WhatToExpect from '../../components/what-to-expect/page';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Commercial Insurance Appetite Intelligence Software | Insurigence',
  description: 'Insurigence is commercial insurance appetite intelligence software that helps agencies determine standard vs E&S market fit, reduce carrier declinations, and improve placement decisions.',
};

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: '#F5F7FA' }}>
      <TalkToInsurigenceBanner />
      <TalkToInsurigenceAbout />
      <TalkToInsurigenceCTA />
      <TalkToInsurigenceCTA2 />
    </div>
  );
}
