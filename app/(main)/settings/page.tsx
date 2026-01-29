'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { PageHeader, StatCard, Button } from '@/components/ui';

interface AgencySettings {
  id: string;
  name: string;
  riskTolerance: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  allowedMarkets: string[];
  esRecommendationsEnabled: boolean;
  placementNotes: string | null;
  subscriptionTier: 'SOLO' | 'GROWTH' | 'MULTI_LOCATION';
  status: 'ACTIVE' | 'PAUSED';
}

const toleranceDescriptions: Record<string, string> = {
  CONSERVATIVE: 'Prefer standard markets. Only recommend E&S when absolutely necessary.',
  BALANCED: 'Consider both standard and E&S markets based on risk characteristics.',
  AGGRESSIVE: 'Willing to explore E&S markets for competitive placement opportunities.',
};

const tierLabels: Record<string, string> = {
  SOLO: 'Solo',
  GROWTH: 'Growth',
  MULTI_LOCATION: 'Multi-Location',
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AgencySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [form, setForm] = useState({
    riskTolerance: 'BALANCED' as 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE',
    esRecommendationsEnabled: true,
    placementNotes: '',
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/agency/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data.agency);
        setForm({
          riskTolerance: data.agency.riskTolerance || 'BALANCED',
          esRecommendationsEnabled: data.agency.esRecommendationsEnabled !== false,
          placementNotes: data.agency.placementNotes || '',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/agency/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.agency);
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), 3000);
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--brand-primary)' }}></div>
            <p style={{ color: 'var(--brand-text-muted)' }} className="text-sm font-medium">Loading settings...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!settings) {
    return (
      <AppLayout>
        <div className="bg-white rounded-xl border border-slate-200 p-8 max-w-md mx-auto text-center">
          <h1 className="text-xl font-semibold text-slate-900 mb-2">Settings Not Available</h1>
          <p className="text-slate-500 mb-4">Agency configuration is not set up.</p>
          <Button href="/dashboard" variant="secondary">Back to Dashboard</Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Agency Settings"
        subtitle={settings.name}
        actions={
          <Button
            variant="primary"
            onClick={saveSettings}
            loading={isSaving}
            testId="button-save"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            }
          >
            Save Settings
          </Button>
        }
      />

      {showSaved && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-emerald-800">Settings saved successfully!</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Subscription Tier"
          value={tierLabels[settings.subscriptionTier]}
          variant="default"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
            </svg>
          }
        />
        <StatCard
          label="Status"
          value={settings.status === 'ACTIVE' ? 'Active' : 'Paused'}
          variant={settings.status === 'ACTIVE' ? 'standard' : 'es'}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500 mb-2">Allowed Markets</p>
          <div className="flex gap-2">
            {settings.allowedMarkets.map(market => (
              <span 
                key={market}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                  market === 'standard' 
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}
              >
                {market === 'standard' ? 'Standard' : 'E&S'}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm">
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--brand-primary)' }}>Placement Preferences</h2>
          <p className="text-sm text-slate-500 mt-1">Configure how the system evaluates and recommends market placements.</p>
        </div>
        
        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3">Risk Tolerance</label>
            <div className="space-y-3">
              {(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'] as const).map((level) => (
                <label 
                  key={level}
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    form.riskTolerance === level 
                      ? 'border-[#00E6A7] bg-[#00E6A708]' 
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="riskTolerance"
                    value={level}
                    checked={form.riskTolerance === level}
                    onChange={(e) => setForm({ ...form, riskTolerance: e.target.value as typeof level })}
                    className="mt-1 w-4 h-4 text-[#00E6A7] focus:ring-[#00E6A7]"
                    data-testid={`radio-${level.toLowerCase()}`}
                  />
                  <div>
                    <p className="font-medium text-slate-900">{level.charAt(0) + level.slice(1).toLowerCase()}</p>
                    <p className="text-sm text-slate-500">{toleranceDescriptions[level]}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.esRecommendationsEnabled}
                onChange={(e) => setForm({ ...form, esRecommendationsEnabled: e.target.checked })}
                className="mt-1 w-4 h-4 rounded border-slate-300 text-[#00E6A7] focus:ring-[#00E6A7]"
                data-testid="checkbox-es-recommendations"
              />
              <div>
                <p className="font-medium text-slate-900">Enable E&S Recommendations</p>
                <p className="text-sm text-slate-500">
                  When enabled, the system will include E&S (Excess & Surplus) carriers in market recommendations 
                  for risks that may not fit standard markets.
                </p>
              </div>
            </label>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <label className="block text-sm font-medium text-slate-700 mb-2">Internal Placement Notes</label>
            <textarea
              value={form.placementNotes}
              onChange={(e) => setForm({ ...form, placementNotes: e.target.value })}
              placeholder="Add notes about your placement preferences, preferred carriers, or special instructions for your team..."
              rows={5}
              className="w-full px-4 py-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7] resize-none"
              data-testid="textarea-notes"
            />
            <p className="text-xs text-slate-500 mt-2">These notes are visible only to your agency and will not be shared with clients.</p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
