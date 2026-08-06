'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import Logo from '@/app/components/Logo';
import signinBanner from '@/attached_assets/bgSignin.webp';

const container = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const fadeUp = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1 },
};

const items = [
  { title: 'Collaborate', content: 'Work seamlessly with your team' },
  { title: 'Track & Grow', content: 'Monitor performance and close more deals' },
  { title: 'Stay Protected', content: 'Enterprise-grade security you can trust' },
];

const labelStyle = { color: '#07496c' };

/**
 * Agency self-signup. Creates a new agency workspace and its first user (agency
 * admin), then signs them straight in.
 */
export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    agencyName: '',
    password: '',
    confirmPassword: '',
  });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!acceptedTerms) {
      setError('Please agree to the Terms of Services and Privacy Policy.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, acceptedTerms }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Signup failed.');
        setIsLoading(false);
        return;
      }
      router.replace('/dashboard');
    } catch {
      setError('An error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#ffffff' }}>
      {/* ── Left banner ── */}
      <div
        className="hidden lg:flex lg:w-3/5 flex-col min-h-screen px-10"
        style={{
          backgroundImage: `url(${signinBanner.src})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <motion.div
          className="relative flex flex-col h-full max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-left"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: false, amount: 0.4 }}
          variants={container}
        >
          <motion.h1
            variants={fadeUp}
            className="text-3xl sm:text-3xl md:text-4xl lg:text-4xl font-normal tracking-tight leading-tight mb-6"
            style={{ fontFamily: 'Helvetica', letterSpacing: '-0.03em', textAlign: 'left' }}
          >
            <span className="text-white">Welcome to</span>{' '}
            <span className="text-[#00E6A7]">Insurigence</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-sm sm:text-base md:text-lg lg:text-xl max-w-3xl leading-relaxed mb-10 text-white/90"
            style={{ fontFamily: 'Helvetica' }}
          >
            The modern platform for high-performing insurance teams.
          </motion.p>

          <div className="mt-auto pb-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {items.map((item, index) => (
                <motion.div
                  key={index}
                  transition={{ delay: index * 0.2 }}
                  className={`p-4 rounded-2xl border shadow-lg transition ${
                    index === 0
                      ? 'bg-white text-[#0B4A6F] border-white'
                      : 'bg-white/10 text-white border-white/20 backdrop-blur-md'
                  }`}
                >
                  <div
                    className="flex items-center justify-center w-10 h-10 rounded-full text-black text-lg font-semibold"
                    style={{ background: '#B8FFE8' }}
                  >
                    {index + 1}
                  </div>
                  <div className="mt-6">
                    <h1 className={`text-2xl font-medium ${index === 0 ? '' : 'text-white'}`}>
                      {item.title}
                    </h1>
                    <p className={`text-sm leading-relaxed mt-3 ${index === 0 ? 'text-black' : 'text-white/80'}`}>
                      {item.content}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Right: signup form ── */}
      <div className="flex-1 flex items-center justify-center p-4 lg:p-8 w-full lg:w-2/5">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center" style={{ margin: '0 20%' }}>
            <Logo size="md" />
          </div>

          <div className="px-8 pb-8">
            <p className="mb-6 text-center" style={{ color: '#07496c', fontSize: '1.125rem' }}>
              Set up your Insurigence workspace in minutes.
            </p>

            {/* Tabs */}
            <div className="grid grid-cols-2 mb-6">
              <Link
                href="/login"
                className="text-center pb-2 border-b-2 border-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                data-testid="tab-login"
              >
                Login
              </Link>
              <span
                className="text-center pb-2 border-b-2 font-medium"
                style={{ borderColor: '#00E9B0', color: '#07496c' }}
                data-testid="tab-signup"
              >
                Sign Up
              </span>
            </div>

            {error && (
              <div
                className="mb-4 p-3 rounded-lg text-sm"
                style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}
                data-testid="signup-error"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium mb-1.5" style={labelStyle}>
                    First Name
                  </label>
                  <input
                    id="firstName"
                    value={form.firstName}
                    onChange={set('firstName')}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 placeholder-gray-400"
                    style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                    placeholder="eg. James"
                    required
                    autoComplete="given-name"
                    data-testid="input-firstName"
                  />
                </div>
                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium mb-1.5" style={labelStyle}>
                    Last Name
                  </label>
                  <input
                    id="lastName"
                    value={form.lastName}
                    onChange={set('lastName')}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 placeholder-gray-400"
                    style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                    placeholder="eg. Reyes"
                    required
                    autoComplete="family-name"
                    data-testid="input-lastName"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-1.5" style={labelStyle}>
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 placeholder-gray-400"
                  style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                  placeholder="eg. jamesreyes@gmail.com"
                  required
                  autoComplete="email"
                  data-testid="input-email"
                />
              </div>

              <div>
                <label htmlFor="agencyName" className="block text-sm font-medium mb-1.5" style={labelStyle}>
                  Agency Name
                </label>
                <input
                  id="agencyName"
                  value={form.agencyName}
                  onChange={set('agencyName')}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 placeholder-gray-400"
                  style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                  placeholder="Acme Insurance Agency"
                  required
                  autoComplete="organization"
                  data-testid="input-agencyName"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium mb-1.5" style={labelStyle}>
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={set('password')}
                    className="w-full px-4 py-2.5 pr-11 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 placeholder-gray-400"
                    style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                    placeholder="Enter password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    data-testid="input-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium mb-1.5" style={labelStyle}>
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirm ? 'text' : 'password'}
                    value={form.confirmPassword}
                    onChange={set('confirmPassword')}
                    className="w-full px-4 py-2.5 pr-11 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 placeholder-gray-400"
                    style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                    placeholder="Re-enter your password"
                    required
                    autoComplete="new-password"
                    data-testid="input-confirmPassword"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    {showConfirm ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <label className="flex items-start gap-2 text-sm text-gray-500 pt-1">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5"
                  data-testid="input-terms"
                />
                <span>I agree to the Terms of Services and Privacy Policy</span>
              </label>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-3 rounded-lg font-semibold transition-all duration-200 hover:opacity-90 disabled:opacity-50 border-2"
                style={{ backgroundColor: '#00E9B0', borderColor: '#00E9B0', color: '#07496c' }}
                data-testid="button-signup"
              >
                {isLoading ? 'Creating account…' : 'Create An Account'}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500 mt-5">
              Already have an account?{' '}
              <Link href="/login" className="font-medium" style={{ color: '#00B383' }}>
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
