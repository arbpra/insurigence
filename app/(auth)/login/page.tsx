'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Logo from '@/app/components/Logo';
import signinBanner from '@/attached_assets/bgSignin.webp';
import { motion } from "framer-motion";
import Link from 'next/link';
import { Check } from "lucide-react";

const container = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const fadeUp = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1 }
};

const items = [
  { title: 'Collaborate', content: 'Work seamlessly with your team' },
  { title: 'Track & Grow', content: 'Monitor performance and close more deals' },
  { title: 'Stay Protected', content: 'Enterprise-grade security you can trust' }
];




function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect');
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
        router.replace('/change-password');
        return;
      }

      if (redirect) {
        router.replace(redirect);
        return;
      }

      if (data.user.role === 'SUPER_ADMIN') {
        router.replace('/super-admin');
      } else {
        router.replace('/dashboard');
      }
    } catch {
      setError('An error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#ffffff' }}>
      <div className="hidden lg:flex lg:w-3/5 flex-col min-h-screen px-10" style={{
        backgroundImage: `url(${signinBanner.src})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}>

        {/* Content */}
        <motion.div
          className="relative flex flex-col h-full max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-left"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: false, amount: 0.4 }}
          variants={container}
        >

          {/* Heading */}
          <motion.h1
            variants={fadeUp}
            className="text-3xl sm:text-3xl md:text-4xl lg:text-4xl font-normal tracking-tight leading-tight mb-6"
            style={{
              fontFamily: "Helvetica",
              letterSpacing: "-0.03em",
              textAlign: "left",
            }}
          >
            <span className="text-white">
              Welcome to
            </span>{" "}
            <span className="text-[#00E6A7]">
              Insurigence
            </span>
          </motion.h1>

          {/* Paragraph */}
          <motion.p
            variants={fadeUp}
            className="text-sm sm:text-base md:text-lg lg:text-xl max-w-3xl leading-relaxed mb-10 text-white/90"
            style={{ fontFamily: "Helvetica" }}
          >
            The modern platform for high-performing insurance teams.
          </motion.p>

          {/* Cards */}
          <div className="mt-auto pb-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {items.map((item, index) => (
                <motion.div
                  key={index}
                  transition={{ delay: index * 0.2 }}
                  className={`p-4 rounded-2xl
                    bg-white/10 border border-white/20
                    text-white shadow-lg backdrop-blur-md
                    hover:scale-[1.02] transition"

                    ${index === 0
                      ? "bg-white text-[#0B4A6F] border-white"
                      : "bg-white/10 text-white border-white/20 backdrop-blur-md"
                      }
                    `}>
                  {/* Number Circle */}
                  <div
                    className="flex items-center justify-center w-10 h-10 rounded-full text-black text-lg font-semibold"
                    style={{ background: "#B8FFE8" }}
                  >
                    {index + 1}
                  </div>

                  {/* Text Content */}
                  <div className="mt-6">
                    <h1 className={`text-2xl font-medium
                      ${index === 0
                        ? "text"
                        : "text-white"
                      }          
                    `}>
                      {item.title}
                    </h1>

                    <p className={`text-sm text-white/80 leading-relaxed mt-3

                    ${index === 0
                        ? "text-black"
                        : "text-white"
                      }
                      
                      `}>
                      {item.content}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

        </motion.div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 lg:p-8 w-full lg:w-2/5">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center" style={{ margin: '0 20%' }}>
            <Logo size="md" />
          </div>

          <div className="p-8">
            {/* <h2 className="text-2xl font-bold mb-2" style={{ color: '#0D2137' }}>
              Welcome back
            </h2> */}
            <p className="text-600 mb-16 text-center" style={{ color: '#07496c', fontSize: '1.125rem' }}>
              Sign in to your Insurigence account.
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

            {/* <a
              href="/api/login"
              className="w-full py-3 px-4 rounded-lg font-semibold text-white transition-all duration-200 hover:opacity-90 flex items-center justify-center gap-2 mb-6"
              style={{ backgroundColor: '#00E6A7' }}
              data-testid="button-replit-login"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
              Sign in with Replit
            </a> */}

            {/* <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-3 bg-white text-gray-500">Or sign in with email</span>
              </div>
            </div> */}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium mb-2"
                  style={{ color: '#07496c' }}
                >
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 placeholder-gray-400"
                  style={{ '--tw-ring-color': '#00E6A7', color: '#111827' } as React.CSSProperties}
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
                  style={{ color: '#07496c' }}
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 placeholder-gray-400"
                  style={{ color: '#111827' }}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  data-testid="input-password"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2 px-3 rounded-lg font-semibold transition-all duration-200 hover:opacity-90 disabled:opacity-50 border-2"
                style={{ backgroundColor: '#00E9B0', borderColor: '#00E9B0', color: '#07496c' }}
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
