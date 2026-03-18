import Link from 'next/link';
import Logo from '@/app/components/Logo';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Why Commercial Insurance Agencies Choose Insurigence',
  description: 'Insurigence helps commercial insurance agencies reduce declinations, improve placement decisions, and bring clarity to standard vs E&S market direction.',
};

export default function WhyInsurgence() {
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
              <Link href="/why-insurigence" className="text-sm font-medium transition-colors" style={{ color: '#00E6A7' }}>
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
            Why Insurigence
          </h1>
          <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
            Commercial insurance placement has become more complex, not less. Carrier appetites shift. Risks are scrutinized more closely. Teams are under pressure to move faster with fewer mistakes.
          </p>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            Insurigence exists to bring clarity, consistency, and confidence to commercial insurance placement decisions.
          </p>
        </div>
      </section>

      {/* Built Around Real Problems */}
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Built around real agency problems
          </h2>
          <p className="text-lg leading-relaxed mb-6" style={{ color: '#64748B' }}>
            Agencies struggle with the same challenges every day:
          </p>
          <ul className="space-y-4 mb-6">
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#EF4444' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Submitting risks that were never viable</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#EF4444' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Unclear standard versus E&S decisions</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#EF4444' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Dependence on a few experienced individuals</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#EF4444' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Inconsistent guidance across teams</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#EF4444' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Difficulty explaining placement decisions to insureds</span>
            </li>
          </ul>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            Insurigence was built specifically to solve these problems, not to replace existing systems or workflows.
          </p>
        </div>
      </section>

      {/* Placement Intelligence */}
      <section className="w-full py-16 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Placement intelligence, not hype
          </h2>
          <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
            Insurigence does not promise automated underwriting or instant answers.
          </p>
          <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
            Instead, it provides structured intake, risk evaluation, and appetite guidance that supports licensed professionals in making better decisions earlier in the process.
          </p>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            This keeps judgment where it belongs. With the agency.
          </p>
        </div>
      </section>

      {/* Reduce Declinations */}
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Designed to reduce declinations
          </h2>
          <p className="text-lg leading-relaxed mb-6" style={{ color: '#64748B' }}>
            Every declination costs time, credibility, and momentum. Insurigence helps agencies:
          </p>
          <ul className="space-y-3 mb-6">
            <li className="flex items-start gap-3">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Identify misaligned risks earlier</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Avoid unrealistic submissions</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Focus on markets that make sense</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Improve carrier relationships over time</span>
            </li>
          </ul>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            Better submissions lead to better outcomes.
          </p>
        </div>
      </section>

      {/* Consistency at Scale */}
      <section className="w-full py-16 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Consistency at scale
          </h2>
          <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
            As agencies grow, consistency becomes harder to maintain.
          </p>
          <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
            Insurigence provides a shared framework for evaluating and placing risk so that decisions do not depend on who happens to be available or how long they have been in the industry.
          </p>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            This supports growth without sacrificing quality.
          </p>
        </div>
      </section>

      {/* Clearer Communication */}
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Clearer communication with insureds
          </h2>
          <p className="text-lg leading-relaxed mb-6" style={{ color: '#64748B' }}>
            Insureds expect transparency. Insurigence helps agencies explain:
          </p>
          <ul className="space-y-3 mb-6">
            <li className="flex items-start gap-3">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Why a risk was placed in a certain market</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Why some carriers were not approached</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>What options are realistic</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>How coverage decisions were made</span>
            </li>
          </ul>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            Clear explanations build trust and reduce friction.
          </p>
        </div>
      </section>

      {/* Compliance Section */}
      <section className="w-full py-16 bg-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-8" style={{ backgroundColor: '#00E6A7', color: 'white' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Compliance & Trust
          </div>
          
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Built for compliance and trust
          </h2>
          
          <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
            Insurigence does not quote pricing, bind coverage, or replace licensed professionals.
          </p>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            The platform provides guidance only. All final placement decisions remain with the agency and carrier.
          </p>
        </div>
      </section>

      {/* CTA Section */}
      <section className="w-full py-20" style={{ backgroundColor: '#0D2137' }}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-8">
            Ready to bring clarity to your placement decisions?
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
