'use client';

import { ChevronUp, ChevronDown, Eye, EyeOff, Lock } from 'lucide-react';
import {
  sectionDefinition, isContentSection, type ProposalSection,
} from '@/lib/proposals/sections';

/**
 * One row of the proposal's section list: reorder, retitle, switch off, and —
 * for content sections — write the prose.
 *
 * Data sections (the comparison table, the coverage breakdown) show a summary of
 * what they will render instead of a text box, because their content comes from
 * the lead's quote options rather than from anything typed here.
 */

interface Props {
  section: ProposalSection;
  index: number;
  total: number;
  /** One-line description of what a data section will render. */
  dataPreview?: string;
  onChange: (patch: Partial<ProposalSection>) => void;
  onMove: (direction: -1 | 1) => void;
}

export default function SectionEditor({
  section, index, total, dataPreview, onChange, onMove,
}: Props) {
  const def = sectionDefinition(section.key);
  const isContent = isContentSection(section.key);
  const required = def?.required ?? false;
  const isEmpty = isContent && section.enabled && (section.body ?? '').trim() === '';

  return (
    <div
      className="rounded-xl border bg-white"
      style={{ borderColor: isEmpty ? '#FCD34D' : '#e2e8f0', opacity: section.enabled ? 1 : 0.6 }}
      data-testid={`section-${section.key}`}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex flex-col gap-0.5 pt-1">
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move section up"
            className="p-0.5 rounded text-slate-300 hover:text-slate-600 disabled:opacity-30"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="Move section down"
            className="p-0.5 rounded text-slate-300 hover:text-slate-600 disabled:opacity-30"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <input
              value={section.title}
              onChange={(e) => onChange({ title: e.target.value })}
              className="text-sm font-medium bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-slate-400 focus:outline-none px-0 py-0.5 min-w-0 flex-1"
              style={{ color: 'var(--brand-primary)' }}
              aria-label="Section title"
            />
            {required ? (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: '#F1F5F9', color: '#64748B' }}
                title="This section is required and cannot be removed"
              >
                <Lock className="w-3 h-3" /> required
              </span>
            ) : (
              <button
                onClick={() => onChange({ enabled: !section.enabled })}
                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex-shrink-0"
                title={section.enabled ? 'Hide this section' : 'Show this section'}
                aria-label={section.enabled ? 'Hide section' : 'Show section'}
                data-testid={`toggle-${section.key}`}
              >
                {section.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
            )}
          </div>

          <p className="text-xs text-slate-400 mb-2">{def?.hint}</p>

          {isContent ? (
            <>
              <textarea
                value={section.body ?? ''}
                onChange={(e) => onChange({ body: e.target.value })}
                disabled={!section.enabled}
                rows={4}
                placeholder={def?.hint}
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 resize-y focus:outline-none focus:ring-2 focus:ring-[#00E6A7] focus:border-transparent disabled:bg-slate-50"
                data-testid={`body-${section.key}`}
              />
              {isEmpty && (
                <p className="text-xs mt-1" style={{ color: '#92400E' }}>
                  This section is switched on but empty — write something or hide it.
                </p>
              )}
            </>
          ) : (
            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-xs text-slate-500">
                {dataPreview ?? 'Renders automatically from this lead.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
