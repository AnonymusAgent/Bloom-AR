'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MedicalLoadingScreen } from '@/components/ui/MedicalLoader';
import SessionGuard from '@/components/auth/SessionGuard';
import { clearStoredSessionSecurity } from '@/lib/session-security';

interface User { id: string; email: string; firstName: string; lastName: string; role: string; }
interface AppLayoutProps { children: React.ReactNode; title?: string; }

export function AppLayout({ children, title }: AppLayoutProps) {
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (!cancelled) {
          if (res.ok) { const data = await res.json(); setUser(data.user); setAuthState('authenticated'); }
          else { setAuthState('unauthenticated'); }
        }
      } catch { if (!cancelled) setAuthState('unauthenticated'); }
    };
    fetchUser();
    return () => { cancelled = true; };
  }, []);

  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
    clearStoredSessionSecurity();
    window.location.replace('/login');
  };

  if (authState === 'loading') {
    return <MedicalLoadingScreen message="Connecting to AR Management System..." />;
  }

  if (authState === 'unauthenticated' || !user) {
    return (
      <div className="min-h-screen bg-[#F5F7FA] flex items-center justify-center">
        <div className="text-center bg-white p-8 rounded-xl shadow-sm border border-[#E5E7EB] max-w-sm">
          <div className="w-12 h-12 bg-blue-50 text-[#2563EB] rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Session Expired</h2>
          <p className="text-[#64748B] text-sm mb-6">Please sign in to continue.</p>
          <a href="/login" className="inline-flex items-center justify-center px-6 py-2.5 bg-[#2563EB] text-white rounded-lg hover:bg-[#1d4ed8] font-medium text-sm transition-colors">Go to Login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA] flex flex-col">
      <div className="flex flex-1">
        <Sidebar
          user={user}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          onExpand={() => setCollapsed(false)}
          onLogout={handleLogout}
        />
        <div className={`flex-1 flex flex-col transition-all duration-300 ${collapsed ? 'ml-[60px]' : 'ml-[240px]'}`}>
          <Header user={user} title={title} />
          <main className="flex-1 p-5">{children}</main>
          <footer className="px-5 py-3 border-t border-[#E5E7EB] bg-white">
            <p className="text-center text-[11px] text-[#64748B]">
              Made with ❤️ by WebLoom &nbsp;|&nbsp; © {new Date().getFullYear()} Web Loom LLC. All rights reserved.
            </p>
          </footer>
        </div>
      </div>
      <SessionGuard />
    </div>
  );
}
