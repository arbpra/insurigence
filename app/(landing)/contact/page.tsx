'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * Public contact form. On submit, sends a notification to the team and a
 * confirmation to the sender (both via Resend).
 */
export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', company: '', message: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStatus('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not send your message.');
        setStatus('idle');
        return;
      }
      setStatus('sent');
    } catch {
      setError('Network error. Please try again.');
      setStatus('idle');
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 py-16" style={{ backgroundColor: '#F5F7FA' }}>
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: '#07496c' }}>Contact Us</h1>
          <p className="text-slate-500">Have a question? Send us a message and we&apos;ll get back to you.</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          {status === 'sent' ? (
            <div className="text-center py-6" data-testid="contact-success">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#DCFCE7' }}>
                <svg className="w-7 h-7" style={{ color: '#16A34A' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold mb-2" style={{ color: '#07496c' }}>Message sent!</h2>
              <p className="text-sm text-slate-500 mb-6">
                Thanks for reaching out — a confirmation has been sent to your email, and our team will be in touch.
              </p>
              <button
                onClick={() => { setForm({ name: '', email: '', company: '', message: '' }); setStatus('idle'); }}
                className="text-sm font-medium"
                style={{ color: '#00B383' }}
              >
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>Name</label>
                <input value={form.name} onChange={set('name')} required
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                  placeholder="Your name" data-testid="input-name" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>Email</label>
                <input type="email" value={form.email} onChange={set('email')} required
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                  placeholder="you@company.com" data-testid="input-email" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>Company <span className="text-slate-400 font-normal">(optional)</span></label>
                <input value={form.company} onChange={set('company')}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                  placeholder="Your agency" data-testid="input-company" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>Message</label>
                <textarea value={form.message} onChange={set('message')} required rows={5} maxLength={5000}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 resize-y"
                  style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                  placeholder="How can we help?" data-testid="input-message" />
              </div>

              <button type="submit" disabled={status === 'sending'}
                className="w-full py-3 rounded-lg font-semibold transition-all hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#00E9B0', color: '#07496c' }}
                data-testid="button-submit-contact">
                {status === 'sending' ? 'Sending…' : 'Send Message'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-slate-400 mt-6">
          <Link href="/" className="hover:text-slate-600">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
