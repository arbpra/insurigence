'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Logo from '@/app/components/Logo';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam === 'not_invited') {
      setError('Access denied. Your account has not been set up yet. Please contact your administrator to get access.');
    } else if (errorParam === 'auth_failed') {
      setError('Authentication failed. Please try again.');
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Login failed');
        setIsLoading(false);
        return;
      }

      if (data.user.mustChangePassword) {
        router.push('/change-password');
      } else if (data.user.role === 'SUPER_ADMIN') {
        router.push('/super-admin');
      } else {
        router.push('/dashboard');
      }
    } catch {
      setError('An error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#F5F7FA' }}>
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-12" style={{ backgroundColor: '#0D2137' }}>
        <div className="max-w-md">
          <div className="mb-8">
            <Logo size="lg" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">
            Insurance Placement Intelligence
          </h1>
          <p className="text-xl text-white/80">
            Make confident placement decisions faster with market insights, carrier matching, and professional proposals.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 text-center">
            <Logo size="md" />
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8">
            <h2 className="text-2xl font-bold mb-2" style={{ color: '#0D2137' }}>
              Welcome back
            </h2>
            <p className="text-gray-500 mb-6">
              Sign in to access your dashboard
            </p>

            {error && (
              <div 
                className="mb-4 p-4 rounded-lg text-sm"
                style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}
                data-testid="login-error"
              >
                {error}
              </div>
            )}

            <a
              href="/api/login"
              className="w-full py-3 px-4 rounded-lg font-semibold text-white transition-all duration-200 hover:opacity-90 flex items-center justify-center gap-2 mb-6"
              style={{ backgroundColor: '#00E6A7' }}
              data-testid="button-replit-login"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
              Sign in with Replit
            </a>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-3 bg-white text-gray-500">Or sign in with email</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label 
                  htmlFor="email" 
                  className="block text-sm font-medium mb-2"
                  style={{ color: '#374151' }}
                >
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': '#00E6A7' } as React.CSSProperties}
                  placeholder="you@company.com"
                  required
                  autoComplete="email"
                  data-testid="input-email"
                />
              </div>

              <div>
                <label 
                  htmlFor="password" 
                  className="block text-sm font-medium mb-2"
                  style={{ color: '#374151' }}
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2"
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  data-testid="input-password"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 rounded-lg font-semibold transition-all duration-200 hover:opacity-90 disabled:opacity-50 border-2"
                style={{ backgroundColor: 'transparent', borderColor: '#0D2137', color: '#0D2137' }}
                data-testid="button-login"
              >
                {isLoading ? 'Signing in...' : 'Sign In with Email'}
              </button>
            </form>
          </div>

          <p className="text-center text-sm text-gray-500 mt-6">
            Need access? Contact your administrator.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#00E6A7' }}></div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
