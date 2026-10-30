'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Role } from '@/lib/roles';
import { landingPath, superAdminAreaAllowed } from '@/lib/desk/navigation';

interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  agencyId: string | null;
}

interface AdminAuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  logout: () => Promise<void>;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

const AdminAuthContext = createContext<AdminAuthContextType | null>(null);

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error('useAdminAuth must be used within AdminAuthProvider');
  }
  return context;
}

function AdminAuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Re-checked on every navigation: an Operations Manager is allowed into
  // Desk setup but not the rest of Super Admin.
  useEffect(() => {
    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();
      
      if (data.user && superAdminAreaAllowed(data.user.role, pathname)) {
        setUser(data.user);
        setIsAuthenticated(true);
      } else if (data.user) {
        setIsAuthenticated(false);
        router.push(landingPath(data.user.role));
      } else {
        router.push('/login');
      }
    } catch {
      router.push('/login');
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setIsAuthenticated(false);
      router.push('/login');
    }
  };

  const authFetch = async (url: string, options: RequestInit = {}) => {
    return fetch(url, { ...options, credentials: 'include' });
  };

  return (
    <AdminAuthContext.Provider value={{ user, isAuthenticated, isLoading, logout, authFetch }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-500">Loading...</div>
    </div>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAdminAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAuthProvider>
      <AuthGate>{children}</AuthGate>
    </AdminAuthProvider>
  );
}
