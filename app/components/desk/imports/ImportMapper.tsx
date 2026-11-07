'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IMPORT_FIELDS, assignField, mappingFromColumns, mappingNotes, sampleValues, validateMapping,
  type ImportFieldKey, type MappedColumn, type MappingSource,
} from '@/lib/desk/import-fields';
import { ApiError, api } from '../accounts/account-api';
import type { ImportSummary } from './ImportCenter';

interface ImportDetail extends ImportSummary {
  headerRow: number;
  headerConfident: boolean;
  headers: string[];
  screened: { columns: string[]; cells: number } | null;
}

interface RowView { rowNumber: number; cells: string[] }

const ACCENT = 'var(--brand-primary, #05314c)';
const PRIMARY = 'px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60';
const SECONDARY = 'px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700 disabled:opacity-60';
const SAMPLE_ROWS = 20;
const PICKER_ROWS = 25;
const PICKER_COLUMNS = 6;
const SOURCE_LABELS: Record<Exclude<MappingSource, null>, string> = { saved: 'Saved', remembered: 'From your last import', guessed: 'Suggested' };

/** Which of the file's columns go where, and which row holds their names. */
export function ImportMapper({ importId }: { importId: string }) {
  const router = useRouter();
  const url = `/api/desk/imports/${encodeURIComponent(importId)}`;
  const [batch, setBatch] = useState<ImportDetail | null>(null);
  const [columns, setColumns] = useState<MappedColumn[]>([]);
  const [version, setVersion] = useState('');
  const [samples, setSamples] = useState<RowView[]>([]);
  const [topRows, setTopRows] = useState<RowView[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);

  // Only the latest load counts, so a slow one can't overwrite choices made since.
  const latestLoad = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latestLoad.current;
    try {
      const [detail, mapping, rows] = await Promise.all([
        api<ImportDetail>(url),
        api<{ version: string; saved: boolean; columns: MappedColumn[] }>(`${url}/mapping`),
        api<{ rows: RowView[] }>(`${url}/rows?pageSize=${SAMPLE_ROWS}`),
      ]);
      if (mine !== latestLoad.current) return;
      setBatch(detail);
      setColumns(mapping.columns);
      setVersion(mapping.version);
      setSamples(rows.rows);
      setSaved(mapping.saved);
      setPicking(!detail.headerConfident && !mapping.saved);
      setDirty(false);
      setErrors([]);
      setStale(false);
      setLoadError('');
    } catch (err) {
      if (mine !== latestLoad.current) return;
      setLoadError(err instanceof ApiError && err.status === 404
        ? "This import isn't available. It may have been discarded."
        : err instanceof ApiError && err.code === 'NOT_STAGED'
          ? 'This import can no longer be changed.'
          : err instanceof Error ? err.message : 'This import could not be loaded.');
    }
  }, [url]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!picking || topRows) return;
    api<{ rows: RowView[] }>(`${url}/rows?all=1&pageSize=${PICKER_ROWS}`)
      .then((body) => setTopRows(body.rows))
      .catch((err) => setErrors([err instanceof Error ? err.message : 'The rows could not be loaded.']));
  }, [picking, topRows, url]);

  // Closing or reloading the tab with choices not yet saved.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const mapping = useMemo(() => mappingFromColumns(columns), [columns]);
  const notes = useMemo(() => mappingNotes(mapping), [mapping]);
  const chosen = Object.keys(mapping).length;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setErrors([]);
    setStale(false);
    try {
      await action();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Something went wrong.']);
      setStale(err instanceof ApiError && err.code === 'CHANGED_ELSEWHERE');
    } finally {
      setBusy(false);
    }
  };

  const choose = (column: string, value: string) => {
    setColumns((all) => assignField(all, column, (value || null) as ImportFieldKey | null));
    setDirty(true);
    setSaved(false);
  };

  const pickHeaderRow = (headerRow: number) => {
    if (dirty && !window.confirm('Changing the row clears the columns you chose. Continue?')) return;
    if (!batch) return;
    run(async () => {
      await api(url, { method: 'PATCH', body: JSON.stringify({ headerRow, version }) });
      setTopRows(null);
      await load();
      setPicking(false);
    });
  };

  const save = () => {
    if (!batch) return;
    const { errors: problems } = validateMapping(mapping, batch.headers);
    if (problems.length) {
      setErrors(problems);
      return;
    }
    run(async () => {
      const result = await api<{ version: string }>(`${url}/mapping`, { method: 'PUT', body: JSON.stringify({ mapping, version }) });
      setVersion(result.version);
      setDirty(false);
      setSaved(true);
      router.push(`/desk/import/${encodeURIComponent(importId)}/preview`);
    });
  };

  const discard = () => {
    if (!batch || !window.confirm(`Discard ${batch.fileName}? Its rows will be removed.`)) return;
    run(async () => {
      await api(url, { method: 'DELETE' });
      setDirty(false);
      router.push('/desk/import');
    });
  };

  const back = <Link href="/desk/import" className="text-sm underline text-slate-600" data-testid="desk-mapper-back">Back to imports</Link>;

  if (loadError) {
    return (
      <div data-testid="desk-mapper">
        <p className="text-sm text-red-600 mb-3" role="alert" data-testid="desk-mapper-load-error">{loadError}</p>
        {back}
      </div>
    );
  }
  if (!batch) return <p className="text-sm text-slate-500" data-testid="desk-mapper-loading">Loading…</p>;

  return (
    <div data-testid="desk-mapper">
      <div className="mb-5">
        <div className="mb-2">{back}</div>
        <h1 className="text-2xl font-bold tracking-tight mb-1 break-all" style={{ color: ACCENT }} data-testid="page-title">{batch.fileName}</h1>
        <p className="text-sm text-slate-500" data-testid="desk-mapper-summary">
          {batch.rowCount.toLocaleString('en-US')} {batch.rowCount === 1 ? 'row' : 'rows'}{batch.sheetName ? ` · sheet ${batch.sheetName}` : ''}. Choose where each column goes. Nothing is added to your accounts yet.
        </p>
      </div>

      {batch.screened && (
        <p className="text-sm text-slate-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4" data-testid="desk-mapper-screened">
          Left out because they looked like passwords:
          {batch.screened.columns.length > 0 && ` column${batch.screened.columns.length === 1 ? '' : 's'} ${batch.screened.columns.join(', ')}`}
          {batch.screened.columns.length > 0 && batch.screened.cells > 0 && ' and'}
          {batch.screened.cells > 0 && ` ${batch.screened.cells.toLocaleString('en-US')} other ${batch.screened.cells === 1 ? 'cell' : 'cells'}`}.
          {' '}Passwords belong in your password manager, not in The Desk.
        </p>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5" data-testid="desk-mapper-header">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-700">
            {batch.headerRow === 0 ? 'This file has no column names, so columns go by letter.' : <>Column names are on <strong>row {batch.headerRow}</strong> of the file.</>}
          </p>
          <button type="button" className="text-sm underline text-slate-700" data-testid="desk-mapper-change-row" onClick={() => setPicking((p) => !p)}>{picking ? 'Close' : 'Change'}</button>
        </div>
        {picking && (
          <div className="mt-3" data-testid="desk-mapper-picker">
            {!batch.headerConfident && <p className="text-sm text-amber-800 mb-2" data-testid="desk-mapper-unsure">We couldn&apos;t be sure which row holds the column names. Please check.</p>}
            {!topRows && <p className="text-sm text-slate-500">Loading…</p>}
            {topRows && (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <tbody>
                    {topRows.map((row) => (
                      <tr key={row.rowNumber} className={`border-b border-slate-100 last:border-0 ${row.rowNumber === batch.headerRow ? 'bg-slate-100' : ''}`}>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <button
                            type="button" className="underline text-slate-700 disabled:opacity-60" disabled={busy || row.rowNumber === batch.headerRow}
                            data-testid={`desk-mapper-row-${row.rowNumber}`} onClick={() => pickHeaderRow(row.rowNumber)}
                          >
                            {row.rowNumber === batch.headerRow ? `Row ${row.rowNumber} (in use)` : `Use row ${row.rowNumber}`}
                          </button>
                        </td>
                        {row.cells.slice(0, PICKER_COLUMNS).map((cell, i) => <td key={i} className="px-2 py-1.5 max-w-[10rem] truncate text-slate-600" title={cell}>{cell}</td>)}
                        {row.cells.length > PICKER_COLUMNS && <td className="px-2 py-1.5 text-slate-400">…</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button type="button" className="text-sm underline text-slate-700 mt-2 disabled:opacity-60" disabled={busy || batch.headerRow === 0} data-testid="desk-mapper-no-names" onClick={() => pickHeaderRow(0)}>My file has no column names</button>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl mb-5" data-testid="desk-mapper-columns">
        <div className="hidden sm:grid grid-cols-[1fr_1fr_16rem] gap-4 px-4 py-3 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200 font-medium">
          <div>Column in your file</div><div>Examples</div><div>Goes to</div>
        </div>
        {columns.map((c, index) => {
          const examples = sampleValues(samples, index);
          return (
            <div key={c.column} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_16rem] gap-1 sm:gap-4 px-4 py-3 border-b border-slate-100 last:border-0" data-testid={`desk-mapper-column-${index}`}>
              <div className="font-medium text-sm text-slate-800 break-words min-w-0">{c.column}</div>
              <div className="text-xs text-slate-500 min-w-0" data-testid={`desk-mapper-examples-${index}`}>
                {examples.length ? examples.map((value, i) => <div key={i} className="truncate" title={value}>{value}</div>) : <span className="italic">Empty in the first rows</span>}
              </div>
              <div className="min-w-0">
                <select
                  aria-label={`Where ${c.column} goes`} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white disabled:opacity-60" disabled={busy}
                  value={c.field ?? ''} data-testid={`desk-mapper-field-${index}`} onChange={(e) => choose(c.column, e.target.value)}
                >
                  <option value="">Don&apos;t import</option>
                  <optgroup label="Account">
                    {IMPORT_FIELDS.filter((f) => f.group === 'ACCOUNT').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </optgroup>
                  <optgroup label="Policy">
                    {IMPORT_FIELDS.filter((f) => f.group === 'POLICY').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </optgroup>
                </select>
                {c.source && <div className="text-xs text-slate-500 mt-1" data-testid={`desk-mapper-source-${index}`}>{SOURCE_LABELS[c.source]}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {notes.map((note) => <p key={note} className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3" data-testid="desk-mapper-note">{note}</p>)}
      {errors.length > 0 && (
        <div className="mb-3" role="alert" data-testid="desk-mapper-error">
          {errors.map((e) => <p key={e} className="text-sm text-red-600">{e}</p>)}
          {stale && <button type="button" className="text-sm underline text-slate-700 mt-1" data-testid="desk-mapper-reload" onClick={load}>Reload this import</button>}
        </div>
      )}
      {saved && !dirty && (
        <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3" role="status" data-testid="desk-mapper-saved">
          Your column choices are saved, and will be used next time. Nothing has been added to your accounts yet.{' '}
          <Link href={`/desk/import/${encodeURIComponent(importId)}/preview`} className="underline" data-testid="desk-mapper-preview">Preview the import</Link>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={PRIMARY} style={{ background: ACCENT }} disabled={busy} data-testid="desk-mapper-save" onClick={save}>{busy ? 'Saving…' : 'Save and preview'}</button>
        <button type="button" className={SECONDARY} disabled={busy} data-testid="desk-mapper-discard" onClick={discard}>Discard this import</button>
        <span className="text-xs text-slate-500" data-testid="desk-mapper-count">{chosen} of {columns.length} columns chosen</span>
      </div>
    </div>
  );
}
