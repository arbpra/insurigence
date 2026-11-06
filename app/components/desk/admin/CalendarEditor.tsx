'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { getCalendarSetup } from '@/lib/desk/calendar-admin';

type Setup = Awaited<ReturnType<typeof getCalendarSetup>>;

const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const LABEL = 'block text-sm font-medium text-slate-700 mb-1';
const ACTION = 'text-xs font-medium text-slate-600 hover:text-slate-900 underline disabled:opacity-50';
const PRIMARY = { backgroundColor: 'var(--brand-primary, #05314c)' };
const CARD = 'bg-white border border-slate-200 rounded-xl p-5 mb-5';
const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];

const toTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const toMinute = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

/** Time zone, working days, business hours and holidays. */
export function CalendarEditor() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [form, setForm] = useState({ timeZone: '', workDays: [] as number[], start: '09:00', end: '17:00' });
  const [holiday, setHoliday] = useState({ date: '', name: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = useCallback((s: Setup) => {
    setSetup(s);
    setForm({ timeZone: s.timeZone, workDays: s.workDays, start: toTime(s.dayStartMinute), end: toTime(s.dayEndMinute) });
  }, []);

  const reload = useCallback(async () => apply(await api<Setup>('/api/desk/admin/calendar')), [apply]);
  useEffect(() => { reload().catch((err) => setError(err.message)); }, [reload]);

  const zones = useMemo(() => {
    const list = Intl.supportedValuesOf('timeZone');
    return form.timeZone && !list.includes(form.timeZone) ? [form.timeZone, ...list] : list;
  }, [form.timeZone]);

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const message = await action();
      if (message) setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (!setup) return error ? <p className="text-sm text-red-600" role="alert">{error}</p> : <p className="text-sm text-slate-500">Loading…</p>;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<{ changed: boolean; setup: Setup }>('/api/desk/admin/calendar', {
        method: 'PUT',
        body: JSON.stringify({ version: setup.version ?? undefined, timeZone: form.timeZone, workDays: form.workDays, dayStartMinute: toMinute(form.start), dayEndMinute: toMinute(form.end) }),
      });
      apply(r.setup);
      return r.changed ? 'Saved. New due dates use this calendar; open requests keep the dates they have.' : 'No changes to save.';
    });
  };

  const years = [...new Set(setup.holidays.map((h) => h.date.slice(0, 4)))];

  return (
    <div data-testid="desk-calendar">
      <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--brand-primary, #05314c)' }} data-testid="page-title">Business calendar</h1>
      <p className="text-sm text-slate-500 mb-5">Business hours, time zone and holidays used for every service-level target.</p>

      {error && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-calendar-error">{error}</p>}
      {notice && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" role="status" data-testid="desk-calendar-notice">{notice}</p>}

      <form onSubmit={save} className={CARD} data-testid="desk-calendar-form">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Business hours</h2>
        <div className="grid sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className={LABEL} htmlFor="calZone">Time zone</label>
            <select id="calZone" className={INPUT} value={form.timeZone} onChange={(e) => setForm({ ...form, timeZone: e.target.value })} data-testid="desk-calendar-zone">
              {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="calStart">Opens</label>
            <input id="calStart" type="time" required className={INPUT} value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} data-testid="desk-calendar-start" />
          </div>
          <div>
            <label className={LABEL} htmlFor="calEnd">Closes</label>
            <input id="calEnd" type="time" required className={INPUT} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} data-testid="desk-calendar-end" />
          </div>
        </div>
        <fieldset className="mb-4">
          <legend className={LABEL}>Working days</legend>
          <div className="flex flex-wrap gap-3">
            {DAYS.map(([d, label]) => (
              <label key={d} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox" checked={form.workDays.includes(d)} data-testid={`desk-calendar-day-${d}`}
                  onChange={(e) => setForm({ ...form, workDays: e.target.checked ? [...form.workDays, d] : form.workDays.filter((x) => x !== d) })}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={busy} className="px-5 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={PRIMARY} data-testid="desk-calendar-save">Save calendar</button>

        <div className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600" data-testid="desk-calendar-examples">
          <p className="font-medium text-slate-700 mb-1">With the saved calendar, a request made now ({setup.examples.now}):</p>
          <p>Clock starts: {setup.examples.clockStarts}</p>
          <p>A 4-hour target is due: {setup.examples.fourHours}</p>
          <p>A 1-day target is due: {setup.examples.oneDay}</p>
        </div>
      </form>

      <section className={CARD}>
        <h2 className="text-base font-semibold text-slate-800 mb-1">Holidays</h2>
        <p className="text-xs text-slate-500 mb-4">These days never count toward a target. Enter the date the Desk actually closes, such as the observed date.</p>
        {setup.holidaysRunningOut && (
          <p className="text-sm text-amber-700 mb-4" role="status" data-testid="desk-calendar-runout">
            {setup.lastHoliday ? `The list ends on ${setup.lastHoliday}.` : 'There are no holidays.'} Add next year&apos;s dates, or those days will count as worked.
          </p>
        )}

        <form
          className="grid sm:grid-cols-[10rem_1fr_auto] gap-2 mb-4" data-testid="desk-holiday-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api('/api/desk/admin/calendar/holidays', { method: 'POST', body: JSON.stringify(holiday) });
              setHoliday({ date: '', name: '' });
              await reload();
            });
          }}
        >
          <input aria-label="Holiday date" type="date" required className={INPUT} value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} data-testid="desk-holiday-date" />
          <input aria-label="Holiday name" required maxLength={100} placeholder="Holiday name" className={INPUT} value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} data-testid="desk-holiday-name" />
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={PRIMARY} data-testid="desk-holiday-add">Add</button>
        </form>

        {years.map((year) => (
          <div key={year} className="mb-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-1">{year}</h3>
            <ul className="divide-y divide-slate-100">
              {setup.holidays.filter((h) => h.date.startsWith(year)).map((h) => (
                <li key={h.id} className="py-1.5 flex items-center justify-between gap-3 text-sm" data-testid="desk-holiday">
                  <span className="text-slate-700"><span className="font-mono text-xs text-slate-500 mr-2">{h.date}</span>{h.name}</span>
                  <button
                    className={ACTION} disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Remove ${h.name} (${h.date})? That day will count as a normal working day for new due dates.`)) return;
                      run(async () => { await api(`/api/desk/admin/calendar/holidays?id=${h.id}`, { method: 'DELETE' }); await reload(); });
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
