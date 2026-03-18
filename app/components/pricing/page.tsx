import Link from 'next/link';
import Logo from '@/app/components/Logo';
import PricingTable from '@/components/pricing/PricingTable';
import PricingFAQ from '@/components/pricing/PricingFAQ';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pricing - Commercial Insurance Placement Intelligence | Insurigence',
  description: 'Choose the right Insurigence plan for your agency. Solo, Growth, or Multi-Location options with structured intake, market classification, and client-ready proposals.',
};

export default function Pricing() {
  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: '#F5F7FA' }}>
      {/* Header */}
      <header className="w-full bg-white border-b border-slate-200/80 sticky top-0 z-50">
        <div className="w-full px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/"><Logo size="md" /></Link>

            <nav className="hidden md:flex items-center gap-6">
              <Link href="/how-it-works" className="text-sm font-medium transition-colors hover:opacity-70" style={{ color: '#0D2137' }}>
                How It Works
              </Link>
              <Link href="/who-its-for" className="text-sm font-medium transition-colors hover:opacity-70" style={{ color: '#0D2137' }}>
                Who It&apos;s For
              </Link>
              <Link href="/pricing" className="text-sm font-medium transition-colors hover:opacity-70" style={{ color: '#00E6A7' }}>
                Pricing
              </Link>
              <Link href="/sample-proposal" className="text-sm font-medium transition-colors hover:opacity-70" style={{ color: '#0D2137' }}>
                Sample Proposal
              </Link>
            </nav>

            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 hover:opacity-90"
                style={{ backgroundColor: '#0D2137', color: 'white' }}
                data-testid="header-login"
              >
                Log In
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="w-full py-16 md:py-20 bg-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <p className="text-sm font-medium tracking-wide uppercase mb-4" style={{ color: '#00E6A7' }}>
            PRICING
          </p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6" style={{ color: '#0D2137' }}>
            The right plan. The right placement decisions.
          </h1>
          <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
            Start with a quick demo. Get set up fast. Cancel anytime.
          </p>
        </div>
      </section>

      {/* Pricing Table Section */}
      <section className="w-full py-12 md:py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-6xl mx-auto px-6">
          <PricingTable />
        </div>
      </section>

      {/* FAQ Section */}
      <section className="w-full py-16 md:py-20 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <PricingFAQ />
        </div>
      </section>

      {/* CTA Section */}
      <section className="w-full py-20" style={{ backgroundColor: '#0D2137' }}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Ready to see how Insurigence works for you?
          </h2>
          <p className="text-lg mb-8" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Schedule a quick demo and see placement intelligence in action.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="https://meetings-na2.hubspot.com/logan-kutz"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold rounded-xl transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
              style={{ backgroundColor: '#00E6A7', color: 'white' }}
              data-testid="cta-request-demo"
            >
              Request a Demo
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </a>
            <Link
              href="/#contact"
              className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold rounded-xl transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-2 border-white/30"
              style={{ color: 'white', backgroundColor: 'transparent' }}
              data-testid="cta-talk-to-us"
            >
              Talk to Us
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full mt-auto bg-white border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-12">
            <div className="col-span-2 md:col-span-1">
              <Logo size="sm" />
              <p className="text-sm leading-relaxed mt-4" style={{ color: '#64748B' }}>
                Commercial insurance appetite intelligence for agencies who value clarity and efficiency.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-4" style={{ color: '#0D2137' }}>Product</h4>
              <ul className="space-y-3">
                <li><Link href="/how-it-works" className="text-sm transition-colors hover:opacity-70" style={{ color: '#64748B' }}>How It Works</Link></li>
                <li><Link href="/who-its-for" className="text-sm transition-colors hover:opacity-70" style={{ color: '#64748B' }}>Who It&apos;s For</Link></li>
                <li><Link href="/why-insurigence" className="text-sm transition-colors hover:opacity-70" style={{ color: '#64748B' }}>Why Insurigence</Link></li>
                <li><Link href="/sample-proposal" className="text-sm transition-colors hover:opacity-70" style={{ color: '#64748B' }}>Sample Proposal</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-4" style={{ color: '#0D2137' }}>Resources</h4>
              <ul className="space-y-3">
                <li><Link href="/faq" className="text-sm transition-colors hover:opacity-70" style={{ color: '#64748B' }}>FAQ</Link></li>
                <li><Link href="/compare" className="text-sm transition-colors hover:opacity-70" style={{ color: '#64748B' }}>Compare</Link></li>
                <li><Link href="/pricing" className="text-sm transition-colors hover:opacity-70" style={{ color: '#64748B' }}>Pricing</Link></li>
                <li><Link href="/#contact" className="text-sm transition-colors hover:opacity-70" style={{ color: '#64748B' }}>Contact</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-4" style={{ color: '#0D2137' }}>Legal</h4>
              <ul className="space-y-3">
                <li><a href="#" className="text-sm transition-colors hover:opacity-70" style={{ color: '#64748B' }}>Privacy Policy</a></li>
                <li><a href="#" className="text-sm transition-colors hover:opacity-70" style={{ color: '#64748B' }}>Terms of Service</a></li>
              </ul>
            </div>
          </div>
          
          <div className="pt-8 border-t border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm" style={{ color: '#94A3B8' }}>
              &copy; 2026 Insurigence. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
