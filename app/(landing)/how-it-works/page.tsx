import Link from 'next/link';
import Logo from '@/app/components/Logo';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'How Commercial Insurance Appetite Intelligence Works | Insurigence',
  description: 'Learn how Insurigence helps commercial insurance agencies evaluate risk, determine standard vs E&S fit, and improve placement decisions before submission.',
};

export default function HowItWorks() {
  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: '#F5F7FA' }}>
      {/* Header */}
      <header className="w-full bg-white border-b border-slate-200/80 sticky top-0 z-50">
        <div className="w-full px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/"><Logo size="md" /></Link>

            <nav className="hidden md:flex items-center gap-6">
              <Link href="/how-it-works" className="text-sm font-medium transition-colors" style={{ color: '#00E6A7' }}>
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
            How Insurigence works
          </h1>
          <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
            Insurigence brings structure and clarity to one of the most uncertain parts of commercial insurance. Deciding where a risk belongs before submission.
          </p>
          <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
            The platform sits between intake and carrier quoting, helping agencies evaluate risk, determine market direction, and communicate decisions clearly.
          </p>
        </div>
      </section>

      {/* Step 1 */}
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6">
          <div className="flex items-start gap-6">
            <div className="flex-shrink-0 flex items-center justify-center w-14 h-14 rounded-full text-xl font-bold" style={{ backgroundColor: '#0D2137', color: 'white' }}>
              1
            </div>
            <div>
              <h2 className="text-2xl md:text-3xl font-bold mb-4" style={{ color: '#0D2137' }}>
                Capture the right intake data
              </h2>
              <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
                Insurigence starts with structured intake designed for underwriting relevance, not just application completion.
              </p>
              <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
                Instead of generic forms, the platform focuses on the operational, exposure, and classification details that actually influence carrier appetite and placement outcomes.
              </p>
              <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
                This ensures decisions are based on consistent, meaningful inputs across your team.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Step 2 */}
      <section className="w-full py-16 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <div className="flex items-start gap-6">
            <div className="flex-shrink-0 flex items-center justify-center w-14 h-14 rounded-full text-xl font-bold" style={{ backgroundColor: '#00E6A7', color: 'white' }}>
              2
            </div>
            <div>
              <h2 className="text-2xl md:text-3xl font-bold mb-4" style={{ color: '#0D2137' }}>
                Evaluate risk characteristics
              </h2>
              <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
                Once intake data is captured, Insurigence evaluates key risk signals such as:
              </p>
              <ul className="space-y-3 mb-6">
                <li className="flex items-start gap-3">
                  <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-lg" style={{ color: '#0D2137' }}>Operational complexity</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-lg" style={{ color: '#0D2137' }}>Industry classification alignment</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-lg" style={{ color: '#0D2137' }}>Exposure severity indicators</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-lg" style={{ color: '#0D2137' }}>Red flags that commonly trigger declinations</span>
                </li>
              </ul>
              <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
                The goal is not to replace judgment. It is to surface insights early so teams know what they are dealing with before submissions begin.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Step 3 */}
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6">
          <div className="flex items-start gap-6">
            <div className="flex-shrink-0 flex items-center justify-center w-14 h-14 rounded-full text-xl font-bold" style={{ backgroundColor: '#0D2137', color: 'white' }}>
              3
            </div>
            <div>
              <h2 className="text-2xl md:text-3xl font-bold mb-4" style={{ color: '#0D2137' }}>
                Determine market direction
              </h2>
              <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
                Based on the evaluated risk profile, Insurigence helps agencies understand whether a risk is more likely to align with standard or E&S markets.
              </p>
              <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
                This step helps teams avoid unrealistic submissions, reduce carrier fatigue, and set better expectations internally and with insureds.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Step 4 */}
      <section className="w-full py-16 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <div className="flex items-start gap-6">
            <div className="flex-shrink-0 flex items-center justify-center w-14 h-14 rounded-full text-xl font-bold" style={{ backgroundColor: '#00E6A7', color: 'white' }}>
              4
            </div>
            <div>
              <h2 className="text-2xl md:text-3xl font-bold mb-4" style={{ color: '#0D2137' }}>
                Identify realistic carrier profiles
              </h2>
              <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
                Rather than submitting blindly, Insurigence provides guidance on which types of carriers are more likely to consider the risk based on its characteristics.
              </p>
              <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
                This does not guarantee acceptance. It improves focus, efficiency, and consistency across placement decisions.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Step 5 */}
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6">
          <div className="flex items-start gap-6">
            <div className="flex-shrink-0 flex items-center justify-center w-14 h-14 rounded-full text-xl font-bold" style={{ backgroundColor: '#0D2137', color: 'white' }}>
              5
            </div>
            <div>
              <h2 className="text-2xl md:text-3xl font-bold mb-4" style={{ color: '#0D2137' }}>
                Support clearer proposals
              </h2>
              <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
                Insurigence helps generate professional, easy-to-understand proposals that explain:
              </p>
              <ul className="space-y-3 mb-6">
                <li className="flex items-start gap-3">
                  <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-lg" style={{ color: '#0D2137' }}>Why certain markets were pursued</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-lg" style={{ color: '#0D2137' }}>Why others were not</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-lg" style={{ color: '#0D2137' }}>What coverage options are realistic</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-lg" style={{ color: '#0D2137' }}>How placement decisions were made</span>
                </li>
              </ul>
              <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
                This improves transparency and trust with insureds.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Compliance Section */}
      <section className="w-full py-16 bg-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-8" style={{ backgroundColor: '#00E6A7', color: 'white' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Decision Support
          </div>
          
          <h2 className="text-2xl md:text-3xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Built to support licensed professionals
          </h2>
          
          <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
            Insurigence does not quote pricing, bind coverage, or make final underwriting decisions. All recommendations are guidance only.
          </p>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            Final placement decisions always remain with licensed insurance professionals and carriers.
          </p>
        </div>
      </section>

      {/* CTA Section */}
      <section className="w-full py-20" style={{ backgroundColor: '#0D2137' }}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-8">
            Ready to see it in action?
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
