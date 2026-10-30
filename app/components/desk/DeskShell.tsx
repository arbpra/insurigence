'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Building2, CalendarDays, CheckSquare, ChevronRight, Home, Inbox, Layers, LineChart, ListTodo,
  LogOut, Menu, MessageSquare, Plus, Receipt, Repeat, Route, ShieldCheck, Upload, UserCog, Users, X,
  type LucideIcon,
} from 'lucide-react';
import {
  AREA_TITLES, isActivePath, navFor, otherAreaLinks, type DeskArea, type DeskIcon,
} from '@/lib/desk/navigation';

const ICONS: Record<DeskIcon, LucideIcon> = {
  home: Home, inbox: Inbox, plus: Plus, users: Users, upload: Upload, chat: MessageSquare,
  shield: ShieldCheck, queue: ListTodo, check: CheckSquare, building: Building2, layers: Layers,
  chart: LineChart, receipt: Receipt, staff: UserCog, route: Route, calendar: CalendarDays, repeat: Repeat,
};

interface DeskShellProps {
  area: DeskArea;
  role: string;
  identity: { name: string; roleLabel: string; initials: string };
  /** Inside another layout that already has a page header (Super Admin). */
  embedded?: boolean;
  children: React.ReactNode;
}

/** Sidebar + header shared by the three Desk areas. */
export function DeskShell({ area, role, identity, embedded = false, children }: DeskShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items = navFor(area, role);
  const others = otherAreaLinks(area, role);

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  };

  return (
    <div className={`flex ${embedded ? 'min-h-[calc(100vh-4rem)]' : 'min-h-screen'}`} style={{ backgroundColor: 'var(--brand-background, #f8fafc)' }}>
      {open && <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-200
          lg:translate-x-0 lg:static lg:z-auto ${open ? 'translate-x-0' : '-translate-x-full'}`}
        data-testid="desk-sidebar"
      >
        <div className="flex flex-col h-full">
          <div className="px-4 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold tracking-wide uppercase text-slate-400">Insurigence</p>
              <p className="text-lg font-bold" style={{ color: 'var(--brand-primary, #05314c)' }} data-testid="desk-area-title">
                {AREA_TITLES[area]}
              </p>
            </div>
            <button className="lg:hidden p-1 text-slate-500" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label={AREA_TITLES[area]}>
            {items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isActivePath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`desk-nav-${item.href.split('/').filter(Boolean).join('-')}`}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                    ${active ? 'text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                  style={active ? { backgroundColor: 'var(--brand-primary, #05314c)' } : undefined}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {others.length > 0 && (
            <div className="p-3 border-t border-slate-100 space-y-1">
              {others.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                >
                  {link.label}
                  <ChevronRight className="w-4 h-4" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between">
          <button className="lg:hidden p-2 -ml-2 text-slate-600" onClick={() => setOpen(true)} aria-label="Open menu" data-testid="desk-menu-button">
            <Menu className="w-5 h-5" />
          </button>
          <div className="hidden lg:block" />
          {!embedded && (
            <div className="flex items-center gap-3">
              <div className="text-right leading-tight">
                <p className="text-sm font-medium text-slate-800" data-testid="desk-user-name">{identity.name}</p>
                <p className="text-xs text-slate-500" data-testid="desk-user-role">{identity.roleLabel}</p>
              </div>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: 'var(--brand-primary, #05314c)' }}>
                {identity.initials}
              </div>
              <button onClick={logout} className="p-2 text-slate-500 hover:text-slate-800" title="Sign out" data-testid="desk-logout">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </header>
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <div className="max-w-6xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
