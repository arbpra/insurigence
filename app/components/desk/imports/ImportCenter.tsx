'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fileSizeLabel, localDayLabel } from '@/lib/desk/account-form';
import { importStatusLabel } from '@/lib/desk/import-fields';
import { IMPORT_ACCEPT, MAX_IMPORT_BYTES } from '@/lib/desk/import-headers';
import { ApiError, api } from '../accounts/account-api';

export interface ImportSummary {
  id: string;
  version: string;
  fileName: string;
  fileSize: number | null;
  status: string;
  mapped: boolean;
  rowCount: number;
  sheetName: string | null;
  sheetNames: string[];
  createdAt: string;
}

const ACCENT = 'var(--brand-primary, #05314c)';
const PRIMARY = 'px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60';

/** Upload an export, or carry on with one already uploaded. */
export function ImportCenter() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [imports, setImports] = useState<ImportSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** A workbook with several sheets: the file is kept in memory while one is chosen. */
  const [choosing, setChoosing] = useState<{ file: File; batch: ImportSummary } | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await api<{ imports: ImportSummary[] }>('/api/desk/imports');
      setImports(body.imports);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your imports could not be loaded.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = async (file: File, sheet?: string): Promise<ImportSummary> => {
    const form = new FormData();
    form.set('file', file);
    if (sheet) form.set('sheet', sheet);
    let res: Response;
    try {
      res = await fetch('/api/desk/imports', { method: 'POST', body: form });
    } catch {
      throw new Error('The file could not be sent. Check your connection and try again.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error || 'The file could not be uploaded.', res.status, body.code);
    return body;
  };

  const upload = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setError('');
    setChoosing(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setError(`Files can be up to ${MAX_IMPORT_BYTES / 1024 / 1024} MB, and this one is ${fileSizeLabel(file.size)}. Split it into smaller files.`);
      return;
    }
    setBusy(true);
    try {
      const batch = await send(file);
      if (batch.sheetNames.length > 1) {
        setChoosing({ file, batch });
        await load();
      } else {
        router.push(`/desk/import/${batch.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be uploaded.');
    } finally {
      setBusy(false);
    }
  };

  const chooseSheet = async (sheet: string) => {
    if (!choosing || sheet === choosing.batch.sheetName) return;
    const { file, batch } = choosing;
    setBusy(true);
    setError('');
    try {
      // The earlier sheet goes first, so this can't run into the limit on unfinished imports.
      await api(`/api/desk/imports/${batch.id}`, { method: 'DELETE' });
      setChoosing({ file, batch: await send(file, sheet) });
    } catch (err) {
      setChoosing(null);
      setError(err instanceof Error ? err.message : 'That sheet could not be read.');
    } finally {
      setBusy(false);
      await load();
    }
  };

  const discard = async (item: ImportSummary) => {
    if (!window.confirm(`Discard ${item.fileName}? Its rows will be removed.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/desk/imports/${item.id}`, { method: 'DELETE' });
      if (choosing?.batch.id === item.id) setChoosing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That import could not be discarded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="desk-import">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: ACCENT }} data-testid="page-title">Import</h1>
        <p className="text-sm text-slate-500">Upload your book of business from any AMS export. Nothing is added to your accounts until you confirm the import.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 mb-5">
        <h2 className="text-base font-semibold text-slate-800 mb-1">Upload a file</h2>
        <p className="text-sm text-slate-500 mb-3">CSV or Excel (.xlsx), up to {MAX_IMPORT_BYTES / 1024 / 1024} MB. Older .xls files need saving as .xlsx first. Don&apos;t include passwords: any The Desk recognises are left out.</p>
        <input
          ref={input} type="file" accept={IMPORT_ACCEPT} disabled={busy} className="block w-full max-w-md text-sm text-slate-700" aria-label="File to import" data-testid="desk-import-file"
          onChange={(e) => upload(e.target.files?.[0])}
        />
        {busy && <p className="text-sm text-slate-500 mt-3" role="status" data-testid="desk-import-busy">Working… a large file can take a minute.</p>}

        {choosing && (
          <div className="mt-4 border-t border-slate-200 pt-4" data-testid="desk-import-sheets">
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="desk-import-sheet">This workbook has {choosing.batch.sheetNames.length} sheets. Which one holds your book?</label>
            <div className="flex flex-wrap items-center gap-3">
              <select
                id="desk-import-sheet" className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white max-w-full" disabled={busy}
                value={choosing.batch.sheetName ?? ''} data-testid="desk-import-sheet" onChange={(e) => chooseSheet(e.target.value)}
              >
                {choosing.batch.sheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <button type="button" className={PRIMARY} style={{ background: ACCENT }} disabled={busy} data-testid="desk-import-sheet-continue" onClick={() => router.push(`/desk/import/${choosing.batch.id}`)}>Continue</button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-import-error">{error}</p>}
      {!imports && !error && <p className="text-sm text-slate-500" data-testid="desk-import-loading">Loading…</p>}

      {imports && imports.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm" data-testid="desk-import-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th scope="col" className="px-4 py-3 font-medium">File</th>
                <th scope="col" className="px-4 py-3 font-medium">Rows</th>
                <th scope="col" className="px-4 py-3 font-medium">Uploaded</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {imports.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 last:border-0" data-testid={`desk-import-${item.id}`}>
                  <td className="px-4 py-3 min-w-[12rem]">
                    <div className="font-medium text-slate-800 break-all">{item.fileName}</div>
                    <div className="text-xs text-slate-500">{item.fileSize != null ? fileSizeLabel(item.fileSize) : ''}{item.sheetName ? ` · ${item.sheetName}` : ''}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{item.rowCount.toLocaleString('en-US')}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{localDayLabel(item.createdAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{importStatusLabel(item.status, item.mapped)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    {item.status === 'STAGED' && <Link href={`/desk/import/${item.id}`} className="underline text-slate-700 mr-3" data-testid={`desk-import-open-${item.id}`}>Continue</Link>}
                    {(item.status === 'STAGED' || item.status === 'FAILED') && (
                      <button type="button" className="underline text-slate-500 disabled:opacity-60" disabled={busy} data-testid={`desk-import-discard-${item.id}`} onClick={() => discard(item)}>Discard</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {imports && imports.length === 0 && <p className="text-sm text-slate-500" data-testid="desk-import-empty">No imports yet.</p>}
    </div>
  );
}
