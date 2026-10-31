'use client';

import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { BrandMark } from '@/components/ui/BrandMark';
import { AlertCircle, Timer, LogOut } from 'lucide-react';
import { clearStoredSessionSecurity } from '@/lib/session-security';

const SESSION_ENDED_NOTICES: Record<
  string,
  { title: string; body: string; icon: React.ComponentType<{ className?: string }> }
> = {
  inactivity: {
    title: 'Session Locked',
    body: 'You were signed out automatically after a period of inactivity. Sign in again to continue.',
    icon: Timer,
  },
  closed: {
    title: 'Session Ended',
    body: 'You were signed out because this browser tab was closed. Sign in again to continue.',
    icon: LogOut,
  },
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [checking, setChecking] = useState(true);
  const [sessionNotice, setSessionNotice] = useState<{
    title: string;
    body: string;
    icon: React.ComponentType<{ className?: string }>;
  } | null>(null);

  // Surface why the session ended, then drop the stale cached settings.
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get('reason');
    if (!reason) return;
    const notice = SESSION_ENDED_NOTICES[reason];
    if (!notice) return;

    clearStoredSessionSecurity();

    const url = new URL(window.location.href);
    url.searchParams.delete('reason');
    window.history.replaceState({}, '', url.toString());

    const timer = window.setTimeout(() => setSessionNotice(notice), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // On mount, check if already logged in
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (!cancelled && res.ok) {
          // Already logged in — go to dashboard
          window.location.replace('/dashboard');
          return;
        }
      } catch {
        // not logged in — that's fine
      }
      if (!cancelled) setChecking(false);
    };
    check();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // Use replace so they can't press Back into login
        window.location.replace('/dashboard');
      } else {
        setError(data.error || 'Login failed');
        setLoading(false);
      }
    } catch {
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    setError('');
    try {
      const res = await fetch('/api/seed', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(
          'Database seeded successfully!\n\n' +
          'You can now login with:\n\n' +
          'Ali Mukhtar (Admin): ali.mukhtar@medicalbilling.com / Ali@2026!\n' +
          'System Admin: admin@medicalbilling.com / Admin@123\n' +
          'Supervisor: supervisor@medicalbilling.com / Supervisor@123\n' +
          'Manager: manager@medicalbilling.com / Manager@123\n' +
          'Team Lead: teamlead@medicalbilling.com / TeamLead@123\n' +
          'AR Executive: executive@medicalbilling.com / Executive@123\n' +
          'Billing User: billing@medicalbilling.com / Billing@123'
        );
      } else {
        setError('Seed failed: ' + (data.error || 'Unknown error'));
      }
    } catch {
      setError('Failed to seed database. Please try again.');
    } finally {
      setSeeding(false);
    }
  };

  // Show medical loading animation while checking auth
  if (checking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0F2D52] to-[#1a3d6e] flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-20 h-20 mx-auto mb-4">
            <div className="absolute inset-0 rounded-full bg-white/10 animate-ping" style={{ animationDuration: '2s' }} />
            <div className="absolute inset-2 rounded-full bg-white/20 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.5s' }} />
            <div className="relative w-20 h-20 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
              <svg viewBox="0 0 24 24" className="w-9 h-9 text-white" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v16M4 12h16" strokeLinecap="round" /></svg>
            </div>
          </div>
          <p className="text-white/70 text-sm font-medium">Initializing...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <BrandMark size="lg" surface="light" />
          </div>
          <h1 className="text-3xl font-bold text-white">BloomAR Manager</h1>
          <p className="text-blue-200 mt-2">Medical Billing AR Management System</p>
        </div>

        <Card className="shadow-xl">
          <h2 className="text-xl font-semibold text-slate-900 mb-6">Sign in to your account</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {sessionNotice && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-amber-800">
              <sessionNotice.icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">{sessionNotice.title}</p>
                <p className="text-sm">{sessionNotice.body}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
            />

            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />

            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={loading}
            >
              Sign In
            </Button>
          </form>

          <div className="flex justify-between text-sm mt-4">
            <a href="/register" className="text-blue-600 font-medium">Create account</a>
            <a href="/forgot-password" className="text-blue-600 font-medium">Forgot password?</a>
          </div>
          <div className="mt-6 pt-6 border-t border-slate-200">
            <p className="text-sm text-slate-500 text-center mb-3">
              Development only — initialize the database with sample data:
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleSeed}
              loading={seeding}
            >
              Seed Database
            </Button>
          </div>
        </Card>

        <p className="text-center text-blue-200 text-sm mt-6">
          Made with ❤️ by WebLoom &nbsp;|&nbsp; © {new Date().getFullYear()} Web Loom LLC. All rights reserved.
        </p>
      </div>
    </div>
  );
}
