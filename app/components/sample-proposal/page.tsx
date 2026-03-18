import Link from 'next/link';
import Logo from '@/app/components/Logo';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Commercial Insurance Proposal Example | Insurigence',
  description: 'See how Insurigence helps agencies create clear, professional insurance proposals that explain placement decisions and coverage options.',
};

export default function SampleProposal() {
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
              <Link href="/sample-proposal" className="text-sm font-medium transition-colors" style={{ color: '#00E6A7' }}>
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
            See a sample insurance proposal
          </h1>
          <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
            Commercial insureds often ask a simple question.
          </p>
          <p className="text-xl leading-relaxed font-medium mb-4" style={{ color: '#0D2137' }}>
            &quot;Why was this placed here, and not somewhere else?&quot;
          </p>
          <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
            Insurigence helps agencies answer that clearly and professionally.
          </p>
        </div>
      </section>

      {/* What the Sample Shows */}
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#0D2137' }}>
            What the sample proposal shows
          </h2>
          <p className="text-lg leading-relaxed mb-6" style={{ color: '#64748B' }}>
            This sample demonstrates how Insurigence helps agencies:
          </p>
          <ul className="space-y-4">
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Explain market direction decisions</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Show why certain carriers were approached</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Clarify why others were not a fit</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Present coverage options transparently</span>
            </li>
          </ul>
          <p className="text-lg leading-relaxed font-medium mt-6" style={{ color: '#0D2137' }}>
            The goal is confidence, not confusion.
          </p>
        </div>
      </section>

      {/* Why This Matters */}
      <section className="w-full py-16 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Why this matters
          </h2>
          <p className="text-lg leading-relaxed mb-6" style={{ color: '#64748B' }}>
            Clear proposals:
          </p>
          <ul className="space-y-4 mb-6">
            <li className="flex items-start gap-4 p-4 bg-[#F5F7FA] rounded-xl">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Reduce back-and-forth questions</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-[#F5F7FA] rounded-xl">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Improve trust with insureds</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-[#F5F7FA] rounded-xl">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Support producer credibility</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-[#F5F7FA] rounded-xl">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Protect agencies when decisions are challenged</span>
            </li>
          </ul>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            Insurigence turns internal placement logic into client-ready communication.
          </p>
        </div>
      </section>

      {/* Designed for Real Conversations */}
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Designed for real conversations
          </h2>
          <p className="text-lg leading-relaxed mb-6" style={{ color: '#64748B' }}>
            Sample proposals are:
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="flex items-center gap-3 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Plain-language</span>
            </div>
            <div className="flex items-center gap-3 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Professionally formatted</span>
            </div>
            <div className="flex items-center gap-3 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Easy to understand for non-insurance buyers</span>
            </div>
            <div className="flex items-center gap-3 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Aligned with how agencies sell and service</span>
            </div>
          </div>
        </div>
      </section>

      {/* Compliance Notice */}
      <section className="w-full py-16 bg-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-8" style={{ backgroundColor: '#00E6A7', color: 'white' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Important Note
          </div>
          
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Not a quote. Not a binder.
          </h2>
          
          <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
            Sample proposals explain decisions. They do not replace carrier quotes or underwriting.
          </p>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            All final pricing, terms, and binding remain with carriers and licensed professionals.
          </p>
        </div>
      </section>

      {/* CTA Section */}
      <section className="w-full py-20" style={{ backgroundColor: '#0D2137' }}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-8">
            Want to see how it works for your agency?
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
