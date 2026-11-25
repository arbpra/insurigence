'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROLE_LABELS } from '@/lib/roles';
import type { InviteResult, StaffRow } from '@/lib/desk/staff';

const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const LABEL = 'block text-sm font-medium text-slate-700 mb-1';
const ACTION = 'text-xs font-medium text-slate-600 hover:text-slate-900 underline disabled:opacity-50';
const PRIMARY = { backgroundColor: 'var(--brand-primary, #05314c)' };

const INVITE_LABELS: Record<StaffRow['invite'], string> = { ACCEPTED: '', PENDING: 'Invite sent', EXPIRED: 'Invite expired' };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

/** Internal Desk staff: invite, rename, resend, deactivate, reactivate. */
export function StaffManager() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('active');
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [inviteRoles, setInviteRoles] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; link?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [names, setNames] = useState({ firstName: '', lastName: '' });
  const [invite, setInvite] = useState({ email: '', firstName: '', lastName: '', role: 'ACCOUNT_MANAGER' });

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    const data = await api<{ staff: StaffRow[]; inviteRoles: string[] }>(`/api/desk/admin/staff?${params}`);
    setStaff(data.staff);
    setInviteRoles(data.inviteRoles);
    setInvite((i) => (data.inviteRoles.includes(i.role) || !data.inviteRoles.length ? i : { ...i, role: data.inviteRoles[0] }));
  }, [q, role, status]);

  useEffect(() => {
    const timer = setTimeout(() => { load().catch((err) => setError(err.message)); }, 250);
    return () => clearTimeout(timer);
  }, [load]);

  /** Runs an action, then reloads, showing whatever it reports. */
  const run = async (action: () => Promise<{ text: string; link?: string } | null>) => {
    setBusy(true);
    setError('');
    setNotice(null);
    try {
      setNotice(await action());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const inviteNotice = (name: string, r: InviteResult) => r.emailSent
    ? { text: `Invite emailed to ${name}.` }
    : { text: `The email to ${name} did not go out (${r.emailError}). Share this link with them; it works once, for 72 hours:`, link: r.acceptUrl };

  const submitInvite = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<InviteResult>('/api/desk/admin/staff', { method: 'POST', body: JSON.stringify(invite) });
      setInviting(false);
      setInvite({ email: '', firstName: '', lastName: '', role: inviteRoles.includes('ACCOUNT_MANAGER') ? 'ACCOUNT_MANAGER' : inviteRoles[0] ?? '' });
      return inviteNotice(invite.email, r);
    });
  };

  const patch = <T,>(id: string, body: object) => api<T>(`/api/desk/admin/staff/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

  const deactivate = (s: StaffRow) => {
    const consequences = [
      'They are signed out and can no longer log in.',
      s.openTasks ? `${plural(s.openTasks, 'open request')} go back to the queue.` : '',
      s.agencies ? `They are Account Manager for ${s.agencies === 1 ? '1 agency' : `${s.agencies} agencies`}, which will need cover.` : '',
    ].filter(Boolean).join('\n');
    if (!window.confirm(`Deactivate ${s.name}?\n\n${consequences}`)) return;
    run(async () => {
      const r = await patch<{ tasksReturned: number; agenciesWithoutAm: string[] }>(s.id, { action: 'deactivate' });
      const parts = [`${s.name} was deactivated.`];
      if (r.tasksReturned) parts.push(`${plural(r.tasksReturned, 'open request')} went back to the queue.`);
      if (r.agenciesWithoutAm.length) parts.push(`No active Account Manager now for: ${r.agenciesWithoutAm.join(', ')}.`);
      return { text: parts.join(' ') };
    });
  };

  const roleChoices = (Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[]).filter((r) => ['ACCOUNT_MANAGER', 'DESK_VA', 'DESK_ADMIN'].includes(r));

  return (
    <div data-testid="desk-staff">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--brand-primary, #05314c)' }} data-testid="page-title">Staff</h1>
          <p className="text-sm text-slate-500">Invite and manage Account Managers, VAs and Operations Managers.</p>
        </div>
        {inviteRoles.length > 0 && <button onClick={() => setInviting(!inviting)} className="px-4 py-2 rounded-lg text-sm font-medium text-white self-start" style={PRIMARY} data-testid="desk-staff-invite-open">
          Invite staff
        </button>}
      </div>

      {inviting && (
        <form onSubmit={submitInvite} className="bg-white border border-slate-200 rounded-xl p-5 mb-5" data-testid="desk-staff-invite-form">
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className={LABEL} htmlFor="inviteFirst">First name</label>
              <input id="inviteFirst" required maxLength={100} className={INPUT} value={invite.firstName} onChange={(e) => setInvite({ ...invite, firstName: e.target.value })} />
            </div>
            <div>
              <label className={LABEL} htmlFor="inviteLast">Last name</label>
              <input id="inviteLast" required maxLength={100} className={INPUT} value={invite.lastName} onChange={(e) => setInvite({ ...invite, lastName: e.target.value })} />
            </div>
            <div>
              <label className={LABEL} htmlFor="inviteEmail">Email</label>
              <input id="inviteEmail" type="email" required className={INPUT} value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            </div>
            <div>
              <label className={LABEL} htmlFor="inviteRole">Role</label>
              <select id="inviteRole" className={INPUT} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                {roleChoices.filter((r) => inviteRoles.includes(r)).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-500 mb-4">They get a link to set their own password. It works once and lasts 72 hours.</p>
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={PRIMARY} data-testid="desk-staff-invite-send">Send invite</button>
        </form>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input type="search" aria-label="Search staff" placeholder="Search by name or email" className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter by role" className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {roleChoices.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <select aria-label="Filter by status" className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="">Active and inactive</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-staff-error">{error}</p>}
      {notice && (
        <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" role="status" data-testid="desk-staff-notice">
          <p>{notice.text}</p>
          {notice.link && <p className="mt-1 break-all font-mono text-xs">{notice.link}</p>}
        </div>
      )}
      {!staff && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {staff?.length === 0 && <p className="text-sm text-slate-500" data-testid="desk-staff-empty">No staff match.</p>}

      {staff && staff.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Works on</th>
                <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0 align-top" data-testid="desk-staff-row">
                  <td className="px-4 py-3">
                    {editing === s.id ? (
                      <form
                        className="flex flex-col gap-2 min-w-[12rem]"
                        onSubmit={(e) => { e.preventDefault(); run(async () => { await patch(s.id, { action: 'rename', ...names }); setEditing(null); return null; }); }}
                      >
                        <input aria-label="First name" required maxLength={100} className={INPUT} value={names.firstName} onChange={(e) => setNames({ ...names, firstName: e.target.value })} />
                        <input aria-label="Last name" required maxLength={100} className={INPUT} value={names.lastName} onChange={(e) => setNames({ ...names, lastName: e.target.value })} />
                        <span className="flex gap-3">
                          <button type="submit" disabled={busy} className={ACTION}>Save</button>
                          <button type="button" className={ACTION} onClick={() => setEditing(null)}>Cancel</button>
                        </span>
                      </form>
                    ) : (
                      <>
                        <p className="font-medium text-slate-800">{s.name}{s.isSelf && <span className="text-slate-400 font-normal"> (you)</span>}</p>
                        <p className="text-xs text-slate-500">{s.email}</p>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.roleLabel}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                    {s.isActive && s.invite !== 'ACCEPTED' && (
                      <p className={`text-xs mt-1 ${s.invite === 'EXPIRED' ? 'text-amber-700' : 'text-slate-500'}`}>{INVITE_LABELS[s.invite]}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {s.role === 'ACCOUNT_MANAGER' && <p>{s.agencies === 1 ? '1 agency' : `${s.agencies} agencies`}</p>}
                    {s.role !== 'DESK_ADMIN' && <p>{plural(s.pods, 'pod')}</p>}
                    {s.role !== 'DESK_ADMIN' && <p>{plural(s.openTasks, 'open request')}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {s.canManage && editing !== s.id && (
                      <div className="flex flex-wrap gap-3 justify-end">
                        <button className={ACTION} disabled={busy} onClick={() => { setEditing(s.id); setNames({ firstName: s.firstName ?? '', lastName: s.lastName ?? '' }); }}>Edit name</button>
                        {s.isActive && s.invite !== 'ACCEPTED' && (
                          <button className={ACTION} disabled={busy} onClick={() => run(async () => inviteNotice(s.name, await patch<InviteResult>(s.id, { action: 'resend' })))}>Resend invite</button>
                        )}
                        {s.isActive && !s.isSelf && (
                          <button className={`${ACTION} text-red-700 hover:text-red-900`} disabled={busy} onClick={() => deactivate(s)}>Deactivate</button>
                        )}
                        {!s.isActive && (
                          <button className={ACTION} disabled={busy} onClick={() => run(async () => { await patch(s.id, { action: 'reactivate' }); return { text: `${s.name} was reactivated.` }; })}>Reactivate</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
