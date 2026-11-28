'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fileSizeLabel, localDayLabel, mailtoHref, websiteHref } from '@/lib/desk/account-form';
import { ApiError, api } from './account-api';
import { AssignedStaff } from './AssignedStaff';
import { ClassificationPanel, type AccountClassificationView } from './ClassificationPanel';
import { PolicyPanel, type PolicyRow } from './PolicyPanel';

interface Overview {
  id: string;
  name: string;
  dba: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  industry: string | null;
  description: string | null;
  notes?: string | null;
  externalRef: string | null;
  policies: PolicyRow[];
  assignments?: { userId: string; name: string; role: 'PRODUCER' | 'SERVICE'; isActive: boolean }[];
  requests: { total: number; rows: { id: string; reference: number; typeLabel: string; title: string; statusLabel: string; needsAttention: boolean; createdAt: string }[] };
  documents: { total: number; rows: { id: string; fileName: string; fileSize: number; categoryLabel: string; addedAt: string; requestReference: number }[] };
  can: { edit: boolean; manage: boolean };
  /** Module 53: Desk staff only. */
  classification?: AccountClassificationView | null;
}

const ACCENT = 'var(--brand-primary, #05314c)';
const CARD = 'bg-white border border-slate-200 rounded-xl p-5 mb-5 min-w-0';
const HEADING = 'text-base font-semibold text-slate-800';
const NOTE = 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-800 mt-0.5 break-words whitespace-pre-line">{children || '—'}</dd>
    </div>
  );
}

/** Only part of a long list is shown here. */
const shownOf = (shown: number, total: number, noun: string) =>
  total > shown ? <p className="text-xs text-slate-500 mt-3">Showing the newest {shown} of {total.toLocaleString('en-US')} {noun}.</p> : null;

