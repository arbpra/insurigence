import Link from 'next/link';

/** Shown to agency users whose agency does not have The Desk turned on. */
export function DeskNotEnabled() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4" data-testid="desk-not-enabled">
      <div className="max-w-md bg-white border border-slate-200 rounded-xl p-8 text-center">
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--brand-primary, #05314c)' }}>The Desk isn&apos;t set up for your agency yet</h1>
        <p className="text-sm text-slate-600 mb-6">
          The Desk is Insurigence&apos;s managed service team. Once your agency is on a Desk plan, your requests,
          accounts and messages with your Account Manager will appear here.
        </p>
        <Link href="/dashboard" className="inline-block px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: 'var(--brand-primary, #05314c)' }}>
          Back to Insurigence
        </Link>
      </div>
    </div>
  );
}
