'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '../layout';

interface Rule {
  coverageName: string;
  isCustom: boolean;
  enabled: boolean;
  defaultExplanation: string;
  agentExplanation: string;
  customLevel: string;
  customReason: string;
}

const LEVEL_LABEL: Record<string, string> = {
  STRONGLY_RECOMMENDED: 'Strongly Recommended',
  RECOMMENDED: 'Recommended',
  CONSIDER: 'Consider',
  NOT_TYPICALLY_NEEDED: 'Not Typically Needed',
};

/**
 * Super-admin editor for coverage rules. Lets non-developers enable/disable
 * coverages, override the plain-English explanation, and add custom coverages.
 * The engine's conditional level logic stays in code.
 */
export default function CoverageRulesPage() {
  const { authFetch } = useAdminAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/super-admin/coverage-rules');
      const json = await res.json();
      if (res.ok) {
        setRules(json.rules || []);
        setLevels(json.levels || []);
      }
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  const update = (i: number, patch: Partial<Rule>) =>
    setRules((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addCustom = () => {
    const name = newName.trim();
    if (!name || rules.some((r) => r.coverageName.toLowerCase() === name.toLowerCase())) return;
    setRules((prev) => [
      ...prev,
      { coverageName: name, isCustom: true, enabled: true, defaultExplanation: '', agentExplanation: '', customLevel: 'CONSIDER', customReason: '' },
    ]);
    setNewName('');
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await authFetch('/api/super-admin/coverage-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      setMsg(res.ok ? 'Saved.' : 'Save failed.');
      if (res.ok) load();
    } catch {
      setMsg('Network error.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#0D2137]">Coverage Rules</h1>
            <p className="text-sm text-gray-500 mt-1">Enable/disable coverages, override explanations, add custom coverages.</p>
          </div>
          <Link href="/super-admin" className="text-sm text-gray-500 hover:text-[#0D2137]">← Back</Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : (
          <>
            <div className="space-y-3">
              {rules.map((r, i) => (
                <div key={r.coverageName} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#0D2137]">{r.coverageName}</span>
                      {r.isCustom && <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">Custom</span>}
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" checked={r.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
                      Enabled
                    </label>
                  </div>

                  <label className="text-xs uppercase font-bold text-gray-400 block mb-1">
                    Explanation {r.isCustom ? '' : '(override — leave blank to use default)'}
                  </label>
                  <textarea
                    value={r.agentExplanation}
                    onChange={(e) => update(i, { agentExplanation: e.target.value })}
                    rows={2}
                    placeholder={r.defaultExplanation || 'Plain-English explanation for the insured…'}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
                  />

                  {r.isCustom && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="text-xs uppercase font-bold text-gray-400 block mb-1">Default Level</label>
                        <select value={r.customLevel} onChange={(e) => update(i, { customLevel: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                          {levels.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l] || l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs uppercase font-bold text-gray-400 block mb-1">Reason</label>
                        <input value={r.customReason} onChange={(e) => update(i, { customReason: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 mt-4 flex items-center gap-2 flex-wrap">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New custom coverage name…" className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <button onClick={addCustom} disabled={!newName.trim()} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm disabled:opacity-50">+ Add Custom Coverage</button>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              {msg && <span className="text-sm text-gray-500">{msg}</span>}
              <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg bg-[#1D9E75] text-white text-sm font-medium disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Rules'}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
