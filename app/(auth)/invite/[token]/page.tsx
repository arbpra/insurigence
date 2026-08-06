'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import Logo from '@/app/components/Logo';

/**
 * Accept a team invite: the invitee sets their own password via a single-use,
 * expiring link. No password is ever sent by email.
 */
export default function AcceptInvitePage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;

  const [state, setState] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [info, setInfo] = useState<{ email: string; firstName: string | null; agencyName: string | null } | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const validate = useCallback(async () => {
    try {
      const res = await fetch(`/api/auth/accept-invite?token=${encodeURIComponent(token)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'This invite link is invalid.');
        setState('invalid');
        return;
      }
      setInfo({ email: json.email, firstName: json.firstName, agencyName: json.agencyName });
      setState('valid');
    } catch {
      setError('Could not verify this invite link.');
      setState('invalid');
    }
  }, [token]);

  useEffect(() => { validate(); }, [validate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');

    setBusy(true);
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not accept the invite.');
        setBusy(false);
        return;
      }
      router.replace('/dashboard');
    } catch {
      setError('An error occurred. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#F5F7FA' }}>
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo size="md" />
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-8">
          {state === 'checking' && (
            <p className="text-center text-sm text-slate-500">Verifying your invite…</p>
          )}

          {state === 'invalid' && (
            <div className="text-center">
              <h1 className="text-xl font-bold mb-2" style={{ color: '#0D2137' }}>Invite unavailable</h1>
              <p className="text-sm text-slate-500 mb-6">{error}</p>
              <Link href="/login" className="text-sm font-medium" style={{ color: '#00B383' }}>
                Go to sign in
              </Link>
            </div>
          )}

          {state === 'valid' && info && (
            <>
              <h1 className="text-xl font-bold mb-1 text-center" style={{ color: '#0D2137' }}>
                Welcome{info.firstName ? `, ${info.firstName}` : ''}
              </h1>
              <p className="text-sm text-center text-slate-500 mb-6">
                {info.agencyName ? <>You&apos;ve been invited to join <strong>{info.agencyName}</strong>. </> : null}
                Set a password to activate your account.
              </p>

              <p className="text-xs text-slate-400 mb-4 text-center">{info.email}</p>

              {error && (
                <div className="mb-4 p-3 rounded-lg text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                  {error}
                </div>
              )}

              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>Password</label>
                  <div className="relative">
                    <input
                      type={show ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-4 py-2.5 pr-11 rounded-lg border border-gray-300 focus:outline-none focus:ring-2"
                      style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                      placeholder="Create a password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      data-testid="input-invite-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      aria-label={show ? 'Hide password' : 'Show password'}
                    >
                      {show ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>Confirm Password</label>
                  <input
                    type={show ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                    placeholder="Re-enter your password"
                    required
                    autoComplete="new-password"
                    data-testid="input-invite-confirm"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-3 rounded-lg font-semibold transition-all hover:opacity-90 disabled:opacity-50 border-2"
                  style={{ backgroundColor: '#00E9B0', borderColor: '#00E9B0', color: '#07496c' }}
                  data-testid="button-accept-invite"
                >
                  {busy ? 'Activating…' : 'Activate Account'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
