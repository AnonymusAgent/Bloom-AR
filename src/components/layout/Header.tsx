'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Bell,
  ChevronDown,
  User,
  Key,
  Sliders,
  Shield,
  LogOut,
} from 'lucide-react';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface HeaderProps {
  user: User;
  title?: string;
}

const ROLE_LABELS: Record<string, string> = {
  administrator: 'System Administrator',
  supervisor: 'Supervisor Operations',
  manager: 'Account Manager Operations',
  senior_lead: 'Senior Lead Operations',
  team_lead: 'Team Lead Operations',
  ar_executive: 'AR Executive',
  billing_user: 'Billing Specialist',
};

export function Header({ user, title }: HeaderProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [notifications, setNotifications] = useState<
    Array<{ id: string; title: string; message: string; isRead: boolean; createdAt: string }>
  >([]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications?limit=5', { credentials: 'include' });
      const data = await res.json();
      if (data.notifications) {
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch {}
  };

  const markAsRead = async () => {
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true }),
        credentials: 'include',
      });
      setUnreadCount(0);
      setNotifications(notifications.map((n) => ({ ...n, isRead: true })));
    } catch {}
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/login';
    } catch {
      window.location.href = '/login';
    }
  };

  return (
    <header className="h-14 bg-[#0F2D52] px-6 flex items-center justify-between shadow-md relative z-30">
      {/* Left: Title */}
      <div>
        <h1 className="text-white font-bold text-lg tracking-tight">{title || 'BloomAR Manager'}</h1>
      </div>

      {/* Right: Notifications + User */}
      <div className="flex items-center gap-5">
        {/* Notification bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
              <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-[#E5E7EB] z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB] bg-[#F5F7FA]">
                  <span className="font-semibold text-sm text-slate-900">Notifications</span>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAsRead}
                      className="text-xs text-[#2563EB] hover:text-[#1d4ed8] font-medium"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[#64748B] text-sm">No notifications</div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`px-4 py-3 border-b border-[#E5E7EB] last:border-0 ${
                          !n.isRead ? 'bg-blue-50/50' : ''
                        }`}
                      >
                        <p className="text-sm font-medium text-slate-900">{n.title}</p>
                        <p className="text-xs text-[#64748B] mt-0.5">{n.message}</p>
                        <p className="text-xs text-[#64748B]/60 mt-1">
                          {new Date(n.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* User profile with interactive dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-3 pl-4 border-l border-white/20 hover:opacity-90 transition-opacity text-left focus:outline-none"
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-sm shadow-inner">
              {user.firstName?.[0]}
              {user.lastName?.[0]}
            </div>
            <div className="hidden sm:block">
              <p className="text-white text-sm font-semibold leading-tight">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-white/60 text-xs leading-tight">
                {ROLE_LABELS[user.role] || user.role}
              </p>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-white/50 transition-transform ${
                showUserMenu ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-2xl border border-[#E5E7EB] z-50 overflow-hidden divide-y divide-[#E5E7EB] animate-in fade-in zoom-in-95 duration-100">
                {/* Header profile summary */}
                <div className="p-4 bg-gradient-to-b from-[#F8FAFC] to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#2563EB] text-white flex items-center justify-center font-bold text-sm shadow">
                      {user.firstName?.[0]}
                      {user.lastName?.[0]}
                    </div>
                    <div className="overflow-hidden">
                      <p className="text-sm font-bold text-slate-900 truncate">
                        {user.firstName} {user.lastName}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{user.email}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-[#2563EB] border border-blue-100">
                      {ROLE_LABELS[user.role] || user.role}
                    </span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500" title="Active" />
                  </div>
                </div>

                {/* Navigation links */}
                <div className="py-1 text-xs text-slate-700">
                  <Link
                    href="/profile"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 hover:text-[#2563EB] transition-colors"
                  >
                    <User className="w-4 h-4 text-slate-400" />
                    <span>Profile & Account Information</span>
                  </Link>

                  <Link
                    href="/profile?tab=security"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 hover:text-[#2563EB] transition-colors"
                  >
                    <Key className="w-4 h-4 text-slate-400" />
                    <span>Security & Password</span>
                  </Link>

                  <Link
                    href="/profile?tab=preferences"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 hover:text-[#2563EB] transition-colors"
                  >
                    <Sliders className="w-4 h-4 text-slate-400" />
                    <span>Application Preferences</span>
                  </Link>

                  <Link
                    href="/profile?tab=permissions"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 hover:text-[#2563EB] transition-colors"
                  >
                    <Shield className="w-4 h-4 text-slate-400" />
                    <span>Role & Permissions Matrix</span>
                  </Link>
                </div>

                {/* Sign Out */}
                <div className="p-1.5">
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      handleLogout();
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
