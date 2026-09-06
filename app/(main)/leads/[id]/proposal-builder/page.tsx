'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, CheckCircle2, PanelsTopLeft, Eye } from 'lucide-react';
import SectionEditor from '@/app/components/proposals/SectionEditor';
import ProposalPreview from '@/app/components/proposals/ProposalPreview';
import SendProposalPanel from '@/app/components/proposals/SendProposalPanel';
import ActivityLog from '@/app/components/proposals/ActivityLog';
import type { AssembledProposal } from '@/lib/proposals/assemble';
import type { ProposalSection } from '@/lib/proposals/sections';

/**
 * The proposal builder.
 *
 * Left: the section list — reorder, retitle, switch off, write.
 * Right: a live preview of what the insured will see.
 *
 * Edits save on a short debounce rather than behind a Save button: an agent
 * moving between sections should not have to remember to commit each one, and
 * every change here is reversible.
 */
export default function ProposalBuilderPage() {
  const params = useParams();
  const leadId = String(params.id);

  const [proposal, setProposal] = useState<AssembledProposal | null>(null);
  const [readiness, setReadiness] = useState<{ blockers: string[]; hints: string[] }>({ blockers: [], hints: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'build' | 'preview'>('build');
  const [notice, setNotice] = useState('');
  /** Set when a save was refused because it would need a new version. */
  const [versionPrompt, setVersionPrompt] = useState<
    { patch: Record<string, unknown>; signed: boolean; version: number } | null
  >(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Edits made during one debounce window, merged.
   *
   * Without this, each new edit cancelled the previous timer and only the last
   * patch was sent — so changing the title and then a section within the window
   * silently lost the title on the server while the screen showed it applied.
   */
  const pendingPatch = useRef<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/leads/${leadId}/proposal-builder`);
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not load the proposal.'); return; }
      setProposal(json.proposal);
      setReadiness(json.readiness ?? { blockers: [], hints: [] });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  // Flush any pending edit when the page goes away, rather than dropping it.
  // A bare fetch is used because the component is unmounting and there is no
  // state left to update; the request still completes.
  useEffect(() => {
    const proposalId = proposal?.id;
    return () => {
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      const patch = pendingPatch.current;
      pendingPatch.current = {};
      if (!proposalId || Object.keys(patch).length === 0) return;
      void fetch(`/api/proposals/${proposalId}/builder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        keepalive: true,
      }).catch(() => {});
    };
  }, [proposal?.id]);

  const persist = useCallback(async (
    patch: Record<string, unknown>,
    opts: { createVersion?: boolean } = {}
  ) => {
    if (!proposal) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/builder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.createVersion ? { ...patch, createVersion: true } : patch),
      });
      const json = await res.json();

      // The proposal has already gone to the insured. Editing it forks a new
      // version, which is the agent's decision to make — so ask rather than
      // let an autosave quietly create one.
      if (res.status === 409 && json.canCreateVersion) {
        setVersionPrompt({ patch, signed: Boolean(json.signed), version: json.currentVersion });
        return;
      }

      if (!res.ok) { setError(json.error || 'Could not save.'); return; }
      setError('');
      setVersionPrompt(null);
      setReadiness(json.readiness ?? { blockers: [], hints: [] });
      setProposal(json.proposal);
      if (json.createdVersion) setNotice(`Created version ${json.version}. The previous version is kept in the history.`);
    } catch {
      setError('Network error — your last change may not be saved.');
    } finally {
      setSaving(false);
    }
  }, [proposal]);

  /** Update locally now, write the merged edits after a pause. */
  function queueSave(next: AssembledProposal, patch: Record<string, unknown>) {
    setProposal(next);
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const merged = pendingPatch.current;
      pendingPatch.current = {};
      saveTimer.current = null;
      void persist(merged);
    }, 700);
  }

  function updateSection(index: number, patch: Partial<ProposalSection>) {
    if (!proposal) return;
    const sections = proposal.sections.map((s, i) => (i === index ? { ...s, ...patch } : s));
    queueSave({ ...proposal, sections }, { sections });
  }

  function moveSection(index: number, direction: -1 | 1) {
    if (!proposal) return;
    const target = index + direction;
    if (target < 0 || target >= proposal.sections.length) return;
    const sections = [...proposal.sections];
    [sections[index], sections[target]] = [sections[target], sections[index]];
    queueSave({ ...proposal, sections }, { sections });
  }

  /** One-line description of what each data section will render. */
  function dataPreview(key: string): string {
    if (!proposal) return '';
    switch (key) {
      case 'agencyHeader':
        return `${proposal.branding.agencyName}${proposal.preparedBy.agentName ? ` · ${proposal.preparedBy.agentName}` : ''}${proposal.branding.logoUrl ? ' · logo' : ' · no logo set'}`;
      case 'clientInformation':
        return proposal.preparedFor.insuredName;
      case 'recommendation':
        return proposal.recommendation
          ? `${proposal.recommendation.optionLabel}${proposal.recommendation.rationale ? '' : ' — no explanation written yet'}`
          : 'No option marked as recommended yet.';
      case 'quoteOptions':
        return `${proposal.options.length} option${proposal.options.length === 1 ? '' : 's'}, ${proposal.keyDifferences.length} key difference${proposal.keyDifferences.length === 1 ? '' : 's'}.`;
      case 'coverageBreakdown': {
        const n = proposal.options.reduce((t, o) => t + o.coverages.length, 0);
        return n === 0 ? 'No coverages entered yet.' : `${n} coverage explanation${n === 1 ? '' : 's'}.`;
      }
      default:
        return '';
    }
  }

  if (loading) return <div className="max-w-6xl mx-auto px-4 py-8"><p className="text-sm text-slate-400">Loading…</p></div>;

  if (!proposal) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          {error || 'Proposal not available.'}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <Link href={`/leads/${leadId}/quotes`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to quote options
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div className="min-w-0">
          <input
            value={proposal.title}
            onChange={(e) => queueSave({ ...proposal, title: e.target.value }, { title: e.target.value })}
            className="text-2xl font-medium bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-slate-400 focus:outline-none px-0 w-full"
            style={{ color: 'var(--brand-primary)' }}
            aria-label="Proposal title"
            data-testid="proposal-title"
          />
          <p className="text-sm text-slate-500 mt-1">
            {proposal.preparedFor.insuredName} · version {proposal.version} · {proposal.status.toLowerCase().replace(/_/g, ' ')}
            {saving && <span className="ml-2 text-slate-400">saving…</span>}
          </p>
        </div>

        {/* Preview is a tab on small screens, side-by-side on large. */}
        <div className="flex rounded-md border border-slate-300 overflow-hidden lg:hidden">
          {(['build', 'preview'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5"
              style={view === v
                ? { backgroundColor: 'var(--brand-primary)', color: '#fff' }
                : { color: '#64748b' }}
            >
              {v === 'build' ? <PanelsTopLeft className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {v === 'build' ? 'Build' : 'Preview'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          {error}
        </div>
      )}

      {notice && (
        <div className="mb-4 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#E9FBF5', color: '#0F9E78' }}>
          {notice}
        </div>
      )}

      {versionPrompt && (
        <div className="mb-4 rounded-md px-4 py-3 text-sm" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
             data-testid="version-prompt">
          <p className="font-medium mb-1">
            {versionPrompt.signed
              ? 'This proposal has been signed.'
              : 'This proposal has already been sent.'}
          </p>
          <p className="mb-3">
            Version {versionPrompt.version} stays exactly as the client saw it. Your change will
            start version {versionPrompt.version + 1}, which you can send when it is ready.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => { const p = versionPrompt.patch; setVersionPrompt(null); void persist(p, { createVersion: true }); }}
              className="px-3 py-1.5 rounded-md text-sm font-semibold"
              style={{ backgroundColor: 'var(--brand-accent)', color: 'var(--brand-primary)' }}
              data-testid="confirm-new-version"
            >
              Create version {versionPrompt.version + 1}
            </button>
            <button
              onClick={() => { setVersionPrompt(null); void load(); }}
              className="px-3 py-1.5 rounded-md text-sm font-medium border border-amber-300"
            >
              Discard my change
            </button>
          </div>
        </div>
      )}

      {/* Readiness — everything standing between this and a sendable proposal. */}
      <div className="mb-6">
        {readiness.blockers.length === 0 ? (
          <div className="rounded-md px-3 py-2 text-sm flex items-center gap-2"
               style={{ backgroundColor: '#E9FBF5', color: '#0F9E78' }} data-testid="readiness-ok">
            <CheckCircle2 className="w-4 h-4" /> This proposal is ready to send.
          </div>
        ) : (
          <div className="rounded-md px-3 py-2.5 text-sm" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
               data-testid="readiness-problems">
            <p className="flex items-center gap-2 font-medium mb-1">
              <AlertTriangle className="w-4 h-4" />
              {readiness.blockers.length} thing{readiness.blockers.length === 1 ? '' : 's'} to resolve before sending
            </p>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              {readiness.blockers.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ── Build ── */}
        <div className={view === 'build' ? '' : 'hidden lg:block'}>
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Covering note <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={proposal.clientMessage ?? ''}
              onChange={(e) => queueSave(
                { ...proposal, clientMessage: e.target.value },
                { clientMessage: e.target.value }
              )}
              rows={2}
              placeholder="A short note to the insured, shown above the proposal."
              className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 resize-y focus:outline-none focus:ring-2 focus:ring-[#00E6A7] focus:border-transparent"
            />
          </div>

          <div className="mb-6">
            <SendProposalPanel
              proposalId={proposal.id}
              status={proposal.status}
              readiness={readiness.blockers}
              defaultEmail={proposal.preparedFor.contactEmail ?? null}
              onSent={load}
            />
          </div>

          <div className="mb-6">
            <ActivityLog proposalId={proposal.id} />
          </div>

          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">Sections</h2>
          <div className="space-y-2">
            {proposal.sections.map((section, i) => (
              <SectionEditor
                key={section.key}
                section={section}
                index={i}
                total={proposal.sections.length}
                dataPreview={dataPreview(section.key)}
                onChange={(patch) => updateSection(i, patch)}
                onMove={(d) => moveSection(i, d)}
              />
            ))}
          </div>
        </div>

        {/* ── Preview ── */}
        <div className={`lg:sticky lg:top-6 ${view === 'preview' ? '' : 'hidden lg:block'}`}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
            What the insured sees
          </h2>
          <ProposalPreview proposal={proposal} />
        </div>
      </div>
    </div>
  );
}
