'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { OnExisting, PlanCounts, RowProblem } from '@/lib/desk/import-plan';
import { POLICY_STATUS_LABELS, premiumLabel, type PolicyStatusValue } from '@/lib/desk/policy-form';
import { ApiError, api } from '../accounts/account-api';
import { undoSentence, type ImportSummary } from './ImportCenter';

interface PreviewPolicy {
  rowNumber: number;
  policyNumber: string | null;
  lineOfBusiness: string | null;
  carrierName: string | null;
  expirationDate: string | null;
  premiumCents: number | null;
  status: PolicyStatusValue;
}

interface Preview {
  version: string;
  fileName: string;
  onExisting: OnExisting;
  counts: PlanCounts;
  unmatchedProducers: { name: string; rows: number }[];
  accounts: { name: string; existing: boolean; assigned: number; policies: PreviewPolicy[] }[];
  accountsTotal: number;
  problems: RowProblem[];
  problemsTotal: number;
}

const ACCENT = 'var(--brand-primary, #05314c)';
const PRIMARY = 'px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60';
const SECONDARY = 'px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700 disabled:opacity-60';
const KIND_LABELS: Record<RowProblem['kind'], string> = { ERROR: 'Left out: needs fixing', DUPLICATE: 'Left out: already there', WARNING: 'Goes in: worth a look' };
const KIND_STYLES: Record<RowProblem['kind'], string> = { ERROR: 'text-red-700', DUPLICATE: 'text-slate-600', WARNING: 'text-amber-800' };

