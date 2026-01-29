import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--brand-background)' }}>
      <header className="bg-white border-b border-slate-200/80">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--brand-primary)' }}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--brand-primary)' }}>Insurigence</h1>
              <p className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>Insurance Placement Intelligence</p>
            </div>
          </div>
        </div>
      </header>

      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0D2137]/5 via-transparent to-[#00E6A7]/5"></div>
        <div className="relative max-w-4xl mx-auto px-6 py-24 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-slate-200/80 shadow-sm text-sm mb-8" style={{ color: 'var(--brand-primary)' }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--brand-accent)' }}></span>
            Insurance Placement Intelligence
          </div>
          
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6" style={{ color: 'var(--brand-primary)' }}>
            Smarter Placement Starts Here
          </h2>
          
          <p className="text-xl max-w-2xl mx-auto leading-relaxed mb-12" style={{ color: 'var(--brand-text-muted)' }}>
            Evaluate risks, identify the right carriers, and create professional proposals for your clients — all in one focused workspace.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/intake/commercial-gl"
              className="btn-brand-primary w-full sm:w-auto px-8 py-4"
              data-testid="button-start-intake"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Start New Intake
            </Link>
            <Link
              href="/dashboard"
              className="btn-brand-secondary w-full sm:w-auto px-8 py-4"
              data-testid="button-view-dashboard"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              View Dashboard
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-3 gap-6">
          <div className="brand-card">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ backgroundColor: 'var(--market-standard-bg)' }}>
              <svg className="w-6 h-6" style={{ color: 'var(--market-standard)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--brand-primary)' }}>Placement Clarity</h3>
            <p style={{ color: 'var(--brand-text-muted)' }} className="text-sm leading-relaxed">
              Instantly classify risks as Standard, E&S, or Borderline with clear explanations for every decision.
            </p>
          </div>

          <div className="brand-card">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ backgroundColor: '#EEF2FF' }}>
              <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--brand-primary)' }}>Carrier Direction</h3>
            <p style={{ color: 'var(--brand-text-muted)' }} className="text-sm leading-relaxed">
              Find the best-fit carriers for each risk based on appetite rules and comprehensive fit scoring.
            </p>
          </div>

          <div className="brand-card">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ backgroundColor: '#F0FDFA' }}>
              <svg className="w-6 h-6" style={{ color: 'var(--brand-accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--brand-primary)' }}>Client-Ready Proposals</h3>
            <p style={{ color: 'var(--brand-text-muted)' }} className="text-sm leading-relaxed">
              Generate professional, shareable market summaries for your clients with one click.
            </p>
          </div>
        </div>
      </div>

      <footer className="border-t border-slate-200/80 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded flex items-center justify-center" style={{ backgroundColor: 'var(--brand-primary)' }}>
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <span className="text-sm font-medium" style={{ color: 'var(--brand-primary)' }}>Insurigence</span>
            </div>
            <p className="text-sm" style={{ color: 'var(--brand-text-subtle)' }}>
              Built for insurance professionals who value clarity and efficiency.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