/** One account: its details, who is assigned, its policies, and its open requests and documents. */
export function AccountDetail({ accountId, justCreated }: { accountId: string; justCreated?: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [notice] = useState(justCreated ? 'Account added. You can add its policies below.' : '');
  const [policyUnsaved, setPolicyUnsaved] = useState(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    // Aborting the previous load stops an older answer replacing a newer one.
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    try {
      const body = await api<Overview>(`/api/desk/insureds/${encodeURIComponent(accountId)}/overview`, { signal: current.signal });
      if (current.signal.aborted) return;
      setData(body);
      setError('');
    } catch (err) {
      if (current.signal.aborted) return;
      if (err instanceof ApiError && err.status === 404) setMissing(true);
      else setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }, [accountId]);

  useEffect(() => {
    load();
    return () => request.current?.abort();
  }, [load]);

  // So that reloading the page doesn't announce the new account again.
  useEffect(() => {
    if (justCreated) window.history.replaceState(null, '', `/desk/accounts/${encodeURIComponent(accountId)}`);
  }, [justCreated, accountId]);

  const leave = (e: React.MouseEvent) => {
    if (policyUnsaved && !window.confirm('Leave without saving this policy?')) e.preventDefault();
  };

  const back = <Link href="/desk/accounts" className="text-sm text-slate-600 hover:underline" onClick={leave} data-testid="desk-detail-back">← Accounts</Link>;

  if (missing) {
    return (
      <div data-testid="desk-detail">
        {back}
        <p className="text-sm text-red-600 mt-4" role="alert" data-testid="desk-detail-missing">This account isn&apos;t available. It may not exist, or may not be assigned to you.</p>
      </div>
    );
  }
  if (!data) {
    return error ? (
      <div data-testid="desk-detail">
        {back}
        <p className="text-sm text-red-600 mt-4" role="alert" data-testid="desk-detail-error">
          {error}{' '}
          <button type="button" className="underline" onClick={load} data-testid="desk-detail-retry">Try again</button>
        </p>
      </div>
    ) : <p className="text-sm text-slate-500" data-testid="desk-detail-loading">Loading…</p>;
  }

  const site = websiteHref(data.website);
  const place = [data.city, data.state].filter(Boolean).join(', ');
  const address = [data.addressLine1, data.addressLine2, [place, data.postalCode].filter(Boolean).join(' ')].filter(Boolean).join('\n');

  return (
    <div className="max-w-5xl min-w-0" data-testid="desk-detail">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3 mt-2 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight break-words" style={{ color: ACCENT }} data-testid="page-title">{data.name}</h1>
          {data.dba && <p className="text-sm text-slate-500 break-words">DBA {data.dba}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {data.status === 'ACTIVE' && (
            <Link href={`/desk/requests/new?insuredId=${data.id}`} onClick={leave} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: ACCENT }} data-testid="desk-detail-new-request">New request</Link>
          )}
          {data.can.edit && (
            <Link href={`/desk/accounts/${data.id}/edit`} onClick={leave} className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700" data-testid="desk-detail-edit">Edit details</Link>
          )}
        </div>
      </div>

      {data.status === 'INACTIVE' && <p className={NOTE} data-testid="desk-detail-inactive">This account is inactive. No new requests can be sent for it.</p>}
      {notice && <p className={NOTE} role="status" data-testid="desk-detail-notice">{notice}</p>}
      {error && (
        <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-detail-error">
          {error}{' '}
          <button type="button" className="underline" onClick={load} data-testid="desk-detail-retry">Try again</button>
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-5">
        <section className={`${CARD} lg:col-span-2`} data-testid="desk-detail-profile">
          <h2 className={`${HEADING} mb-4`}>Details</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Detail label="Contact">{data.contactName}</Detail>
            <Detail label="Email">{data.contactEmail && <a className="underline" href={mailtoHref(data.contactEmail)}>{data.contactEmail}</a>}</Detail>
            <Detail label="Phone">{data.contactPhone}</Detail>
            <Detail label="Website">
              {site ? <a className="underline" href={site} target="_blank" rel="noopener noreferrer" data-testid="desk-detail-website">{data.website}</a> : data.website}
            </Detail>
            <Detail label="Address">{address}</Detail>
            <Detail label="Industry">{data.industry}</Detail>
            <Detail label="AMS reference">{data.externalRef}</Detail>
          </dl>
          {data.description && <dl className="mt-4"><Detail label="Description">{data.description}</Detail></dl>}
          {data.notes && <dl className="mt-4"><Detail label="Notes">{data.notes}</Detail></dl>}
        </section>

        <div className="min-w-0">
          <AssignedStaff insuredId={data.id} staff={data.assignments ?? []} canManage={data.can.manage} onChanged={load} />
          {data.classification && <ClassificationPanel insuredId={data.id} value={data.classification} onChanged={load} />}
        </div>
      </div>

      <PolicyPanel insuredId={data.id} policies={data.policies} canEdit={data.can.edit} onChanged={load} onUnsaved={setPolicyUnsaved} />

      <section className={CARD} data-testid="desk-detail-requests">
        <h2 className={`${HEADING} mb-4`}>Open requests{data.requests.total > 0 ? ` (${data.requests.total.toLocaleString('en-US')})` : ''}</h2>
        {data.requests.rows.length === 0 ? (
          <p className="text-sm text-slate-600">No open requests on this account.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th scope="col" className="py-2 pr-4 font-medium">Request</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Type</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="py-2 font-medium">Received</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.rows.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0" data-testid={`desk-detail-request-${t.id}`}>
                    <td className="py-2 pr-4 text-slate-800 min-w-[12rem]"><Link href={`/desk/requests/${t.id}`} onClick={leave} className="hover:underline" data-testid="desk-detail-request-open"><span className="text-slate-500">#{t.reference}</span> {t.title}</Link></td>
                    <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">{t.typeLabel}</td>
                    <td className={`py-2 pr-4 whitespace-nowrap ${t.needsAttention ? 'font-medium text-amber-800' : 'text-slate-600'}`}>{t.statusLabel}</td>
                    <td className="py-2 text-slate-600 whitespace-nowrap">{localDayLabel(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {shownOf(data.requests.rows.length, data.requests.total, 'requests')}
      </section>

      <section className={CARD} data-testid="desk-detail-documents">
        <h2 className={`${HEADING} mb-4`}>Documents{data.documents.total > 0 ? ` (${data.documents.total.toLocaleString('en-US')})` : ''}</h2>
        {data.documents.rows.length === 0 ? (
          <p className="text-sm text-slate-600">No documents on this account&apos;s requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th scope="col" className="py-2 pr-4 font-medium">File</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Category</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Request</th>
                  <th scope="col" className="py-2 font-medium">Added</th>
                </tr>
              </thead>
              <tbody>
                {data.documents.rows.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100 last:border-0" data-testid={`desk-detail-document-${d.id}`}>
                    <td className="py-2 pr-4 text-slate-800 break-words min-w-[12rem]">
                      {/* PDFs and images open in a new tab; other files download. Each open is logged. */}
                      <a href={`/api/desk/documents/${d.id}?view=1`} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline" data-testid={`desk-detail-document-open-${d.id}`}>{d.fileName}</a>{' '}
                      <span className="text-xs text-slate-500 whitespace-nowrap">{fileSizeLabel(d.fileSize)}</span></td>
                    <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">{d.categoryLabel}</td>
                    <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">#{d.requestReference}</td>
                    <td className="py-2 text-slate-600 whitespace-nowrap">{localDayLabel(d.addedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {shownOf(data.documents.rows.length, data.documents.total, 'documents')}
      </section>
    </div>
  );
}
