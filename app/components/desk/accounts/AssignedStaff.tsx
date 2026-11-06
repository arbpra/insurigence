'use client';

import { useEffect, useState } from 'react';
import { ASSIGNMENT_ROLE_LABELS, type AssignmentRoleValue } from '@/lib/desk/team-form';
import { api } from './account-api';

interface Assigned {
  userId: string;
  name: string;
  role: AssignmentRoleValue;
  isActive: boolean;
}

interface Person {
  id: string;
  name: string;
  roleLabel: string;
  defaultRole: AssignmentRoleValue;
}

const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';

/** Who is assigned to an account, and for those who manage it, adding and removing them. */
export function AssignedStaff({ insuredId, staff, canManage, onChanged }: {
  insuredId: string;
  staff: Assigned[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [role, setRole] = useState<AssignmentRoleValue>('PRODUCER');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    const request = new AbortController();
    api<{ people: Person[] }>(`/api/desk/insureds/${encodeURIComponent(insuredId)}/assignments`, { signal: request.signal })
      .then((body) => setPeople(body.people))
      .catch((err) => { if (!request.signal.aborted) setError(err instanceof Error ? err.message : 'Something went wrong.'); });
    return () => request.abort();
  }, [canManage, insuredId]);

  const url = `/api/desk/insureds/${encodeURIComponent(insuredId)}/assignments`;
  const available = (people ?? []).filter((p) => !staff.some((s) => s.userId === p.id));

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      setChosen('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const choose = (id: string) => {
    setChosen(id);
    const person = people?.find((p) => p.id === id);
    if (person) setRole(person.defaultRole);
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 mb-5 min-w-0" data-testid="desk-detail-staff">
      <h2 className="text-base font-semibold text-slate-800 mb-4">Assigned staff</h2>
      {error && <p className="text-sm text-red-600 mb-3" role="alert" data-testid="desk-staff-error">{error}</p>}
      {staff.length === 0 ? (
        <p className="text-sm text-slate-600">Nobody is assigned to this account yet.</p>
      ) : (
        <ul className="space-y-3">
          {staff.map((s) => (
            <li key={s.userId} className="text-sm min-w-0 flex items-start justify-between gap-3" data-testid={`desk-detail-staff-${s.userId}`}>
              <div className="min-w-0">
                <span className="font-medium text-slate-800 break-words">{s.name}</span>
                <span className="block text-xs text-slate-500">{ASSIGNMENT_ROLE_LABELS[s.role]}{s.isActive ? '' : ' · No longer active'}</span>
              </div>
              {canManage && (
                <button
                  type="button" disabled={busy} className="text-sm underline text-slate-700 disabled:opacity-50" data-testid={`desk-staff-remove-${s.userId}`}
                  onClick={() => {
                    if (window.confirm(`Remove ${s.name} from this account? If they see only assigned accounts, they will lose access to it.`)) {
                      run(() => api(`${url}?userId=${encodeURIComponent(s.userId)}`, { method: 'DELETE' }));
                    }
                  }}
                >Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && people && (
        available.length === 0 ? (
          <p className="text-xs text-slate-500 mt-4" data-testid="desk-staff-none-left">Everyone in your agency is already assigned.</p>
        ) : (
          <form
            className="mt-4 pt-4 border-t border-slate-100 space-y-2" data-testid="desk-staff-add"
            onSubmit={(e) => { e.preventDefault(); if (chosen) run(() => api(url, { method: 'PUT', body: JSON.stringify({ userId: chosen, role }) })); }}
          >
            <label className="block text-sm font-medium text-slate-700" htmlFor="desk-staff-person">Assign someone</label>
            <select id="desk-staff-person" className={INPUT} value={chosen} onChange={(e) => choose(e.target.value)} data-testid="desk-staff-person">
              <option value="">Choose a person…</option>
              {available.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.roleLabel})</option>)}
            </select>
            <select aria-label="Assigned as" className={INPUT} value={role} onChange={(e) => setRole(e.target.value as AssignmentRoleValue)} data-testid="desk-staff-role">
              {(Object.keys(ASSIGNMENT_ROLE_LABELS) as AssignmentRoleValue[]).map((r) => <option key={r} value={r}>{ASSIGNMENT_ROLE_LABELS[r]}</option>)}
            </select>
            <button type="submit" disabled={busy || !chosen} className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700 disabled:opacity-50" data-testid="desk-staff-assign">Assign</button>
          </form>
        )
      )}
    </section>
  );
}
