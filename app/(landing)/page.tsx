import Link from 'next/link';
import Logo from '@/app/components/Logo';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Commercial Insurance Appetite Intelligence Software | Insurigence',
  description: 'Insurigence is commercial insurance appetite intelligence software that helps agencies determine standard vs E&S market fit, reduce carrier declinations, and improve placement decisions.',
};

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: '#F5F7FA' }}>
      {/* Header */}
      <header className="w-full bg-white border-b border-slate-200/80 sticky top-0 z-50">
        <div className="w-full px-6 py-4">
          <div className="flex items-center justify-between">
            <Logo size="md" />

            <nav className="hidden md:flex items-center gap-6">
              <Link href="/how-it-works" className="text-sm font-medium transition-colors hover:opacity-70" style={{ color: '#0D2137' }}>
                How It Works
              </Link>
              <Link href="/who-its-for" className="text-sm font-medium transition-colors hover:opacity-70" style={{ color: '#0D2137' }}>
                Who It&apos;s For
              </Link>
              <Link href="/pricing" className="text-sm font-medium transition-colors hover:opacity-70" style={{ color: '#0D2137' }}>
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
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                Log In
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="w-full relative overflow-hidden" style={{ backgroundColor: '#00E6A7' }}>
        <div 
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, #0D2137 1px, transparent 0)`,
            backgroundSize: '24px 24px'
          }}
        ></div>
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-[#0D2137]/10"></div>
        <div className="absolute top-20 left-10 w-72 h-72 bg-white/20 rounded-full blur-3xl"></div>
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-[#0D2137]/10 rounded-full blur-3xl"></div>
        
        <div className="relative max-w-5xl mx-auto px-6 py-24 md:py-32 text-center">
          <p className="text-sm font-medium tracking-wide uppercase mb-4" style={{ color: '#0D2137' }}>
            Commercial Insurance Appetite Intelligence
          </p>
          
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-tight" style={{ color: '#0D2137' }}>
            Make placement decisions with confidence
          </h1>
          
          <p className="text-lg md:text-xl max-w-3xl mx-auto leading-relaxed mb-10" style={{ color: '#0D2137', opacity: 0.85 }}>
            See how Insurigence helps commercial insurance teams reduce declinations, improve placement efficiency, and communicate more clearly with insureds.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="https://meetings-na2.hubspot.com/logan-kutz"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold rounded-xl transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:opacity-90"
              style={{ backgroundColor: '#0D2137', color: 'white' }}
              data-testid="hero-request-demo"
            >
              Request a Demo
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </a>
            <a
              href="#contact"
              className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold rounded-xl transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-2"
              style={{ borderColor: '#0D2137', color: '#0D2137', backgroundColor: 'transparent' }}
              data-testid="hero-talk-to-us"
            >
              Talk to Us
            </a>
            <Link
              href="/sample-proposal"
              className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold rounded-xl transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-2"
              style={{ borderColor: '#0D2137', color: '#0D2137', backgroundColor: 'transparent' }}
              data-testid="hero-sample-proposal"
            >
              See a Sample Proposal
            </Link>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="w-full py-20 bg-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Placing commercial risk shouldn&apos;t rely on tribal knowledge
          </h2>
          <p className="text-lg leading-relaxed mb-6" style={{ color: '#64748B' }}>
            Commercial insurance teams waste time submitting risks to carriers that will never write them. Decisions about standard versus E&S often depend on who happens to be available, what they remember, or what worked last time.
          </p>
          <p className="text-lg leading-relaxed mb-6" style={{ color: '#64748B' }}>
            Declinations slow everything down. Insureds get frustrated. Producers lose momentum.
          </p>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            Insurigence brings structure, consistency, and clarity to one of the most critical steps in the commercial insurance workflow.
          </p>
        </div>
      </section>

      {/* Solution Overview Section */}
      <section className="w-full py-20" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Clarity before you submit
          </h2>
          <p className="text-lg leading-relaxed mb-6" style={{ color: '#64748B' }}>
            Insurigence sits between intake and carrier quoting. It evaluates structured risk data, analyzes key exposure signals, and helps agencies understand where a risk realistically belongs before time is wasted on submissions.
          </p>
          <p className="text-lg leading-relaxed font-medium" style={{ color: '#0D2137' }}>
            This is not quoting. It is placement intelligence that supports licensed judgment and improves outcomes.
          </p>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="w-full py-20 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: '#0D2137' }}>
              How It Works
            </h2>
          </div>

          <div className="grid md:grid-cols-4 gap-6">
            <div className="relative">
              <div className="flex items-center justify-center w-12 h-12 rounded-full text-xl font-bold mb-5" style={{ backgroundColor: '#0D2137', color: 'white' }}>
                1
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#0D2137' }}>Structured Intake</h3>
              <p className="text-sm leading-relaxed" style={{ color: '#64748B' }}>
                Capture the details that actually matter for underwriting and appetite evaluation, not just basic application data.
              </p>
              <div className="hidden md:block absolute top-6 left-16 w-full h-0.5 bg-gradient-to-r from-[#0D2137]/30 to-transparent"></div>
            </div>

            <div className="relative">
              <div className="flex items-center justify-center w-12 h-12 rounded-full text-xl font-bold mb-5" style={{ backgroundColor: '#00E6A7', color: 'white' }}>
                2
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#0D2137' }}>Risk Evaluation</h3>
              <p className="text-sm leading-relaxed" style={{ color: '#64748B' }}>
                Insurigence analyzes operational, exposure, and classification factors to assess risk complexity and market direction.
              </p>
              <div className="hidden md:block absolute top-6 left-16 w-full h-0.5 bg-gradient-to-r from-[#00E6A7]/30 to-transparent"></div>
            </div>

            <div className="relative">
              <div className="flex items-center justify-center w-12 h-12 rounded-full text-xl font-bold mb-5" style={{ backgroundColor: '#0D2137', color: 'white' }}>
                3
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#0D2137' }}>Market Guidance</h3>
              <p className="text-sm leading-relaxed" style={{ color: '#64748B' }}>
                Understand whether a risk aligns better with standard or E&S markets, and which carrier profiles are realistic.
              </p>
              <div className="hidden md:block absolute top-6 left-16 w-full h-0.5 bg-gradient-to-r from-[#0D2137]/30 to-transparent"></div>
            </div>

            <div>
              <div className="flex items-center justify-center w-12 h-12 rounded-full text-xl font-bold mb-5" style={{ backgroundColor: '#00E6A7', color: 'white' }}>
                4
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#0D2137' }}>Proposal Support</h3>
              <p className="text-sm leading-relaxed" style={{ color: '#64748B' }}>
                Generate professional, easy-to-understand proposals that clearly explain coverage options and placement decisions.
              </p>
            </div>
          </div>

          <div className="text-center mt-12">
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-2 text-base font-semibold transition-colors hover:opacity-70"
              style={{ color: '#0D2137' }}
            >
              Learn more about how it works
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Value Props Section */}
      <section className="w-full py-20" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: '#0D2137' }}>
              What agencies gain with Insurigence
            </h2>
          </div>

          <ul className="space-y-4">
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Fewer carrier declinations and wasted submissions</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Faster placement decisions with more confidence</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Consistent guidance across teams and offices</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Clearer explanations to insureds</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Less reliance on tribal knowledge</span>
            </li>
            <li className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg" style={{ color: '#0D2137' }}>Better producer and account manager alignment</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Who It's For Section */}
      <section className="w-full py-20 bg-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Built for commercial insurance agencies
          </h2>
          <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
            Insurigence is designed for independent agencies, wholesalers, and program administrators handling complex commercial risks. Whether you are onboarding new producers, scaling a growing book, or trying to standardize placement decisions across teams, Insurigence provides structure without replacing professional judgment.
          </p>
          <div className="mt-8">
            <Link
              href="/who-its-for"
              className="inline-flex items-center gap-2 text-base font-semibold transition-colors hover:opacity-70"
              style={{ color: '#0D2137' }}
            >
              See if Insurigence is right for you
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Compliance and Trust Section */}
      <section className="w-full py-20" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-8" style={{ backgroundColor: '#00E6A7', color: 'white' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Decision Support, Not Decision Replacement
          </div>
          
          <h2 className="text-3xl md:text-4xl font-bold mb-6" style={{ color: '#0D2137' }}>
            Your expertise drives the final decision
          </h2>
          
          <p className="text-lg leading-relaxed mb-10" style={{ color: '#64748B' }}>
            Insurigence does not quote pricing, bind coverage, or replace licensed insurance professionals. The platform provides guidance and intelligence to support better decisions, not automated underwriting or carrier commitments. Final placement decisions always remain with the agency and carrier.
          </p>

          <div className="flex flex-wrap justify-center gap-6">
            <div className="flex items-center gap-2 px-5 py-3 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-5 h-5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-medium" style={{ color: '#0D2137' }}>No Quoting</span>
            </div>
            <div className="flex items-center gap-2 px-5 py-3 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-5 h-5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-medium" style={{ color: '#0D2137' }}>No Binding</span>
            </div>
            <div className="flex items-center gap-2 px-5 py-3 bg-white rounded-xl border border-slate-200/60">
              <svg className="w-5 h-5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-medium" style={{ color: '#0D2137' }}>No Automated Decisions</span>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section id="contact" className="w-full py-20" style={{ backgroundColor: '#0D2137' }}>
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Make placement decisions with confidence
            </h2>
            <p className="text-lg text-white/80 max-w-2xl mx-auto">
              See how Insurigence helps commercial insurance teams reduce declinations, improve placement efficiency, and communicate more clearly with insureds.
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
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
            <a
              href="#demo-form"
              className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold rounded-xl transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-2 border-white/30"
              style={{ color: 'white', backgroundColor: 'transparent' }}
              data-testid="cta-talk-to-us"
            >
              Talk to Us
            </a>
            <Link
              href="/sample-proposal"
              className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold rounded-xl transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-2 border-white/30"
              style={{ color: 'white', backgroundColor: 'transparent' }}
              data-testid="cta-sample-proposal"
            >
              See a Sample Proposal
            </Link>
          </div>

          <div id="demo-form" className="max-w-2xl mx-auto">
            <form className="bg-white rounded-2xl p-8 shadow-xl" data-testid="contact-form">
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>First Name</label>
                    <input
                      type="text"
                      name="firstName"
                      className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-opacity-50"
                      style={{ '--tw-ring-color': '#00E6A7' } as React.CSSProperties}
                      placeholder="John"
                      data-testid="input-first-name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>Last Name</label>
                    <input
                      type="text"
                      name="lastName"
                      className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-opacity-50"
                      placeholder="Doe"
                      data-testid="input-last-name"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>Email Address</label>
                  <input
                    type="email"
                    name="email"
                    className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-opacity-50"
                    placeholder="john@company.com"
                    data-testid="input-email"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>Company Name</label>
                  <input
                    type="text"
                    name="company"
                    className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-opacity-50"
                    placeholder="Your Agency Name"
                    data-testid="input-company"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>Message</label>
                  <textarea
                    name="message"
                    rows={4}
                    className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-opacity-50 resize-none"
                    placeholder="Tell us about your needs..."
                    data-testid="textarea-message"
                  />
                </div>
                
                <button
                  type="submit"
                  className="w-full py-4 px-6 rounded-xl text-white font-semibold transition-all duration-200 hover:opacity-90"
                  style={{ backgroundColor: '#00E6A7' }}
                  data-testid="button-submit-contact"
                >
                  Send Message
                </button>
              </div>
            </form>
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
                <li><a href="#contact" className="text-sm transition-colors hover:opacity-70" style={{ color: '#64748B' }}>Contact</a></li>
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
            <div className="flex items-center gap-5">
              <a href="#" className="transition-colors hover:opacity-70" style={{ color: '#64748B' }} aria-label="LinkedIn">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              </a>
              <a href="#" className="transition-colors hover:opacity-70" style={{ color: '#64748B' }} aria-label="Twitter">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </a>
              <a href="#" className="transition-colors hover:opacity-70" style={{ color: '#64748B' }} aria-label="Email">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
