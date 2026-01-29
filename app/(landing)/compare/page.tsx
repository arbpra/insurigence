import Link from 'next/link';
import Logo from '@/app/components/Logo';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Insurigence vs AMS, CRM, and Insurance Software',
  description: 'Compare Insurigence to AMS platforms, CRMs, carrier portals, and underwriting tools for commercial insurance placement decisions.',
};

export default function Compare() {
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
              <Link href="/why-insurigence" className="text-sm font-medium transition-colors hover:opacity-70" style={{ color: '#0D2137' }}>
                Why Insurigence
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
      <section className="w-full py-20 bg-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6" style={{ color: '#0D2137' }}>
            Insurigence compared to other insurance software
          </h1>
          <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
            Insurance agencies use many tools to run their business. Most were not built to solve one specific problem.
          </p>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            Knowing where a commercial risk belongs before submission.
          </p>
          <p className="text-base leading-relaxed mt-6" style={{ color: '#64748B' }}>
            Below is how Insurigence compares to common categories of insurance software agencies already know.
          </p>
        </div>
      </section>

      {/* Insurigence vs Applied Epic and Vertafore AMS */}
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-8" style={{ color: '#0D2137' }}>
            Insurigence vs Applied Epic and Vertafore AMS platforms
          </h2>
          
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-2xl p-6 border border-slate-200/60">
              <h3 className="text-lg font-semibold mb-3" style={{ color: '#64748B' }}>Applied Epic and Vertafore</h3>
              <p className="text-base leading-relaxed" style={{ color: '#64748B' }}>
                These platforms are agency management systems. They store policies, documents, billing, and servicing data after placement.
              </p>
            </div>
            <div className="rounded-2xl p-6" style={{ backgroundColor: '#0D2137' }}>
              <h3 className="text-lg font-semibold mb-3" style={{ color: '#00E6A7' }}>Insurigence</h3>
              <p className="text-base leading-relaxed text-white">
                Insurigence focuses on placement decisions before submission. It evaluates risk, supports standard vs E&S decisions, and helps teams understand market fit.
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 p-4 rounded-xl" style={{ backgroundColor: '#00E6A7' }}>
            <svg className="w-6 h-6 flex-shrink-0 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-base font-medium text-white">Why agencies use both: AMS platforms manage records. Insurigence helps agencies decide what to submit and where.</span>
          </div>
        </div>
      </section>

      {/* Insurigence vs Salesforce and insurance CRMs */}
      <section className="w-full py-16 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-8" style={{ color: '#0D2137' }}>
            Insurigence vs Salesforce and insurance CRMs
          </h2>
          
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <div className="rounded-2xl p-6 border border-slate-200/60" style={{ backgroundColor: '#F5F7FA' }}>
              <h3 className="text-lg font-semibold mb-3" style={{ color: '#64748B' }}>Salesforce and CRMs</h3>
              <p className="text-base leading-relaxed" style={{ color: '#64748B' }}>
                CRMs manage leads, pipeline, tasks, and communication. They help producers track sales activity.
              </p>
            </div>
            <div className="rounded-2xl p-6" style={{ backgroundColor: '#0D2137' }}>
              <h3 className="text-lg font-semibold mb-3" style={{ color: '#00E6A7' }}>Insurigence</h3>
              <p className="text-base leading-relaxed text-white">
                Insurigence evaluates risk characteristics and placement viability. It does not track deals or contacts.
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 p-4 rounded-xl" style={{ backgroundColor: '#00E6A7' }}>
            <svg className="w-6 h-6 flex-shrink-0 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-base font-medium text-white">Why agencies use both: CRMs manage sales activity. Insurigence manages placement insight.</span>
          </div>
        </div>
      </section>

      {/* Insurigence vs Carrier Portals */}
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-8" style={{ color: '#0D2137' }}>
            Insurigence vs carrier portals
          </h2>
          
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-2xl p-6 border border-slate-200/60">
              <h3 className="text-lg font-semibold mb-3" style={{ color: '#64748B' }}>Carrier portals</h3>
              <p className="text-base leading-relaxed" style={{ color: '#64748B' }}>
                Carrier portals reflect one carrier&apos;s underwriting appetite and rules.
              </p>
            </div>
            <div className="rounded-2xl p-6" style={{ backgroundColor: '#0D2137' }}>
              <h3 className="text-lg font-semibold mb-3" style={{ color: '#00E6A7' }}>Insurigence</h3>
              <p className="text-base leading-relaxed text-white">
                Insurigence is market agnostic. It helps agencies understand overall market direction before choosing which carriers to approach.
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 p-4 rounded-xl" style={{ backgroundColor: '#00E6A7' }}>
            <svg className="w-6 h-6 flex-shrink-0 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-base font-medium text-white">Why agencies use both: Carrier portals are necessary for submissions. Insurigence helps agencies decide which submissions are worth making.</span>
          </div>
        </div>
      </section>

      {/* Insurigence vs Spreadsheets */}
      <section className="w-full py-16 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-8" style={{ color: '#0D2137' }}>
            Insurigence vs spreadsheets and internal guidelines
          </h2>
          
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <div className="rounded-2xl p-6 border border-slate-200/60" style={{ backgroundColor: '#F5F7FA' }}>
              <h3 className="text-lg font-semibold mb-3" style={{ color: '#64748B' }}>Spreadsheets and internal documents</h3>
              <p className="text-base leading-relaxed mb-3" style={{ color: '#64748B' }}>
                Many agencies rely on notes, memory, and informal guidelines built over time.
              </p>
              <p className="text-base leading-relaxed" style={{ color: '#64748B' }}>
                This approach is difficult to maintain, inconsistent across teams, and hard to scale.
              </p>
            </div>
            <div className="rounded-2xl p-6" style={{ backgroundColor: '#0D2137' }}>
              <h3 className="text-lg font-semibold mb-3" style={{ color: '#00E6A7' }}>Insurigence</h3>
              <p className="text-base leading-relaxed text-white">
                Insurigence creates a centralized, structured decision framework that works across offices and experience levels.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Insurigence vs AI Underwriting */}
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-8" style={{ color: '#0D2137' }}>
            Insurigence vs AI underwriting and automation tools
          </h2>
          
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-2xl p-6 border border-slate-200/60">
              <h3 className="text-lg font-semibold mb-3" style={{ color: '#64748B' }}>Automated underwriting tools</h3>
              <p className="text-base leading-relaxed mb-3" style={{ color: '#64748B' }}>
                Some tools attempt to replace underwriting decisions with automation.
              </p>
              <p className="text-base leading-relaxed" style={{ color: '#64748B' }}>
                This often raises compliance concerns and trust issues with agencies and carriers.
              </p>
            </div>
            <div className="rounded-2xl p-6" style={{ backgroundColor: '#0D2137' }}>
              <h3 className="text-lg font-semibold mb-3" style={{ color: '#00E6A7' }}>Insurigence</h3>
              <p className="text-base leading-relaxed text-white">
                Insurigence provides decision support, not automated underwriting or binding.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Where Insurigence Fits */}
      <section className="w-full py-16 bg-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Where Insurigence fits best
          </h2>
          <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
            Insurigence complements existing systems.
          </p>
          <p className="text-lg leading-relaxed mb-8" style={{ color: '#0D2137' }}>
            It fits between intake and carrier quoting to help agencies:
          </p>
          
          <div className="grid md:grid-cols-3 gap-6 max-w-3xl mx-auto">
            <div className="bg-white rounded-xl p-6 border border-slate-200/60">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#00E6A7' }}>
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-base font-medium" style={{ color: '#0D2137' }}>Reduce declinations</p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-slate-200/60">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#00E6A7' }}>
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <p className="text-base font-medium" style={{ color: '#0D2137' }}>Improve placement efficiency</p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-slate-200/60">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#00E6A7' }}>
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <p className="text-base font-medium" style={{ color: '#0D2137' }}>Scale consistency without replacing core systems</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="w-full py-20" style={{ backgroundColor: '#0D2137' }}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-8">
            See how Insurigence fits your workflow
          </h2>
          
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
            <Link
              href="/sample-proposal"
              className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold rounded-xl transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-2 border-white/30"
              style={{ color: 'white', backgroundColor: 'transparent' }}
              data-testid="cta-sample-proposal"
            >
              See a Sample Proposal
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