const number = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`;

function Figure({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-2xl font-semibold text-slate-800" data-testid={testId}>{number(value)}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

/** What the import will do, the go-ahead, and the way back. */
export function ImportPreview({ importId }: { importId: string }) {
  const url = `/api/desk/imports/${encodeURIComponent(importId)}`;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [onExisting, setOnExisting] = useState<OnExisting>('ADD');
  const [result, setResult] = useState<(ImportSummary & { counts: PlanCounts }) | null>(null);
  const [undone, setUndone] = useState<ImportSummary | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Only the latest load counts, so a slow one can't replace the figures for the choice now showing.
  const latestLoad = useRef(0);

  const load = useCallback(async (choice: OnExisting) => {
    const mine = ++latestLoad.current;
    setBusy(true);
    try {
      const body = await api<Preview>(`${url}/preview?onExisting=${choice}`);
      if (mine !== latestLoad.current) return;
      setPreview(body);
      setLoadError('');
    } catch (err) {
      if (mine !== latestLoad.current) return;
      setLoadError(err instanceof ApiError && err.status === 404
        ? "This import isn't available. It may have been discarded."
        : err instanceof ApiError && err.code === 'NOT_STAGED'
          ? 'This import has already been dealt with. You can see it in your imports.'
          : err instanceof Error ? err.message : 'The preview could not be loaded.');
    } finally {
      if (mine === latestLoad.current) setBusy(false);
    }
  }, [url]);

  useEffect(() => { load('ADD'); }, [load]);

  const choose = (choice: OnExisting) => {
    setOnExisting(choice);
    setError('');
    load(choice);
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const body = await api<ImportSummary & { counts: PlanCounts }>(`${url}/commit`, {
        method: 'POST',
        body: JSON.stringify({ version: preview.version, onExisting, expected: { accountsNew: preview.counts.accountsNew, policiesNew: preview.counts.policiesNew } }),
      });
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import could not be finished.');
      if (err instanceof ApiError && (err.code === 'PREVIEW_OUT_OF_DATE' || err.code === 'CHANGED_ELSEWHERE')) await load(onExisting);
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!window.confirm('Undo this import? What it added is removed, except anything with requests or changed since.')) return;
    setBusy(true);
    setError('');
    try {
      setUndone(await api<ImportSummary>(`${url}/undo`, { method: 'POST' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import could not be undone.');
    } finally {
      setBusy(false);
    }
  };

  const back = <Link href="/desk/import" className="text-sm underline text-slate-600" data-testid="desk-preview-back">Back to imports</Link>;
  const errorLine = error && <p className="text-sm text-red-600 mb-3" role="alert" data-testid="desk-preview-error">{error}</p>;

  if (undone) {
    return (
      <div data-testid="desk-preview">
        <h1 className="text-2xl font-bold tracking-tight mb-3" style={{ color: ACCENT }} data-testid="page-title">Import undone</h1>
        <p className="text-sm text-slate-700 mb-2" role="status" data-testid="desk-preview-undone">{undone.undoSummary ? undoSentence(undone.undoSummary) : 'This import has been undone.'}</p>
        {undone.undoSummary && undone.undoSummary.keptNames.length > 0 && <p className="text-sm text-slate-600 mb-3" data-testid="desk-preview-kept">Kept: {undone.undoSummary.keptNames.join(', ')}</p>}
        {back}
      </div>
    );
  }

  if (result) {
    const c = result.counts;
    return (
      <div data-testid="desk-preview">
        <h1 className="text-2xl font-bold tracking-tight mb-3" style={{ color: ACCENT }} data-testid="page-title">Import finished</h1>
        <p className="text-sm text-slate-700 mb-4" role="status" data-testid="desk-preview-done">
          Added {plural(c.accountsNew, 'new account')} and {plural(c.policiesNew, 'policy', 'policies')}.
          {c.errors + c.duplicates > 0 && ` ${plural(c.errors + c.duplicates, 'row was', 'rows were')} left out, as the preview showed.`}
        </p>
        {errorLine}
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/desk/accounts" className={PRIMARY} style={{ background: ACCENT }} data-testid="desk-preview-accounts">See your accounts</Link>
          <button type="button" className={SECONDARY} disabled={busy} data-testid="desk-preview-undo" onClick={undo}>Undo this import</button>
          {back}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div data-testid="desk-preview">
        <p className="text-sm text-red-600 mb-3" role="alert" data-testid="desk-preview-load-error">{loadError}</p>
        {back}
      </div>
    );
  }
  if (!preview) return <p className="text-sm text-slate-500" data-testid="desk-preview-loading">Checking your rows… a large file can take a minute.</p>;

  const c = preview.counts;
  const nothing = !c.accountsNew && !c.policiesNew;
  const leftOut = c.errors + c.duplicates;
  return (
    <div data-testid="desk-preview">
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap gap-4">
          <Link href={`/desk/import/${encodeURIComponent(importId)}`} className="text-sm underline text-slate-600" data-testid="desk-preview-columns">Change columns</Link>
          {back}
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-1 break-all" style={{ color: ACCENT }} data-testid="page-title">{preview.fileName}</h1>
        <p className="text-sm text-slate-500">This is what the import will do. Nothing is added to your accounts until you confirm.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Figure label="New accounts" value={c.accountsNew} testId="desk-preview-accounts-new" />
        <Figure label="Policies to add" value={c.policiesNew} testId="desk-preview-policies-new" />
        <Figure label="Accounts already in your book" value={c.accountsExisting} testId="desk-preview-accounts-existing" />
        <Figure label="Rows left out" value={leftOut} testId="desk-preview-left-out" />
      </div>

      {c.accountsExisting > 0 && (
        <fieldset className="bg-white border border-slate-200 rounded-xl p-4 mb-5" data-testid="desk-preview-existing">
          <legend className="text-sm font-medium text-slate-800 px-1">Accounts already in your book</legend>
          <p className="text-xs text-slate-500 mb-2">Their details and assigned people aren&apos;t changed either way.</p>
          <label className="flex items-start gap-2 text-sm text-slate-700 mb-1">
            <input type="radio" name="on-existing" className="mt-1" checked={onExisting === 'ADD'} disabled={busy} data-testid="desk-preview-add" onChange={() => choose('ADD')} />
            Add any new policies to them
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="radio" name="on-existing" className="mt-1" checked={onExisting === 'SKIP'} disabled={busy} data-testid="desk-preview-skip" onChange={() => choose('SKIP')} />
            Leave their rows out
          </label>
        </fieldset>
      )}

      {c.policiesNoExpiration > 0 && (
        <p className="text-sm text-slate-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3" data-testid="desk-preview-no-expiration">
          {plural(c.policiesNoExpiration, 'policy has', 'policies have')} no expiration date. Renewal work relies on it.
        </p>
      )}
      {c.accountsUnassigned > 0 && (
        <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3" data-testid="desk-preview-unassigned">
          {plural(c.accountsUnassigned, 'new account has', 'new accounts have')} nobody assigned. Owners and admins will see them, and anyone else who sees only assigned accounts won&apos;t until someone is assigned.
        </p>
      )}
      {preview.unmatchedProducers.length > 0 && (
        <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3" data-testid="desk-preview-unmatched">
          These producers couldn&apos;t be matched to someone active in your agency:{' '}
          {preview.unmatchedProducers.map((p) => `${p.name} (${plural(p.rows, 'row')})`).join(', ')}.
        </div>
      )}

      {preview.problemsTotal > 0 && (
        <div className="mb-5">
          <h2 className="text-base font-semibold text-slate-800 mb-2">Rows to look at</h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm" data-testid="desk-preview-problems">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th scope="col" className="px-4 py-3 font-medium">Row</th>
                  <th scope="col" className="hidden sm:table-cell px-4 py-3 font-medium">Named insured</th>
                  <th scope="col" className="px-4 py-3 font-medium">What happens</th>
                </tr>
              </thead>
              <tbody>
                {preview.problems.map((p) => (
                  <tr key={p.rowNumber} className="border-b border-slate-100 last:border-0 align-top" data-testid={`desk-preview-problem-${p.rowNumber}`}>
                    <td className="px-4 py-3 whitespace-nowrap">{number(p.rowNumber)}</td>
                    <td className="hidden sm:table-cell px-4 py-3 min-w-[9rem] break-words">{p.name || <span className="italic text-slate-400">None</span>}</td>
                    <td className="px-4 py-3 break-words">
                      {p.name && <div className="sm:hidden font-medium text-slate-800">{p.name}</div>}
                      <div className={`text-xs font-medium ${KIND_STYLES[p.kind]}`}>{KIND_LABELS[p.kind]}</div>
                      {p.messages.map((m) => <div key={m} className="text-slate-700">{m}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.problemsTotal > preview.problems.length && <p className="text-xs text-slate-500 mt-2" data-testid="desk-preview-more-problems">Showing the first {number(preview.problems.length)} of {number(preview.problemsTotal)} rows.</p>}
          {c.errors > 0 && <p className="text-xs text-slate-500 mt-2">To bring in a row left out for fixing, correct it in your file and upload that file again. Rows already imported are recognised and not added twice.</p>}
        </div>
      )}

      {preview.accounts.length > 0 && (
        <div className="mb-5">
          <h2 className="text-base font-semibold text-slate-800 mb-2">What goes in</h2>
          <div className="bg-white border border-slate-200 rounded-xl" data-testid="desk-preview-list">
            {preview.accounts.map((a, i) => (
              <div key={`${a.name}-${i}`} className="px-4 py-3 border-b border-slate-100 last:border-0" data-testid={`desk-preview-account-${i}`}>
                <div className="font-medium text-sm text-slate-800 break-words">
                  {a.name}
                  <span className="ml-2 text-xs font-normal text-slate-500">{a.existing ? 'Already in your book' : 'New account'}{a.assigned > 0 ? ` · ${plural(a.assigned, 'person', 'people')} assigned` : ''}</span>
                </div>
                {a.policies.length > 0
                  ? a.policies.map((p) => (
                      <div key={p.rowNumber} className="text-xs text-slate-600 mt-1 break-words">
                        {[p.policyNumber, p.lineOfBusiness, p.carrierName].filter(Boolean).join(' · ')} · expires {p.expirationDate ?? 'not given'}{p.premiumCents !== null ? ` · ${premiumLabel(p.premiumCents)}` : ''} · {POLICY_STATUS_LABELS[p.status]}
                      </div>
                    ))
                  : <div className="text-xs text-slate-500 mt-1">No policies</div>}
              </div>
            ))}
          </div>
          {preview.accountsTotal > preview.accounts.length && <p className="text-xs text-slate-500 mt-2" data-testid="desk-preview-more-accounts">Showing the first {number(preview.accounts.length)} of {number(preview.accountsTotal)} accounts.</p>}
        </div>
      )}

      {errorLine}
      {nothing && <p className="text-sm text-slate-700 mb-3" data-testid="desk-preview-nothing">There&apos;s nothing new to import from this file.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={PRIMARY} style={{ background: ACCENT }} disabled={busy || nothing} data-testid="desk-preview-commit" onClick={commit}>
          {busy ? 'Working…' : `Import ${plural(c.accountsNew, 'account')} and ${plural(c.policiesNew, 'policy', 'policies')}`}
        </button>
        {leftOut > 0 && !nothing && <span className="text-xs text-slate-500" data-testid="desk-preview-leaving-out">{plural(leftOut, 'row')} will be left out.</span>}
      </div>
    </div>
  );
}
