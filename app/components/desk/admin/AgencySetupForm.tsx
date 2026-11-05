'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Circle } from 'lucide-react';
import type { AmsSystem, ServiceCategory } from '@prisma/client';
import { AMS_SYSTEM_LABELS } from '@/lib/desk/profile';
import { SERVICE_CATEGORY_LABELS } from '@/lib/desk/billing';
import type { AgencySetupView } from '@/lib/desk/agency-setup';

const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const LABEL = 'block text-sm font-medium text-slate-700 mb-1';
const CATEGORIES = Object.keys(SERVICE_CATEGORY_LABELS) as ServiceCategory[];

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;
const today = () => new Date().toISOString().slice(0, 10);

/** How one category's allowance is set for this agency. */
type OverrideChoice = { mode: 'plan' | 'units' | 'unlimited'; units: string };

interface FormState {
  deskEnabled: boolean;
  primaryAmId: string;
  backupAmId: string;
  amsSystem: string;
  amsSystemOther: string;
  deskInstructions: string;
  credentialVaultRef: string;
  planId: string;
  startsOn: string;
  price: string;
  managedAccounts: string;
  notes: string;
  overrides: Record<ServiceCategory, OverrideChoice>;
}

function toForm(s: AgencySetupView): FormState {
  const overrides = Object.fromEntries(CATEGORIES.map((c) => {
    const row = s.plan?.overrides.find((o) => o.category === c);
    const choice: OverrideChoice = !row ? { mode: 'plan', units: '' }
      : row.monthlyUnits === null ? { mode: 'unlimited', units: '' }
      : { mode: 'units', units: String(row.monthlyUnits) };
    return [c, choice];
  })) as Record<ServiceCategory, OverrideChoice>;
  return {
    deskEnabled: s.deskEnabled,
    primaryAmId: s.primaryAm?.id ?? '',
    backupAmId: s.backupAm?.id ?? '',
    amsSystem: s.amsSystem ?? '',
    amsSystemOther: s.amsSystemOther ?? '',
    deskInstructions: s.deskInstructions ?? '',
    credentialVaultRef: s.credentialVaultRef ?? '',
    planId: s.plan?.planId ?? '',
    startsOn: s.plan?.startsOn ?? today(),
    price: s.plan?.monthlyPriceCents != null ? String(s.plan.monthlyPriceCents / 100) : '',
    managedAccounts: s.plan?.managedAccountsOverride != null ? String(s.plan.managedAccountsOverride) : '',
    notes: s.plan?.notes ?? '',
    overrides,
  };
}

const numberOrNull = (text: string) => (text.trim() === '' ? null : Number(text));

function toPayload(f: FormState, version: string, confirmDisable: boolean) {
  const price = numberOrNull(f.price);
  return {
    version,
    confirmDisable,
    deskEnabled: f.deskEnabled,
    primaryAmId: f.primaryAmId || null,
    backupAmId: f.backupAmId || null,
    amsSystem: (f.amsSystem || null) as AmsSystem | null,
    amsSystemOther: f.amsSystemOther,
    deskInstructions: f.deskInstructions,
    credentialVaultRef: f.credentialVaultRef,
    plan: f.planId ? {
      planId: f.planId,
      startsOn: f.startsOn,
      monthlyPriceCents: price === null ? null : Math.round(price * 100),
      managedAccountsOverride: numberOrNull(f.managedAccounts),
      notes: f.notes,
      overrides: CATEGORIES.filter((c) => f.overrides[c].mode !== 'plan').map((c) => ({
        category: c,
        monthlyUnits: f.overrides[c].mode === 'unlimited' ? null : numberOrNull(f.overrides[c].units) ?? 0,
      })),
    } : null,
  };
}

