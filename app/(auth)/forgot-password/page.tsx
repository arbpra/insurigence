'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import Logo from '@/app/components/Logo';
import signinBanner from '@/attached_assets/bgSignin.webp';

const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } };
const fadeUp = { hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } };
const items = [
  { title: 'Collaborate', content: 'Work seamlessly with your team' },
  { title: 'Track & Grow', content: 'Monitor performance and close more deals' },
  { title: 'Stay Protected', content: 'Enterprise-grade security you can trust' },
];

const CODE_LEN = 6;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState<string[]>(Array(CODE_LEN).fill(''));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const sendCode = async () => {
    setError('');
    setInfo('');
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not send the code.');
      } else {
        setCodeSent(true);
        setInfo(json.message || 'If an account exists, a verification code has been sent.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setSending(false);
    }
  };

  const setDigit = (i: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    setCode((prev) => {
      const next = [...prev];
      next[i] = digit;
      return next;
    });
    if (digit && i < CODE_LEN - 1) inputsRef.current[i + 1]?.focus();
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) inputsRef.current[i - 1]?.focus();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LEN).split('');
    if (digits.length) {
      e.preventDefault();
      setCode(Array.from({ length: CODE_LEN }, (_, i) => digits[i] ?? ''));
      inputsRef.current[Math.min(digits.length, CODE_LEN - 1)]?.focus();
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const codeStr = code.join('');
    if (codeStr.length !== CODE_LEN) return setError('Enter the 6-digit verification code.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');

    setResetting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: codeStr, password, confirmPassword }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not reset your password.');
        setResetting(false);
        return;
      }
      router.replace('/login?reset=1');
    } catch {
      setError('An error occurred. Please try again.');
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#ffffff' }}>
      {/* Left banner */}
      <div
        className="hidden lg:flex lg:w-3/5 flex-col min-h-screen px-10"
        style={{ backgroundImage: `url(${signinBanner.src})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
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
            className="text-3xl md:text-4xl font-normal tracking-tight leading-tight mb-6"
            style={{ fontFamily: 'Helvetica', letterSpacing: '-0.03em' }}
          >
            <span className="text-white">Welcome to</span>{' '}
            <span className="text-[#00E6A7]">Insurigence</span>
          </motion.h1>
          <motion.p variants={fadeUp} className="text-lg lg:text-xl max-w-3xl leading-relaxed mb-10 text-white/90" style={{ fontFamily: 'Helvetica' }}>
            The modern platform for high-performing insurance teams.
          </motion.p>
          <div className="mt-auto pb-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {items.map((item, index) => (
                <motion.div
                  key={index}
                  transition={{ delay: index * 0.2 }}
                  className={`p-4 rounded-2xl border shadow-lg ${index === 0 ? 'bg-white text-[#0B4A6F] border-white' : 'bg-white/10 text-white border-white/20 backdrop-blur-md'}`}
                >
                  <div className="flex items-center justify-center w-10 h-10 rounded-full text-black text-lg font-semibold" style={{ background: '#B8FFE8' }}>
                    {index + 1}
                  </div>
                  <div className="mt-6">
                    <h1 className={`text-2xl font-medium ${index === 0 ? '' : 'text-white'}`}>{item.title}</h1>
                    <p className={`text-sm leading-relaxed mt-3 ${index === 0 ? 'text-black' : 'text-white/80'}`}>{item.content}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Right: reset form */}
      <div className="flex-1 flex items-center justify-center p-4 lg:p-8 w-full lg:w-2/5">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center" style={{ margin: '0 20%' }}>
            <Logo size="md" />
          </div>

          <div className="px-8 pb-8">
            <h2 className="text-2xl font-semibold mb-2 text-center" style={{ color: '#07496c' }}>
              Forgot Your Password?
            </h2>
            <p className="text-sm text-center text-slate-500 mb-6">
              The verification code will be sent to your inbox. Please check it.
            </p>

            {error && (
              <div className="mb-4 p-3 rounded-lg text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }} data-testid="reset-error">
                {error}
              </div>
            )}
            {info && !error && (
              <div className="mb-4 p-3 rounded-lg text-sm" style={{ backgroundColor: '#DCFCE7', color: '#166534' }}>
                {info}
              </div>
            )}

            {/* Email + send code */}
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 placeholder-gray-400"
              style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
              placeholder="eg. jamesreyes@gmail.com"
              autoComplete="email"
              data-testid="input-email"
            />
            <div className="mt-2 mb-6">
              <button
                type="button"
                onClick={sendCode}
                disabled={sending}
                className="text-sm font-medium hover:opacity-80 disabled:opacity-50"
                style={{ color: '#00B383' }}
                data-testid="button-send-code"
              >
                {sending ? 'Sending…' : codeSent ? 'Resend verification code' : 'Send verification code'}
              </button>
            </div>

            <form onSubmit={reset}>
              {/* Verification code */}
              <p className="text-sm font-medium text-center mb-3" style={{ color: '#07496c' }}>
                Enter Your Verification Code
              </p>
              <div className="flex justify-center gap-2 mb-6" onPaste={onPaste}>
                {code.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputsRef.current[i] = el; }}
                    value={d}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => onKeyDown(i, e)}
                    inputMode="numeric"
                    maxLength={1}
                    disabled={!codeSent}
                    className="w-11 h-12 text-center text-lg font-semibold rounded-lg border border-gray-300 bg-gray-50 focus:outline-none focus:ring-2 disabled:opacity-50"
                    style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                    data-testid={`code-${i}`}
                  />
                ))}
              </div>

              {/* New password */}
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>New Password</label>
              <div className="relative mb-4">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!codeSent}
                  className="w-full px-4 py-2.5 pr-11 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 disabled:opacity-50"
                  style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                  placeholder="Create a new password"
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

              <label className="block text-sm font-medium mb-1.5" style={{ color: '#07496c' }}>Confirm Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={!codeSent}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 disabled:opacity-50 mb-6"
                style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                data-testid="input-confirm"
              />

              <button
                type="submit"
                disabled={resetting || !codeSent}
                className="w-full py-3 rounded-lg font-semibold transition-all hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#00E9B0', color: '#07496c' }}
                data-testid="button-reset"
              >
                {resetting ? 'Resetting…' : 'Reset Password'}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500 mt-6">
              Back to{' '}
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
