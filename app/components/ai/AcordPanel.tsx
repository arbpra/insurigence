'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AiAssistedBadge from '@/components/ai/AiAssistedBadge';
import AiReviewStatus from '@/components/ai/AiReviewStatus';

interface FieldSpec {
  key: string;
  label: string;
  section: string;
  required?: boolean;
}

interface AcordDraft {
  id: string;
  formType: string;
  status: 'DRAFT' | 'REVIEWED' | 'EXPORTED';
  fields: Record<string, string>;
  missingFields: string[];
  reviewedAt: string | null;
}

interface SupportedForm {
  formType: string;
  title: string;
  fields: FieldSpec[];
}

/**
 * ACORD draft review/edit screen for the proposal page.
 * Generates a draft (deterministic mapping + AI-assisted description), then lets
 * the agent edit fields, save, and approve before export — per the brief's
 * "agent reviews completed ACORD draft → edits/approves/export" workflow.
 */
export default function AcordPanel({ leadId }: { leadId: string }) {
  const [forms, setForms] = useState<SupportedForm[]>([]);
  const [formType, setFormType] = useState<string>('');
  const [draft, setDraft] = useState<AcordDraft | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [aiDescription, setAiDescription] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const spec = useMemo(() => forms.find((f) => f.formType === formType), [forms, formType]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/acord/${leadId}`);
      const json = await res.json();
      if (res.ok) {
        setForms(json.supportedForms || []);
        const first = json.supportedForms?.[0]?.formType ?? '';
        setFormType((cur) => cur || first);
        const existing: AcordDraft | undefined = json.drafts?.[0];
        if (existing) {
          setDraft(existing);
          setValues(existing.fields);
          setFormType(existing.formType);
        }
      }
    } catch {
      /* non-fatal */
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/acord/${leadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formType }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'Failed to generate');
      else {
        setDraft(json.draft);
        setValues(json.draft.fields);
        setAiDescription(Boolean(json.aiAssistedDescription));
        setSavedAt(null);
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const patch = async (patchBody: Record<string, unknown>, successMsg?: string) => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/acord/${leadId}/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'Failed to save');
      else {
        setDraft(json.draft);
        setValues(json.draft.fields);
        if (successMsg) setSavedAt(successMsg);
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const exportPdf = () => {
    if (!draft || draft.status === 'DRAFT') return;
    window.open(`/api/acord/${leadId}/${draft.id}/pdf`, '_blank');
    // Reflect the EXPORTED status shortly after the download is triggered.
    setTimeout(load, 1200);
  };

  const sections = useMemo(() => {
    const out: { name: string; fields: FieldSpec[] }[] = [];
    (spec?.fields ?? []).forEach((f) => {
      let s = out.find((x) => x.name === f.section);
      if (!s) {
        s = { name: f.section, fields: [] };
        out.push(s);
      }
      s.fields.push(f);
    });
    return out;
  }, [spec]);

  const missing = draft?.missingFields ?? [];

  return (
    <div className="brand-card p-8 mb-8" data-testid="section-acord">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'rgba(124, 58, 237, 0.1)' }}
          >
            <span className="text-violet-600 text-lg" aria-hidden>✦</span>
          </div>
          <div>
            <h3 className="text-xl font-semibold" style={{ color: 'var(--brand-primary)' }}>
              ACORD Forms
            </h3>
            <div className="mt-1">
              <AiAssistedBadge />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {draft && <AiReviewStatus reviewedAt={draft.reviewedAt} />}
          <select
            value={formType}
            onChange={(e) => setFormType(e.target.value)}
            className="form-input"
            data-testid="select-acord-form"
          >
            {forms.map((f) => (
              <option key={f.formType} value={f.formType}>
                {f.title}
              </option>
            ))}
          </select>
          <button
            onClick={generate}
            disabled={loading || !formType}
            className="btn-brand-primary px-4 py-2"
            data-testid="button-generate-acord"
          >
            {loading ? 'Mapping…' : draft ? 'Regenerate' : 'Generate Draft'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm mb-4">
          {error}
        </div>
      )}

      {!draft && (
        <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>
          Generate a draft to map this lead&apos;s intake into the selected ACORD form. Required
          fields are validated automatically, and you can edit before export.
        </p>
      )}

      {draft && (
        <div className="space-y-5">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            Generated draft. Agent review required before export or use.
            {aiDescription && (
              <span className="ml-1">Description of Operations was AI-assisted from Smart Intake.</span>
            )}
          </div>

          {missing.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50/60 px-4 py-2 text-sm text-red-700">
              {missing.length} required field{missing.length > 1 ? 's' : ''} still missing — highlighted below.
            </div>
          )}

          {sections.map((section) => (
            <div key={section.name} className="rounded-xl border border-slate-200 p-5">
              <p className="text-xs uppercase font-bold mb-3" style={{ color: 'var(--brand-text-subtle)' }}>
                {section.name}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {section.fields.map((f) => {
                  const isMissing = missing.includes(f.key);
                  return (
                    <div key={f.key}>
                      <label className="text-xs font-medium mb-1 flex items-center gap-1" style={{ color: 'var(--brand-text-muted)' }}>
                        {f.label}
                        {f.required && <span className="text-red-500">*</span>}
                      </label>
                      <input
                        value={values[f.key] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                        className="form-input w-full"
                        style={isMissing ? { borderColor: '#ef4444', backgroundColor: '#fef2f2' } : undefined}
                        data-testid={`acord-field-${f.key}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs" style={{ color: 'var(--brand-text-subtle)' }}>
              {savedAt || (draft.status === 'REVIEWED' ? 'Approved — ready for export.' : '')}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => patch({ fields: values }, 'Saved.')}
                disabled={saving}
                className="btn-brand-secondary px-4 py-2"
                data-testid="button-save-acord"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              {draft.status === 'REVIEWED' ? (
                <button
                  onClick={() => patch({ status: 'DRAFT' })}
                  disabled={saving}
                  className="btn-brand-secondary px-4 py-2"
                >
                  Unapprove
                </button>
              ) : (
                <button
                  onClick={() => patch({ fields: values, status: 'REVIEWED' }, 'Approved.')}
                  disabled={saving}
                  className="btn-brand-accent px-4 py-2"
                  data-testid="button-approve-acord"
                >
                  Approve for Export
                </button>
              )}
              <button
                onClick={exportPdf}
                disabled={saving || draft.status === 'DRAFT'}
                title={draft.status === 'DRAFT' ? 'Approve the draft before exporting' : 'Download PDF'}
                className={`btn-brand-primary px-4 py-2 ${draft.status === 'DRAFT' ? 'opacity-50 cursor-not-allowed' : ''}`}
                data-testid="button-export-acord"
              >
                Export PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