export function AgencySetupForm({ agencyId }: { agencyId: string }) {
  const [setup, setSetup] = useState<AgencySetupView | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<string[] | null>(null);

  const load = (s: AgencySetupView) => { setSetup(s); setForm(toForm(s)); };

  useEffect(() => {
    fetch(`/api/desk/admin/agencies/${agencyId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        load(data.setup);
      })
      .catch((err) => setLoadError(err.message || 'Could not load this agency.'));
  }, [agencyId]);

  const back = (
    <Link href="/super-admin/desk/agencies" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-4">
      <ArrowLeft className="w-4 h-4" /> All agencies
    </Link>
  );

  if (loadError) return <div>{back}<p className="text-sm text-red-600" role="alert" data-testid="desk-setup-load-error">{loadError}</p></div>;
  if (!setup || !form) return <p className="text-sm text-slate-500">Loading…</p>;

  const update = (patch: Partial<FormState>) => { setForm({ ...form, ...patch }); setSaved(null); };
  const plan = setup.options.plans.find((p) => p.id === form.planId);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved(null);
    let confirmDisable = false;
    if (setup.deskEnabled && !form.deskEnabled && setup.counts.openTasks > 0) {
      const n = setup.counts.openTasks;
      confirmDisable = window.confirm(`${setup.name} has ${n} open request${n === 1 ? '' : 's'}. Turning The Desk off removes them from every Desk queue until it is turned back on. Continue?`);
      if (!confirmDisable) return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/desk/admin/agencies/${agencyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPayload(form, setup.version, confirmDisable)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      load(data.setup);
      setSaved(data.notices ?? []);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const managerOptions = (exclude: string) => setup.options.accountManagers
    .filter((m) => m.id !== exclude)
    .map((m) => <option key={m.id} value={m.id}>{m.name}{m.isActive ? '' : ' (inactive)'}</option>);

  return (
    <form onSubmit={save} data-testid="desk-setup-form">
      {back}
      <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--brand-primary, #05314c)' }} data-testid="page-title">{setup.name}</h1>
      <p className="text-sm text-slate-500 mb-6">Desk setup for this agency.</p>

      <section className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={form.deskEnabled} onChange={(e) => update({ deskEnabled: e.target.checked })} data-testid="desk-enabled-toggle" />
          <span>
            <span className="block text-sm font-semibold text-slate-800">The Desk is on for this agency</span>
            <span className="block text-xs text-slate-500">
              {setup.deskEnabled && setup.deskEnabledAt
                ? `On since ${new Date(setup.deskEnabledAt).toLocaleDateString('en-US')}. `
                : ''}
              {setup.counts.openTasks} open request{setup.counts.openTasks === 1 ? '' : 's'}.
            </span>
          </span>
        </label>
        <ul className="mt-4 grid sm:grid-cols-2 gap-2" data-testid="desk-checklist">
          {setup.checklist.map((item) => (
            <li key={item.key} className={`flex items-center gap-2 text-sm ${item.done ? 'text-slate-700' : 'text-amber-700'}`}>
              {item.done ? <Check className="w-4 h-4 text-emerald-600" /> : <Circle className="w-4 h-4" />}
              {item.label}
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Account Managers</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL} htmlFor="primaryAm">Primary</label>
            <select id="primaryAm" className={INPUT} value={form.primaryAmId} onChange={(e) => update({ primaryAmId: e.target.value })} data-testid="desk-primary-am">
              <option value="">Not assigned</option>
              {managerOptions(form.backupAmId)}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="backupAm">Backup</label>
            <select id="backupAm" className={INPUT} value={form.backupAmId} onChange={(e) => update({ backupAmId: e.target.value })} data-testid="desk-backup-am">
              <option value="">None</option>
              {managerOptions(form.primaryAmId)}
            </select>
          </div>
        </div>
        {setup.options.accountManagers.length === 0 && <p className="text-xs text-amber-700 mt-2">No active Account Managers exist yet.</p>}
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Agency profile</h2>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={LABEL} htmlFor="ams">AMS</label>
            <select id="ams" className={INPUT} value={form.amsSystem} onChange={(e) => update({ amsSystem: e.target.value })} data-testid="desk-ams">
              <option value="">Not recorded</option>
              {(Object.keys(AMS_SYSTEM_LABELS) as AmsSystem[]).map((k) => <option key={k} value={k}>{AMS_SYSTEM_LABELS[k]}</option>)}
            </select>
          </div>
          {form.amsSystem === 'OTHER' && (
            <div>
              <label className={LABEL} htmlFor="amsOther">AMS name</label>
              <input id="amsOther" className={INPUT} maxLength={100} value={form.amsSystemOther} onChange={(e) => update({ amsSystemOther: e.target.value })} data-testid="desk-ams-other" />
            </div>
          )}
        </div>
        <div className="mb-4">
          <label className={LABEL} htmlFor="instructions">Instructions for Desk staff</label>
          <textarea id="instructions" rows={5} className={INPUT} maxLength={5000} value={form.deskInstructions} onChange={(e) => update({ deskInstructions: e.target.value })} data-testid="desk-instructions" />
        </div>
        <div>
          <label className={LABEL} htmlFor="vault">Where the logins are kept</label>
          <input id="vault" className={INPUT} maxLength={300} placeholder="e.g. 1Password › Desk › Acme Insurance" value={form.credentialVaultRef} onChange={(e) => update({ credentialVaultRef: e.target.value })} data-testid="desk-vault" />
          <p className="text-xs text-slate-500 mt-1">The location in the password manager only. Passwords are never stored in The Desk, here or in the instructions.</p>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Plan</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL} htmlFor="plan">Plan</label>
            <select id="plan" className={INPUT} value={form.planId} onChange={(e) => update({ planId: e.target.value })} data-testid="desk-plan">
              <option value="">No plan</option>
              {setup.options.plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}: {p.priceIsStartingAt ? 'from ' : ''}{money(p.monthlyPriceCents)}{p.isActive ? '' : ' (no longer offered)'}</option>
              ))}
            </select>
          </div>
          {plan && (
            <>
              <div>
                <label className={LABEL} htmlFor="startsOn">Starts on</label>
                <input id="startsOn" type="date" className={INPUT} value={form.startsOn} onChange={(e) => update({ startsOn: e.target.value })} data-testid="desk-plan-start" />
              </div>
              <div>
                <label className={LABEL} htmlFor="price">{plan.priceIsStartingAt ? 'Agreed monthly price ($)' : 'Negotiated monthly price ($, optional)'}</label>
                <input id="price" type="number" min="0" step="0.01" className={INPUT} value={form.price} onChange={(e) => update({ price: e.target.value })} data-testid="desk-plan-price" />
              </div>
              <div>
                <label className={LABEL} htmlFor="accounts">Managed accounts override (optional)</label>
                <input id="accounts" type="number" min="0" step="1" className={INPUT} placeholder={plan.managedAccounts === null ? 'Not set on the plan' : `Plan: ${plan.managedAccounts}`} value={form.managedAccounts} onChange={(e) => update({ managedAccounts: e.target.value })} data-testid="desk-plan-accounts" />
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL} htmlFor="notes">Notes</label>
                <input id="notes" className={INPUT} maxLength={1000} value={form.notes} onChange={(e) => update({ notes: e.target.value })} data-testid="desk-plan-notes" />
              </div>
            </>
          )}
        </div>

        {plan && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-1">Monthly allowances</h3>
            <p className="text-xs text-slate-500 mb-3">An agency setting replaces the plan&apos;s allowance for that service. Until an allowance is set, completed work stays unclassified for billing.</p>
            <div className="space-y-2">
              {CATEGORIES.map((c) => {
                const choice = form.overrides[c];
                const fromPlan = plan.allowances.find((a) => a.category === c);
                const planText = !fromPlan ? 'not set' : fromPlan.monthlyUnits === null ? 'unlimited' : String(fromPlan.monthlyUnits);
                const setChoice = (patch: Partial<OverrideChoice>) => update({ overrides: { ...form.overrides, [c]: { ...choice, ...patch } } });
                return (
                  <div key={c} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                    <span className="text-sm text-slate-700">{SERVICE_CATEGORY_LABELS[c]}</span>
                    <select aria-label={`${SERVICE_CATEGORY_LABELS[c]} allowance`} className={INPUT} value={choice.mode} onChange={(e) => setChoice({ mode: e.target.value as OverrideChoice['mode'] })} data-testid={`desk-override-${c}`}>
                      <option value="plan">Plan ({planText})</option>
                      <option value="units">Set for this agency</option>
                      <option value="unlimited">Unlimited</option>
                    </select>
                    {choice.mode === 'units' && (
                      <input aria-label={`${SERVICE_CATEGORY_LABELS[c]} units per month`} type="number" min="0" step="1" required className={INPUT} placeholder="Units per month" value={choice.units} onChange={(e) => setChoice({ units: e.target.value })} data-testid={`desk-override-units-${c}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {setup.counts.pendingBilling > 0 && (
          <p className="text-xs text-amber-700 mt-4">{setup.counts.pendingBilling} completed request{setup.counts.pendingBilling === 1 ? ' is' : 's are'} waiting to be classified for billing.</p>
        )}
      </section>

      {error && <p className="text-sm text-red-600 mb-3" role="alert" data-testid="desk-setup-error">{error}</p>}
      {saved && (
        <div className="text-sm text-emerald-700 mb-3" role="status" data-testid="desk-setup-saved">
          <p>Saved.</p>
          {saved.map((n) => <p key={n} className="text-amber-700">{n}</p>)}
        </div>
      )}
      <button
        type="submit" disabled={saving} data-testid="desk-setup-save"
        className="px-5 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
        style={{ backgroundColor: 'var(--brand-primary, #05314c)' }}
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
