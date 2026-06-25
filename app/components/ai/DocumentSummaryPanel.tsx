'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AiDisclaimer from '@/components/ai/AiDisclaimer';
import AiAssistedBadge from '@/components/ai/AiAssistedBadge';
import AiReviewStatus from '@/components/ai/AiReviewStatus';

interface CoverageLine {
  name: string;
  limit: string;
  deductible: string;
}

interface DocumentData {
  carrier: string;
  effectiveDate: string;
  expirationDate: string;
  coverages: CoverageLine[];
  gaps: string[];
  notes: string;
}

/**
 * Feature 5 — Document Summary panel for the proposal page.
 * The agent pastes policy/quote text; the AI extracts carrier, dates, coverage
 * lines, and flags potential gaps. Loads any saved extraction on mount.
 * (PDF file upload is added in a later step.)
 */
export default function DocumentSummaryPanel({ leadId }: { leadId: string }) {
  const [text, setText] = useState('');
  const [data, setData] = useState<DocumentData | null>(null);
  const [reviewedAt, setReviewedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadExisting = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/document-summary/${leadId}`);
      const json = await res.json();
      if (res.ok && json.data) {
        setData(json.data);
        setReviewedAt(json.reviewedAt ?? null);
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoaded(true);
    }
  }, [leadId]);

  useEffect(() => {
    loadExisting();
  }, [loadExisting]);

  const extract = async () => {
    setLoading(true);
    setError(null);
    setUploadedName(null);
    try {
      const res = await fetch(`/api/ai/document-summary/${leadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'Failed to extract');
      else {
        setData(json.data);
        setReviewedAt(null);
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const uploadPdf = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/ai/document-summary/${leadId}/upload`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'Failed to read PDF');
      else {
        setData(json.data);
        setReviewedAt(null);
        setUploadedName(json.fileName ?? file.name);
      }
    } catch {
      setError('Network error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="brand-card p-8 mb-8" data-testid="section-document-summary">
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
              Document Summary
            </h3>
            <div className="mt-1">
              <AiAssistedBadge />
            </div>
          </div>
        </div>
        {data && <AiReviewStatus reviewedAt={reviewedAt} />}
      </div>

      <p className="text-xs uppercase font-bold mb-2" style={{ color: 'var(--brand-text-subtle)' }}>
        Upload a PDF, or paste policy / quote text
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Paste the text of a policy or quote here — or upload a PDF below."
        className="form-input resize-y w-full"
        data-testid="input-document-text"
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadPdf(f);
        }}
        data-testid="input-document-file"
      />

      <div className="flex items-center justify-between mt-3 mb-2 gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || loading}
          className="btn-brand-secondary px-4 py-2"
          data-testid="button-upload-pdf"
        >
          {uploading ? 'Reading PDF…' : 'Upload PDF'}
        </button>
        <div className="flex items-center gap-3">
          {uploadedName && (
            <span className="text-xs" style={{ color: 'var(--brand-text-subtle)' }}>
              From: {uploadedName}
            </span>
          )}
          <button
            onClick={extract}
            disabled={loading || uploading || !text.trim()}
            className="btn-brand-primary px-4 py-2"
            data-testid="button-extract-document"
          >
            {loading ? 'Extracting…' : data ? 'Re-extract' : 'Extract Fields'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm mb-4">
          {error}
        </div>
      )}

      {data && (
        <div className="space-y-4 mt-2">
          <AiDisclaimer />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label="Carrier" value={data.carrier} />
            <Stat label="Effective" value={data.effectiveDate} />
            <Stat label="Expiration" value={data.expirationDate} />
          </div>

          <div className="rounded-xl border border-slate-200 p-5">
            <p className="text-xs uppercase font-bold mb-3" style={{ color: 'var(--brand-text-subtle)' }}>
              Coverages
            </p>
            {data.coverages.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>None found.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left" style={{ color: 'var(--brand-text-subtle)' }}>
                    <th className="py-1 font-medium">Coverage</th>
                    <th className="py-1 font-medium">Limit</th>
                    <th className="py-1 font-medium">Deductible</th>
                  </tr>
                </thead>
                <tbody>
                  {data.coverages.map((c, i) => (
                    <tr key={i} className="border-t border-slate-100" style={{ color: 'var(--brand-text-muted)' }}>
                      <td className="py-1.5">{c.name}</td>
                      <td className="py-1.5">{c.limit || '—'}</td>
                      <td className="py-1.5">{c.deductible || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 p-5">
            <p className="text-xs uppercase font-bold mb-2" style={{ color: 'var(--brand-text-subtle)' }}>
              Potential Gaps / Opportunities
            </p>
            {data.gaps.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>None flagged.</p>
            ) : (
              <ul className="space-y-2">
                {data.gaps.map((g, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--brand-text-muted)' }}>
                    <span className="text-amber-500 mt-0.5" aria-hidden>⚠</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.notes && (
            <div className="rounded-xl border border-slate-200 p-5">
              <p className="text-xs uppercase font-bold mb-2" style={{ color: 'var(--brand-text-subtle)' }}>
                Notes
              </p>
              <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>{data.notes}</p>
            </div>
          )}
        </div>
      )}

      {!data && loaded && !error && (
        <p className="text-sm mt-2" style={{ color: 'var(--brand-text-muted)' }}>
          Paste a policy or quote above to extract carrier, dates, coverages, limits, deductibles,
          and potential gaps.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-xs uppercase font-bold mb-1" style={{ color: 'var(--brand-text-subtle)' }}>
        {label}
      </p>
      <p className="text-sm font-medium" style={{ color: 'var(--brand-text)' }}>{value || '—'}</p>
    </div>
  );
}
