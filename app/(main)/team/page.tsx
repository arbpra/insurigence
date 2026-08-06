'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { PageHeader, Badge, Button } from '@/components/ui';

interface TeamUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'AGENT';
  isActive: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
}

/**
 * Agency team management. Agency admins invite teammates here — this is how an
 * agent joins an existing agency (invite-only, never by typing an agency name
 * at signup). Invited users get a temporary password they must change on first
 * login.
 */
export default function TeamPage() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState({ firstName: '', lastName: '', email: '', role: 'AGENT' });
  const [result, setResult] = useState<{ email: string; emailSent: boolean; acceptUrl?: string; emailError?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agency/users');
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      const json = await res.json();
      if (res.ok) setUsers(json.users || []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/agency/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invite),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to invite user.');
      } else {
        setResult({
          email: json.user.email,
          emailSent: json.emailSent,
          acceptUrl: json.acceptUrl,
          emailError: json.emailError,
        });
        setInvite({ firstName: '', lastName: '', email: '', role: 'AGENT' });
        load();
      }
    } catch {
      setError('Network error.');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = () => {
    if (!result?.acceptUrl) return;
    navigator.clipboard.writeText(result.acceptUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (forbidden) {
    return (
      <AppLayout>
        <PageHeader title="Team" subtitle="Manage your agency's users" />
        <div className="bg-white rounded-xl border border-slate-200/80 p-8 text-center">
          <p className="text-sm text-slate-500">
            Only agency admins can manage the team. Contact your administrator for access.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader title="Team" subtitle="Invite teammates to your agency and manage access" />

      {/* Invite form */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--brand-primary)' }}>
          Invite a teammate
        </h2>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm mb-4">
            {error}
          </div>
        )}

        {result && result.emailSent && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm mb-4">
            <p className="font-medium text-green-800">Invite email sent to {result.email}</p>
            <p className="text-green-700 mt-1">
              They&apos;ll set their own password from the link. It expires in 72 hours.
            </p>
          </div>
        )}

        {result && !result.emailSent && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm mb-4">
            <p className="font-medium text-amber-800 mb-1">Invite created for {result.email}</p>
            <p className="text-amber-700 mb-2">
              We couldn&apos;t send the email{result.emailError ? ` (${result.emailError})` : ''}. Share this
              single-use link with them instead — it expires in 72 hours.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="px-3 py-1.5 bg-white border border-amber-200 rounded font-mono text-xs text-slate-800 break-all">
                {result.acceptUrl}
              </code>
              <button onClick={copyLink} className="text-xs font-medium text-amber-800 hover:text-amber-900">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <form onSubmit={sendInvite} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium mb-1 text-slate-500">First Name</label>
            <input
              value={invite.firstName}
              onChange={(e) => setInvite((v) => ({ ...v, firstName: e.target.value }))}
              className="form-input w-full"
              required
              data-testid="input-invite-firstName"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-slate-500">Last Name</label>
            <input
              value={invite.lastName}
              onChange={(e) => setInvite((v) => ({ ...v, lastName: e.target.value }))}
              className="form-input w-full"
              required
              data-testid="input-invite-lastName"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-slate-500">Email</label>
            <input
              type="email"
              value={invite.email}
              onChange={(e) => setInvite((v) => ({ ...v, email: e.target.value }))}
              className="form-input w-full"
              required
              data-testid="input-invite-email"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-slate-500">Role</label>
            <select
              value={invite.role}
              onChange={(e) => setInvite((v) => ({ ...v, role: e.target.value }))}
              className="form-input w-full"
              data-testid="select-invite-role"
            >
              <option value="AGENT">Agent</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <Button variant="primary" type="submit" loading={busy} testId="button-send-invite">
            Send Invite
          </Button>
        </form>
      </div>

      {/* Team list */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--brand-primary)' }}>
            Team Members ({users.length})
          </h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No team members yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                {['Name', 'Email', 'Role', 'Status', 'Last Login'].map((h) => (
                  <th key={h} className="px-6 py-3 text-xs font-medium uppercase text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-6 py-3 text-slate-600">{u.email}</td>
                  <td className="px-6 py-3">
                    <Badge variant={u.role === 'ADMIN' ? 'reviewed' : 'new'}>
                      {u.role === 'ADMIN' ? 'Admin' : 'Agent'}
                    </Badge>
                  </td>
                  <td className="px-6 py-3">
                    <Badge variant={u.isActive ? 'converted' : 'pending'}>
                      {u.isActive ? (u.mustChangePassword ? 'Invited' : 'Active') : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-6 py-3 text-slate-500">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  );
}
