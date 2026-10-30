import { Construction } from 'lucide-react';
import { navItemFor } from '@/lib/desk/navigation';
import type { OverviewFact } from '@/lib/desk/session';

interface DeskPlaceholderProps {
  /** The page's own path; title, summary and module come from the nav config. */
  href: string;
  /** Optional facts shown above the "coming in module N" note (overview pages). */
  facts?: OverviewFact[];
}

/** A page that exists in the navigation but is built in a later module. */
export function DeskPlaceholder({ href, facts = [] }: DeskPlaceholderProps) {
  const item = navItemFor(href);
  if (!item) throw new Error(`No Desk navigation entry for ${href}`);

  return (
    <div data-testid="desk-placeholder">
      <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--brand-primary, #05314c)' }} data-testid="page-title">
        {item.label}
      </h1>
      <p className="text-sm text-slate-500 mb-6">{item.summary}</p>

      {facts.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6" data-testid="desk-facts">
          {facts.map((fact) => (
            <div key={fact.label} className="bg-white border border-slate-200 rounded-xl p-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{fact.label}</dt>
              <dd className="mt-1 text-base font-semibold text-slate-800">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
        <Construction className="w-8 h-8 mx-auto text-slate-400 mb-3" />
        <p className="text-sm font-medium text-slate-700">This page is being built.</p>
        <p className="text-xs text-slate-500 mt-1">Scheduled for module {item.module} of The Desk build.</p>
      </div>
    </div>
  );
}
