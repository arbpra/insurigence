import Link from 'next/link';
import Logo from '@/app/components/Logo';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Commercial Insurance Appetite Intelligence FAQ | Insurigence',
  description: 'Answers to common questions about Insurigence, commercial insurance appetite intelligence, standard vs E&S decisions, and placement guidance.',
};

export default function FAQ() {
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
            Frequently asked questions
          </h1>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6 space-y-8">
          
          {/* Question 1 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              What does Insurigence do?
            </h2>
            <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
              Insurigence is commercial insurance appetite and placement intelligence software.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              It helps agencies evaluate risk, determine standard versus E&S market direction, identify realistic carrier profiles, and communicate placement decisions clearly before submission.
            </p>
          </div>

          {/* Question 2 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              Does Insurigence quote insurance?
            </h2>
            <p className="text-lg leading-relaxed mb-4 font-medium" style={{ color: '#0D2137' }}>
              No.
            </p>
            <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
              Insurigence does not quote pricing, provide bindable terms, or replace carrier underwriting.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              All pricing, underwriting, and binding decisions remain with carriers and licensed insurance professionals.
            </p>
          </div>

          {/* Question 3 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              Is Insurigence an AMS or CRM?
            </h2>
            <p className="text-lg leading-relaxed mb-4 font-medium" style={{ color: '#0D2137' }}>
              No.
            </p>
            <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
              Insurigence is not an agency management system or CRM, and it is not designed to replace either.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              It complements existing systems by sitting between intake and carrier quoting.
            </p>
          </div>

          {/* Question 4 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              Who is Insurigence built for?
            </h2>
            <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
              Insurigence is built for:
            </p>
            <ul className="space-y-2">
              <li className="flex items-start gap-3">
                <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-lg" style={{ color: '#0D2137' }}>Independent commercial insurance agencies</span>
              </li>
              <li className="flex items-start gap-3">
                <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-lg" style={{ color: '#0D2137' }}>Wholesale brokers and MGAs</span>
              </li>
              <li className="flex items-start gap-3">
                <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-lg" style={{ color: '#0D2137' }}>Program administrators</span>
              </li>
              <li className="flex items-start gap-3">
                <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-lg" style={{ color: '#0D2137' }}>Growing teams that need consistent placement guidance</span>
              </li>
            </ul>
          </div>

          {/* Question 5 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              How does Insurigence help reduce declinations?
            </h2>
            <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
              Insurigence helps teams evaluate risk earlier, identify misalignment before submission, and focus on markets that are more realistic for the risk profile.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              This reduces wasted submissions and improves overall placement efficiency.
            </p>
          </div>

          {/* Question 6 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              Does Insurigence replace professional judgment?
            </h2>
            <p className="text-lg leading-relaxed mb-4 font-medium" style={{ color: '#0D2137' }}>
              No.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              Insurigence supports licensed professionals by providing structure and insight. Final decisions always remain with the agency and carrier.
            </p>
          </div>

          {/* Question 7 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              Is Insurigence compliant with insurance regulations?
            </h2>
            <p className="text-lg leading-relaxed mb-4 font-medium" style={{ color: '#0D2137' }}>
              Yes.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              Insurigence is designed as decision support software. It does not perform regulated activities such as quoting, underwriting authority, or binding coverage.
            </p>
          </div>

          {/* Question 8 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              How long does implementation take?
            </h2>
            <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
              Most agencies can begin using Insurigence quickly, with minimal disruption to existing workflows.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              Exact timelines depend on agency size and configuration.
            </p>
          </div>

          {/* Question 9 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              Can Insurigence be customized?
            </h2>
            <p className="text-lg leading-relaxed mb-4 font-medium" style={{ color: '#0D2137' }}>
              Yes.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              Insurigence is designed to adapt to different agency workflows, risk types, and internal processes.
            </p>
          </div>

          {/* Question 10 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              How do we get started?
            </h2>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              The best way to get started is to request a demo.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="w-full py-20" style={{ backgroundColor: '#0D2137' }}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-8">
            Have more questions?
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
