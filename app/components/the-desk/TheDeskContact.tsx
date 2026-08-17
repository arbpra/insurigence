'use client';

import { useState } from 'react';

const HELP_OPTIONS = ['Renewals', 'Endorsements', 'COI Requests', 'New Business Support', 'All of the above'];

/**
 * "Ready to Hand Off the Back Office?" contact form for The Desk page.
 * Sends both the admin notification and the sender confirmation via /api/contact.
 * Phone and the selected "help with" options are folded into the message body,
 * since /api/contact accepts name, email, company, and message.
 */
export default function TheDeskContact() {
  const [form, setForm] = useState({ name: '', agency: '', email: '', phone: '', message: '' });
  const [help, setHelp] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const toggleHelp = (opt: string) =>
    setHelp((prev) => (prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.email.trim()) {
      setError('Please enter your name and email.');
      return;
    }
    const messageParts = [
      form.message.trim(),
      form.phone.trim() ? `Phone: ${form.phone.trim()}` : '',
      help.length ? `Needs help with: ${help.join(', ')}` : '',
    ].filter(Boolean);

    setStatus('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          company: form.agency,
          message: messageParts.join('\n\n') || 'The Desk enquiry',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not send your message. Please try again.');
        setStatus('idle');
        return;
      }
      setStatus('sent');
      setForm({ name: '', agency: '', email: '', phone: '', message: '' });
      setHelp([]);
    } catch {
      setError('Network error. Please try again.');
      setStatus('idle');
    }
  };

  const inputCls =
    'w-full px-4 py-2.5 rounded-md border border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2';
  const ring = { ['--tw-ring-color' as string]: '#00E6A7' } as React.CSSProperties;

  if (status === 'sent') {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-10 text-center h-full flex flex-col justify-center" data-testid="thedesk-contact-success">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#DCFCE7' }}>
          <svg className="w-7 h-7" style={{ color: '#16A34A' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-lg sm:text-xl font-medium mb-2" style={{ color: '#07496c' }}>Thanks — message sent!</h3>
        <p className="text-sm sm:text-base text-gray-600 leading-relaxed mb-5">We&apos;ll be in touch within one business day. A confirmation is on its way to your inbox.</p>
        <button onClick={() => setStatus('idle')} className="text-sm font-medium" style={{ color: '#00B383' }}>Send another message</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm p-6 sm:p-8" data-testid="thedesk-contact-form">
      {error && (
        <div className="mb-4 rounded-md px-4 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>Your Name</label>
          <input value={form.name} onChange={set('name')} placeholder="Full name" required className={inputCls} style={ring} data-testid="input-name" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>Agency Name</label>
          <input value={form.agency} onChange={set('agency')} placeholder="Your agency name" className={inputCls} style={ring} data-testid="input-agency" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>Email Address</label>
          <input type="email" value={form.email} onChange={set('email')} placeholder="you@agency.com" required className={inputCls} style={ring} data-testid="input-email" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>Phone</label>
          <input value={form.phone} onChange={set('phone')} placeholder="(555) 000-0000" className={inputCls} style={ring} data-testid="input-phone" />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2" style={{ color: '#07496c' }}>What do you need help with?</label>
        <div className="flex flex-wrap gap-2">
          {HELP_OPTIONS.map((opt) => {
            const active = help.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggleHelp(opt)}
                className="px-3.5 py-1.5 rounded-full text-sm border transition-colors"
                style={
                  active
                    ? { backgroundColor: '#00E6A7', borderColor: '#00E6A7', color: '#05314C' }
                    : { backgroundColor: '#fff', borderColor: '#e2e8f0', color: '#475569' }
                }
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-5">
        <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>
          Anything else we should know? <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <textarea value={form.message} onChange={set('message')} rows={4} placeholder="Tell us about your agency, current challenges, or anything else that would help us prep for your call." className={`${inputCls} resize-y`} style={ring} data-testid="input-message" />
      </div>

      <button
        type="submit"
        disabled={status === 'sending'}
        className="px-6 py-2.5 rounded-md font-semibold transition-all hover:opacity-90 disabled:opacity-60"
        style={{ backgroundColor: '#00E6A7', color: '#05314C' }}
        data-testid="button-submit"
      >
        {status === 'sending' ? 'Sending…' : 'Send Message'}
      </button>
    </form>
  );
}
