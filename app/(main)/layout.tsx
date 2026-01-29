'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Logo from '@/app/components/Logo';
import { LogOut, User, Shield } from 'lucide-react';

interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'AGENT';
  agencyId: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
}

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/session');
        const data = await res.json();
        
        if (data.user) {
          if (data.user.mustChangePassword) {
            router.push('/change-password');
            return;
          }
          setUser(data.user);
        } else {
          router.push('/login');
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    
    checkAuth();
  }, [router]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00E6A7]"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const displayName = user.firstName && user.lastName 
    ? `${user.firstName} ${user.lastName}` 
    : user.email;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Logo size="sm" />
            <nav className="flex items-center gap-6">
              <Link 
                href="/dashboard" 
                className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors" 
                data-testid="link-dashboard"
              >
                Dashboard
              </Link>
              <Link 
                href="/intake/commercial-gl" 
                className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors" 
                data-testid="link-new-intake"
              >
                New Intake
              </Link>
              {user.role === 'SUPER_ADMIN' && (
                <Link 
                  href="/super-admin" 
                  className="text-sm font-medium text-purple-600 hover:text-purple-700 transition-colors flex items-center gap-1" 
                  data-testid="link-super-admin"
                >
                  <Shield className="w-4 h-4" />
                  Super Admin
                </Link>
              )}
            </nav>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <User className="w-4 h-4" />
                <span data-testid="text-user-name">{displayName}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  user.role === 'SUPER_ADMIN' ? 'bg-purple-100 text-purple-700' :
                  user.role === 'ADMIN' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {user.role === 'SUPER_ADMIN' ? 'Super Admin' : 
                   user.role === 'ADMIN' ? 'Admin' : 'Agent'}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Sign out"
                data-testid="button-logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1">
        {children}
      </main>
      <footer className="bg-gray-50 border-t border-gray-200 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">&copy; 2026 Insurigence. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <a href="#" className="text-sm text-gray-500 hover:text-gray-700">Privacy</a>
              <a href="#" className="text-sm text-gray-500 hover:text-gray-700">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
