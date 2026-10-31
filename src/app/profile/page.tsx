'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  User,
  Shield,
  Key,
  Bell,
  CheckCircle,
  XCircle,
  Copy,
  Check,
  Calendar,
  Clock,
  Building2,
  Mail,
  Phone,
  Lock,
  Eye,
  EyeOff,
  LogOut,
  Sparkles,
  AlertTriangle,
  UserCheck,
  Smartphone,
  Sliders,
  Award,
  ShieldCheck,
} from 'lucide-react';
import {
  SESSION_INACTIVITY_OPTIONS,
  WARN_BEFORE_LOCK_OPTIONS,
  DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
  DEFAULT_LOGOUT_ON_CLOSE,
  DEFAULT_WARN_BEFORE_LOCK_SECONDS,
  resolveSessionSecurity,
  writeStoredSessionSecurity,
} from '@/lib/session-security';

interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
  isActive: boolean;
  preferences: {
    notifications?: {
      email?: boolean;
      assignments?: boolean;
      signoffs?: boolean;
      statusUpdates?: boolean;
    };
    dateFormat?: string;
    timezone?: string;
    pageSize?: number;
    avatarColor?: string;
    sessionSecurity?: {
      inactivityTimeoutMinutes?: number;
      logoutOnClose?: boolean;
      warnBeforeLockSeconds?: number;
    };
  } | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  roleInfo: {
    title: string;
    description: string;
    level: string;
  };
}

interface PermissionItem {
  key: string;
  label: string;
  description: string;
  category: string;
  isGranted: boolean;
}

interface ProfileData {
  user: UserProfile;
  teamLead: { id: string; firstName: string; lastName: string; email: string; role: string } | null;
  assignedPractices: Array<{ id: string; name: string; code: string; specialty: string | null }>;
  permissions: {
    granted: PermissionItem[];
    restricted: PermissionItem[];
    capabilities: Record<string, boolean>;
  };
}

const AVATAR_COLOR_PRESETS = [
  'from-blue-600 to-indigo-600',
  'from-emerald-600 to-teal-700',
  'from-violet-600 to-purple-800',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-red-700',
  'from-cyan-600 to-blue-700',
];

const VALID_TABS = ['personal', 'account', 'security', 'preferences', 'permissions'] as const;

type ProfileTab = (typeof VALID_TABS)[number];

const TABS: Array<{ id: ProfileTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'personal', label: 'Personal Information', icon: User },
  { id: 'account', label: 'Account Information', icon: Building2 },
  { id: 'security', label: 'Security & Password', icon: Key },
  { id: 'preferences', label: 'Preferences', icon: Sliders },
  { id: 'permissions', label: 'Role & Permissions', icon: Shield },
];

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileLoading />}>
      <ProfileContent />
    </Suspense>
  );
}

function ProfileLoading() {
  return (
    <AppLayout title="Profile & Account Settings">
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-500 font-medium text-sm">Loading account details...</p>
      </div>
    </AppLayout>
  );
}

function ProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: ProfileTab = VALID_TABS.includes(tabParam as ProfileTab)
    ? (tabParam as ProfileTab)
    : 'personal';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<ProfileData | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form states for Personal Info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLOR_PRESETS[0]);

  // Form states for Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Form states for Preferences
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [assignmentNotifs, setAssignmentNotifs] = useState(true);
  const [signoffNotifs, setSignoffNotifs] = useState(true);
  const [statusNotifs, setStatusNotifs] = useState(true);
  const [dateFormat, setDateFormat] = useState('MM/DD/YYYY');
  const [timezone, setTimezone] = useState('America/New_York (EST)');
  const [pageSize, setPageSize] = useState(25);

  // Form states for Session Security
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(
    DEFAULT_INACTIVITY_TIMEOUT_MINUTES
  );
  const [logoutOnClose, setLogoutOnClose] = useState(DEFAULT_LOGOUT_ON_CLOSE);
  const [warnBeforeLockSeconds, setWarnBeforeLockSeconds] = useState(
    DEFAULT_WARN_BEFORE_LOCK_SECONDS
  );

  const setActiveTab = (tab: ProfileTab) => {
    setStatusMessage(null);
    router.replace(`/profile?tab=${tab}`, { scroll: false });
  };

  const applyProfile = (json: ProfileData) => {
    setData(json);

    setFirstName(json.user.firstName || '');
    setLastName(json.user.lastName || '');
    setPhone(json.user.phone || '');
    setAvatarUrl(json.user.avatarUrl || '');

    const prefs = json.user.preferences;
    if (prefs) {
      if (prefs.notifications) {
        setEmailNotifs(prefs.notifications.email ?? true);
        setAssignmentNotifs(prefs.notifications.assignments ?? true);
        setSignoffNotifs(prefs.notifications.signoffs ?? true);
        setStatusNotifs(prefs.notifications.statusUpdates ?? true);
      }
      if (prefs.dateFormat) setDateFormat(prefs.dateFormat);
      if (prefs.timezone) setTimezone(prefs.timezone);
      if (prefs.pageSize) setPageSize(prefs.pageSize);
      if (prefs.avatarColor && AVATAR_COLOR_PRESETS.includes(prefs.avatarColor)) {
        setAvatarColor(prefs.avatarColor);
      }
      const security = resolveSessionSecurity(prefs.sessionSecurity);
      setSessionTimeoutMinutes(security.inactivityTimeoutMinutes);
      setLogoutOnClose(security.logoutOnClose);
      setWarnBeforeLockSeconds(security.warnBeforeLockSeconds);
    }
  };

  const requestProfile = async () => {
    const res = await fetch('/api/profile', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load profile');
    return (await res.json()) as ProfileData;
  };

  const fetchProfile = async () => {
    try {
      applyProfile(await requestProfile());
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: 'Could not load your profile details.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    requestProfile()
      .then((json) => {
        if (cancelled) return;
        applyProfile(json);
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.error(err);
        setStatusMessage({ type: 'error', text: 'Could not load your profile details.' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const copyUserId = () => {
    if (data?.user?.id) {
      navigator.clipboard.writeText(data.user.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const handleSavePersonalInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          firstName,
          lastName,
          phone,
          avatarUrl,
          preferences: {
            ...(data?.user?.preferences || {}),
            avatarColor,
          },
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to save changes');
      setStatusMessage({ type: 'success', text: 'Personal information updated successfully.' });
      fetchProfile();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Error updating profile.' });
    } finally {
      setSaving(false);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);
    const nextSecurity = resolveSessionSecurity({
      inactivityTimeoutMinutes: sessionTimeoutMinutes,
      logoutOnClose,
      warnBeforeLockSeconds,
    });
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          preferences: {
            ...(data?.user?.preferences || {}),
            notifications: {
              email: emailNotifs,
              assignments: assignmentNotifs,
              signoffs: signoffNotifs,
              statusUpdates: statusNotifs,
            },
            dateFormat,
            timezone,
            pageSize,
            sessionSecurity: nextSecurity,
          },
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to save preferences');
      writeStoredSessionSecurity(nextSecurity);
      setStatusMessage({ type: 'success', text: 'Application preferences saved.' });
      fetchProfile();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Error updating preferences.' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setStatusMessage({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    if (newPassword.length < 8) {
      setStatusMessage({ type: 'error', text: 'New password must be at least 8 characters long.' });
      return;
    }

    setPasswordSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update password');
      setStatusMessage({ type: 'success', text: 'Password changed successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Error changing password.' });
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/login';
    } catch {
      window.location.href = '/login';
    }
  };

  if (loading) {
    return <ProfileLoading />;
  }

  const user = data?.user;
  const permissions = data?.permissions;

  return (
    <AppLayout title="Profile & Account Settings">
      <div className="max-w-5xl mx-auto space-y-6 pb-12">
        {/* Profile Header Hero Card */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0F2D52] via-[#1E3A8A] to-[#2563EB] text-white p-6 sm:p-8 shadow-xl">
          <div className="absolute -right-12 -top-12 w-64 h-64 bg-white/5 rounded-full blur-2xl pointer-events-none" />
          <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              {/* User Avatar */}
              <div className="relative">
                {user?.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.firstName}
                    className="w-20 h-20 rounded-2xl object-cover border-2 border-white/20 shadow-md"
                  />
                ) : (
                  <div
                    className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${avatarColor} flex items-center justify-center text-white font-bold text-2xl shadow-inner border border-white/20`}
                  >
                    {user?.firstName?.[0]}
                    {user?.lastName?.[0]}
                  </div>
                )}
                <div
                  className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-[#0F2D52] flex items-center justify-center ${
                    user?.isActive ? 'bg-emerald-500' : 'bg-slate-400'
                  }`}
                  title={user?.isActive ? 'Active Account' : 'Inactive'}
                />
              </div>

              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-bold tracking-tight text-white">
                    {user?.firstName} {user?.lastName}
                  </h1>
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white backdrop-blur-md border border-white/10 uppercase tracking-wide">
                    {user?.roleInfo?.title || user?.role?.replace(/_/g, ' ')}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-400/20 text-emerald-300 border border-emerald-400/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Active
                  </span>
                </div>
                <p className="text-blue-100/80 text-sm mt-1 flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5" /> {user?.email}
                </p>
                <p className="text-xs text-blue-200/60 mt-1">
                  {user?.roleInfo?.level} • Member since {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                className="bg-white/10 hover:bg-white/20 text-white border-white/20 backdrop-blur-sm"
                onClick={handleLogout}
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>

        {/* Status Notification Banner */}
        {statusMessage && (
          <div
            className={`p-4 rounded-xl flex items-center justify-between shadow-sm border ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <div className="flex items-center gap-2.5 text-sm font-medium">
              {statusMessage.type === 'success' ? (
                <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-xs font-semibold hover:underline opacity-80"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-[#E5E7EB] overflow-x-auto pb-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-xl transition-all border-b-2 whitespace-nowrap ${
                  isActive
                    ? 'border-[#2563EB] text-[#2563EB] bg-blue-50/50 font-semibold'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* TAB 1: PERSONAL INFORMATION */}
        {activeTab === 'personal' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              <Card>
                <CardHeader
                  title="Personal Information"
                  subtitle="Update your basic contact details and how you appear across BloomAR Manager."
                />
                <form onSubmit={handleSavePersonalInfo} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                      label="First Name *"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                    />
                    <Input
                      label="Last Name *"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Email Address
                    </label>
                    <div className="relative">
                      <input
                        type="email"
                        value={user?.email || ''}
                        disabled
                        className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-slate-100 text-slate-600 text-sm cursor-not-allowed"
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-slate-400 flex items-center gap-1">
                        <Lock className="w-3.5 h-3.5" /> Fixed
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      To change your login email address, contact your system administrator.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Phone Number
                    </label>
                    <div className="relative">
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="e.g. +1 (555) 234-5678"
                        className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                      />
                      <Phone className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Profile Photo / Avatar Image URL
                    </label>
                    <input
                      type="url"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://example.com/avatar.jpg (Optional)"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                    />
                    <p className="text-xs text-slate-400 mt-1">
                      Provide a public URL to your professional headshot, or use default initials.
                    </p>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <Button type="submit" loading={saving}>
                      Save Changes
                    </Button>
                  </div>
                </form>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader title="Avatar Badge Style" subtitle="Select default gradient palette" />
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${avatarColor} flex items-center justify-center text-white font-bold text-lg shadow`}
                    >
                      {firstName?.[0] || 'U'}
                      {lastName?.[0] || 'A'}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {firstName} {lastName}
                      </p>
                      <p className="text-xs text-slate-500">Initials Avatar</p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#E5E7EB]">
                    <p className="text-xs font-medium text-slate-600 mb-2">Preset Colors</p>
                    <div className="grid grid-cols-3 gap-2">
                      {AVATAR_COLOR_PRESETS.map((color, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setAvatarColor(color)}
                          className={`h-8 rounded-lg bg-gradient-to-r ${color} border-2 transition-transform hover:scale-105 ${
                            avatarColor === color ? 'border-slate-900 ring-2 ring-blue-500' : 'border-transparent'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="space-y-2 text-xs text-slate-600">
                  <div className="flex items-center gap-2 text-slate-800 font-semibold mb-2 text-sm">
                    <Award className="w-4 h-4 text-[#2563EB]" /> Professional Profile
                  </div>
                  <p>
                    Your name and role are attached to claim audit notes, sign-off requests, and supervisor approvals.
                  </p>
                  <p>
                    Keep contact details accurate so billing team leads and supervisors can reach you regarding urgent appeals.
                  </p>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* TAB 2: ACCOUNT INFORMATION */}
        {activeTab === 'account' && (
          <div className="space-y-6">
            <Card>
              <CardHeader
                title="Account Credentials & System Information"
                subtitle="Detailed identity, identifiers, and role assignments in the BloomAR Manager system."
              />
              <div className="divide-y divide-[#E5E7EB]">
                <div className="py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <span className="text-sm font-medium text-slate-500">Unique User ID (UUID)</span>
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <code className="text-xs bg-slate-100 text-slate-800 px-2 py-1 rounded font-mono select-all">
                      {user?.id}
                    </code>
                    <button
                      onClick={copyUserId}
                      className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 transition-colors"
                      title="Copy User ID"
                    >
                      {copiedId ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                    {copiedId && <span className="text-xs text-emerald-600 font-medium">Copied!</span>}
                  </div>
                </div>

                <div className="py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <span className="text-sm font-medium text-slate-500">Username / Login ID</span>
                  <div className="sm:col-span-2 text-sm font-medium text-slate-900">{user?.email}</div>
                </div>

                <div className="py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <span className="text-sm font-medium text-slate-500">System Role</span>
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-100 text-[#2563EB]">
                      {user?.roleInfo?.title}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">({user?.role})</span>
                  </div>
                </div>

                <div className="py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <span className="text-sm font-medium text-slate-500">Account Status</span>
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Active & Authorized
                    </span>
                  </div>
                </div>

                <div className="py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <span className="text-sm font-medium text-slate-500">Account Created</span>
                  <div className="sm:col-span-2 text-sm text-slate-700 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    {user?.createdAt ? new Date(user.createdAt).toLocaleString() : 'N/A'}
                  </div>
                </div>

                <div className="py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <span className="text-sm font-medium text-slate-500">Last Active / Login</span>
                  <div className="sm:col-span-2 text-sm text-slate-700 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" />
                    {user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Current Session'}
                  </div>
                </div>

                {data?.teamLead && (
                  <div className="py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <span className="text-sm font-medium text-slate-500">Assigned Team Lead</span>
                    <div className="sm:col-span-2 text-sm text-slate-800">
                      <p className="font-semibold">
                        {data.teamLead.firstName} {data.teamLead.lastName}
                      </p>
                      <p className="text-xs text-slate-500">{data.teamLead.email}</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Assigned Practices Card */}
            <Card>
              <CardHeader
                title={`Authorized Practices (${data?.assignedPractices?.length || 0})`}
                subtitle="Practices and medical facilities whose claims and patient records you are permitted to access."
              />
              {data?.assignedPractices && data.assignedPractices.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {data.assignedPractices.map((practice) => (
                    <div
                      key={practice.id}
                      className="p-3.5 rounded-xl border border-[#E5E7EB] bg-slate-50/70 hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-mono font-bold text-[#2563EB] bg-blue-50 px-2 py-0.5 rounded">
                          {practice.code}
                        </span>
                        <Building2 className="w-4 h-4 text-slate-400" />
                      </div>
                      <p className="text-sm font-semibold text-slate-800 line-clamp-1">{practice.name}</p>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                        {practice.specialty || 'General Medical Practice'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-slate-400 text-sm">
                  No individual practices assigned. Contact an administrator to allocate practices.
                </div>
              )}
            </Card>
          </div>
        )}

        {/* TAB 3: SECURITY & PASSWORD */}
        {activeTab === 'security' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              <Card>
                <CardHeader
                  title="Change Password"
                  subtitle="Ensure your account uses a strong password with at least 8 characters."
                />
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Current Password *
                    </label>
                    <div className="relative">
                      <input
                        type={showCurrentPw ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        required
                        className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPw(!showCurrentPw)}
                        className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600"
                      >
                        {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      New Password *
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPw ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        minLength={8}
                        className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPw(!showNewPw)}
                        className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600"
                      >
                        {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Confirm New Password *
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirmPw ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={8}
                        className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPw(!showConfirmPw)}
                        className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600"
                      >
                        {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <Button type="submit" loading={passwordSaving}>
                      Update Password
                    </Button>
                  </div>
                </form>
              </Card>

              {/* Active Session Info */}
              <Card>
                <CardHeader
                  title="Current Active Session"
                  subtitle="Details regarding your current authenticated session token."
                />
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-[#E5E7EB]">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-blue-100 text-[#2563EB] rounded-lg">
                        <Smartphone className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Current Web Browser</p>
                        <p className="text-xs text-slate-500">Encrypted JWT Session • Expires in 7 days</p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                      Active Now
                    </span>
                  </div>
                </div>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader title="Security Checklist" subtitle="Password criteria" />
                <ul className="space-y-2.5 text-xs text-slate-600">
                  <li className="flex items-center gap-2">
                    {newPassword.length >= 8 ? (
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-slate-300" />
                    )}
                    Minimum 8 characters
                  </li>
                  <li className="flex items-center gap-2">
                    {/[A-Z]/.test(newPassword) ? (
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-slate-300" />
                    )}
                    Contains uppercase letter
                  </li>
                  <li className="flex items-center gap-2">
                    {/[0-9]/.test(newPassword) ? (
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-slate-300" />
                    )}
                    Contains a number
                  </li>
                  <li className="flex items-center gap-2">
                    {newPassword && newPassword === confirmPassword ? (
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-slate-300" />
                    )}
                    Passwords match
                  </li>
                </ul>
              </Card>

              <Card>
                <div className="space-y-2 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800 text-sm">HIPAA & Audit Trail</p>
                  <p>
                    All password changes, session creations, and login attempts are cryptographically timestamped and
                    saved to the system compliance audit log.
                  </p>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* TAB 4: PREFERENCES */}
        {activeTab === 'preferences' && (
          <form onSubmit={handleSavePreferences} className="space-y-6">
            <Card>
              <CardHeader
                title="Notification Preferences"
                subtitle="Configure when you receive notifications and alerts for billing tasks."
              />
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2 border-b border-[#E5E7EB]">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Claim Assignment Alerts</p>
                    <p className="text-xs text-slate-500">
                      Receive notifications when new AR claims or batches are assigned to your queue.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={assignmentNotifs}
                    onChange={(e) => setAssignmentNotifs(e.target.checked)}
                    className="w-4 h-4 text-[#2563EB] rounded border-gray-300 focus:ring-[#2563EB]"
                  />
                </div>

                <div className="flex items-center justify-between py-2 border-b border-[#E5E7EB]">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Claim Status & Review Updates</p>
                    <p className="text-xs text-slate-500">
                      Get alerted when a claim is approved, rejected, or returned for rework.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={statusNotifs}
                    onChange={(e) => setStatusNotifs(e.target.checked)}
                    className="w-4 h-4 text-[#2563EB] rounded border-gray-300 focus:ring-[#2563EB]"
                  />
                </div>

                <div className="flex items-center justify-between py-2 border-b border-[#E5E7EB]">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Sign-Off & Approval Requests</p>
                    <p className="text-xs text-slate-500">
                      Notifications for adjustment sign-offs, write-offs, or supervisor approvals.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={signoffNotifs}
                    onChange={(e) => setSignoffNotifs(e.target.checked)}
                    className="w-4 h-4 text-[#2563EB] rounded border-gray-300 focus:ring-[#2563EB]"
                  />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Email Notifications</p>
                    <p className="text-xs text-slate-500">
                      Send duplicate critical notices to your verified email address.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={emailNotifs}
                    onChange={(e) => setEmailNotifs(e.target.checked)}
                    className="w-4 h-4 text-[#2563EB] rounded border-gray-300 focus:ring-[#2563EB]"
                  />
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Regional & Display Settings"
                subtitle="Customize date display formats and default table page sizes."
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Date Format
                  </label>
                  <select
                    value={dateFormat}
                    onChange={(e) => setDateFormat(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  >
                    <option value="MM/DD/YYYY">MM/DD/YYYY (US Standard)</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD (ISO Format)</option>
                    <option value="DD/MM/YYYY">DD/MM/YYYY (International)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Timezone
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  >
                    <option value="America/New_York (EST)">Eastern Time (EST/EDT)</option>
                    <option value="America/Chicago (CST)">Central Time (CST/CDT)</option>
                    <option value="America/Denver (MST)">Mountain Time (MST/MDT)</option>
                    <option value="America/Los_Angeles (PST)">Pacific Time (PST/PDT)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Default Table Rows
                  </label>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  >
                    <option value={10}>10 rows per page</option>
                    <option value={25}>25 rows per page</option>
                    <option value={50}>50 rows per page</option>
                    <option value={100}>100 rows per page</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <Button type="submit" loading={saving}>
                  Save Preferences
                </Button>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Session & Security"
                subtitle="Control automatic sign-out to protect patient and billing data when you step away or close the application."
              />
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2 border-b border-[#E5E7EB]">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Log out when closing the tab or browser</p>
                    <p className="text-xs text-slate-500">
                      Immediately ends your server session when this browser tab is closed or refreshed.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={logoutOnClose}
                    onChange={(e) => setLogoutOnClose(e.target.checked)}
                    className="w-4 h-4 text-[#2563EB] rounded border-gray-300 focus:ring-[#2563EB]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Auto-lock after inactivity
                    </label>
                    <select
                      value={sessionTimeoutMinutes}
                      onChange={(e) => {
                        const nextMinutes = Number(e.target.value);
                        setSessionTimeoutMinutes(nextMinutes);
                        if (warnBeforeLockSeconds >= nextMinutes * 60) {
                          setWarnBeforeLockSeconds(
                            nextMinutes * 60 <= 30 ? 15 : nextMinutes * 60 / 2
                          );
                        }
                      }}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                    >
                      {SESSION_INACTIVITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-1">
                      Signing out automatically after {sessionTimeoutMinutes} minute
                      {sessionTimeoutMinutes === 1 ? '' : 's'} without activity.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Warn me before signing out
                    </label>
                    <select
                      value={warnBeforeLockSeconds}
                      onChange={(e) => setWarnBeforeLockSeconds(Number(e.target.value))}
                      disabled={sessionTimeoutMinutes * 60 <= warnBeforeLockSeconds}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      {WARN_BEFORE_LOCK_OPTIONS.filter(
                        (option) => option.value < sessionTimeoutMinutes * 60
                      ).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} before
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-1">
                      {sessionTimeoutMinutes * 60 <= warnBeforeLockSeconds
                        ? 'Warning time must be shorter than the inactivity timeout.'
                        : 'A countdown dialog appears before you are signed out.'}
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-[#2563EB] flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-600 space-y-1">
                    <p className="font-semibold text-slate-800">HIPAA automatic logoff</p>
                    <p>
                      Automatic sign-out events are written to the compliance audit log with the trigger
                      (inactivity or closed session) for review.
                    </p>
                    <p>
                      Activity is detected from mouse, keyboard, scroll, and touch input. Switching browser
                      tabs does not reset the timer.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <Button type="submit" loading={saving}>
                  Save Preferences
                </Button>
              </div>
            </Card>
          </form>
        )}

        {/* TAB 5: ROLE & PERMISSIONS */}
        {activeTab === 'permissions' && (
          <div className="space-y-6">
            <Card>
              <CardHeader
                title="Assigned Role & System Authority"
                subtitle="Your account permissions dictate what operations and datasets you can access."
              />
              <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#2563EB]">
                    Active Role
                  </span>
                  <h3 className="text-lg font-bold text-slate-900 mt-0.5">
                    {user?.roleInfo?.title}
                  </h3>
                  <p className="text-sm text-slate-600 mt-1 max-w-2xl">
                    {user?.roleInfo?.description}
                  </p>
                </div>
                <div className="px-3.5 py-1.5 rounded-lg bg-blue-600 text-white font-semibold text-xs tracking-wide shadow-sm whitespace-nowrap">
                  {user?.roleInfo?.level}
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Granted Permissions */}
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <h3 className="text-base font-bold text-slate-900">
                    Granted Permissions ({permissions?.granted?.length || 0})
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mb-4">
                  Actions you are explicitly permitted to perform within BloomAR Manager.
                </p>

                <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
                  {permissions?.granted?.map((p) => (
                    <div
                      key={p.key}
                      className="p-3 rounded-lg border border-emerald-100 bg-emerald-50/40 flex items-start gap-3"
                    >
                      <Check className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">{p.label}</p>
                          <span className="text-[10px] font-mono uppercase bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded">
                            {p.category}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">{p.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Restricted Permissions */}
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <XCircle className="w-5 h-5 text-slate-400" />
                  <h3 className="text-base font-bold text-slate-900">
                    Restricted Actions ({permissions?.restricted?.length || 0})
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mb-4">
                  Operations that require elevated administrative or supervisor roles.
                </p>

                <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
                  {permissions?.restricted?.map((p) => (
                    <div
                      key={p.key}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-start gap-3 opacity-75"
                    >
                      <Lock className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-700">{p.label}</p>
                          <span className="text-[10px] font-mono uppercase bg-slate-200 text-slate-600 px-1.5 py-0.2 rounded">
                            Restricted
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{p.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
