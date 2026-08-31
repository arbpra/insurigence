'use client';

import { useRef, useState } from 'react';
import { FileText, Upload, X, Download } from 'lucide-react';
import type { QuoteOptionDTO } from '@/lib/quotes/quoteOption';

/**
 * Upload / download / remove the carrier's quote document for one quote option.
 *
 * The document is stored against a saved option, so this only appears once the
 * option exists — on a new option the agent saves first, then attaches the file.
 */

const ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp';
const MAX_MB = 15;

interface Props {
  option: QuoteOptionDTO;
  onChange: (option: QuoteOptionDTO) => void;
}

function fileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function QuoteDocumentField({ option, onChange }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');

    // Checked here for an instant message; the server enforces it regardless.
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File must be ${MAX_MB} MB or smaller.`);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }

    const body = new FormData();
    body.append('file', file);

    setBusy(true);
    try {
      const res = await fetch(`/api/quote-options/${option.id}/document`, { method: 'POST', body });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not upload the document.'); return; }
      onChange({
        ...option,
        hasDocument: true,
        documentName: json.document.name,
        documentSize: json.document.size,
        documentContentType: json.document.contentType,
        documentUploadedAt: json.document.uploadedAt,
      });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/quote-options/${option.id}/document`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || 'Could not remove the document.');
        return;
      }
      onChange({
        ...option,
        hasDocument: false, documentName: null, documentSize: null,
        documentContentType: null, documentUploadedAt: null,
      });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="quote-document-field">
      <label className="block text-xs font-medium text-slate-600 mb-1">Carrier Quote Document</label>

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {option.hasDocument ? (
        <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <FileText className="w-4 h-4 flex-shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-700 truncate">{option.documentName}</p>
            {option.documentSize && (
              <p className="text-xs text-slate-400">{fileSize(option.documentSize)}</p>
            )}
          </div>
          {/* A plain link: the endpoint authorises, then redirects to a
              short-lived presigned URL, so no download link sits in the DOM. */}
          <a
            href={`/api/quote-options/${option.id}/document`}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200"
            title="Download"
            aria-label="Download document"
          >
            <Download className="w-4 h-4" />
          </a>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
            title="Remove"
            aria-label="Remove document"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-700 disabled:opacity-60"
          data-testid="quote-document-upload"
        >
          <Upload className="w-4 h-4" />
          {busy ? 'Uploading…' : 'Attach the carrier quote'}
        </button>
      )}

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        onChange={upload}
        className="hidden"
        data-testid="quote-document-input"
      />
      <p className="text-xs text-slate-400 mt-1">PDF, Word, or image · up to {MAX_MB} MB</p>
    </div>
  );
}
