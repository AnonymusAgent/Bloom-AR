'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';

const inp = 'w-full border rounded-lg px-3 py-2 text-sm';
const lbl = 'block text-xs font-semibold text-slate-500 mt-3';
const card = 'bg-white rounded-xl shadow-sm border p-5';
const btn = 'px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-semibold disabled:opacity-50';
type AccountTab = 'profile' | 'security' | 'preferences' | 'organizations';
const VALID_ACCOUNT_TABS: AccountTab[] = ['profile', 'security', 'preferences', 'organizations'];

function AccountSettingsContent() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<AccountTab>('profile');
  const [profile, setProfile] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  const load = async () => {
    const p = await (await fetch('/api/profile')).json();
    setProfile(p);
    setSessions((await (await fetch('/api/account/sessions')).json()).sessions || []);
    setOrgs((await (await fetch('/api/organizations')).json()).organizations || []);
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const t = searchParams.get('tab') as AccountTab | null;
    if (t && VALID_ACCOUNT_TABS.includes(t)) setTab(t);
  }, [searchParams]);

  if (!profile?.user) {
    return (
      <AppLayout title="Account Settings">
        <div className="p-8 text-sm text-slate-600">Loading account…</div>
      </AppLayout>
    );
  }

  const u = profile.user;
  const prefs = u.preferences || {};
  const saveProfile = async () => {
    const r = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: u.firstName,
        lastName: u.lastName,
        phone: u.phone,
        avatarUrl: u.avatarUrl,
      }),
    });
    setMsg(r.ok ? 'Profile saved.' : 'Failed to save profile.');
  };
  const savePrefs = async (next: any) => {
    const r = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: next }),
    });
    if (r.ok) {
      setProfile({ ...profile, user: { ...u, preferences: next } });
      setMsg('Preferences saved.');
    }
  };
  const tabs: [typeof tab, string][] = [
    ['profile', 'Profile'],
    ['security', 'Security & Sessions'],
    ['preferences', 'Preferences'],
    ['organizations', 'My Organizations'],
  ];

  return (
    <AppLayout title="Account Settings">
      <div className="max-w-3xl mx-auto space-y-5">
        <header>
          <h1 className="text-2xl font-extrabold text-[#0F2D52]">Account Settings</h1>
          <p className="text-sm text-slate-500">
            {u.firstName} {u.lastName} · {u.email} · {profile.user.roleInfo?.title || u.role}
          </p>
        </header>
        <nav className="flex flex-wrap gap-2">
          {tabs.map(([t, l]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                tab === t ? 'bg-[#0F2D52] text-white' : 'bg-white border'
              }`}
            >
              {l}
            </button>
          ))}
        </nav>
        {msg && (
          <p role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-2 text-sm">
            {msg}
          </p>
        )}
        {tab === 'profile' && (
          <section className={card}>
            <h2 className="font-bold">Profile</h2>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className={lbl}>First name</label>
                <input
                  className={inp}
                  value={u.firstName}
                  onChange={(e) => setProfile({ ...profile, user: { ...u, firstName: e.target.value } })}
                />
              </div>
              <div>
                <label className={lbl}>Last name</label>
                <input
                  className={inp}
                  value={u.lastName}
                  onChange={(e) => setProfile({ ...profile, user: { ...u, lastName: e.target.value } })}
                />
              </div>
            </div>
            <label className={lbl}>Email (sign-in identity — contact an admin to change)</label>
            <input className={inp} value={u.email} disabled />
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Phone</label>
                <input
                  className={inp}
                  value={u.phone || ''}
                  onChange={(e) => setProfile({ ...profile, user: { ...u, phone: e.target.value } })}
                />
              </div>
              <div>
                <label className={lbl}>Avatar URL</label>
                <input
                  className={inp}
                  value={u.avatarUrl || ''}
                  onChange={(e) => setProfile({ ...profile, user: { ...u, avatarUrl: e.target.value } })}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Member since {new Date(u.createdAt).toLocaleDateString()} · Last login{' '}
              {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
            </p>
            <button className={`${btn} mt-4`} onClick={saveProfile}>
              Save profile
            </button>
          </section>
        )}
        {tab === 'security' && (
          <>
            <section className={card}>
              <h2 className="font-bold">Change password</h2>
              {[
                ['currentPassword', 'Current password'],
                ['newPassword', 'New password (8+ characters)'],
                ['confirmPassword', 'Confirm new password'],
              ].map(([k, l]) => (
                <div key={k}>
                  <label className={lbl}>{l}</label>
                  <input
                    type="password"
                    className={inp}
                    value={(pw as any)[k]}
                    onChange={(e) => setPw({ ...pw, [k]: e.target.value })}
                  />
                </div>
              ))}
              <button
                className={`${btn} mt-4`}
                onClick={async () => {
                  const r = await fetch('/api/profile/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(pw),
                  });
                  const d = await r.json();
                  setMsg(r.ok ? d.message : d.error);
                }}
              >
                Change password
              </button>
            </section>
            <section className={card}>
              <h2 className="font-bold">Active sessions</h2>
              <ul className="text-sm mt-2 space-y-2">
                {sessions.map((s) => (
                  <li key={s.id} className="flex justify-between border rounded-lg p-3">
                    <span>
                      Signed in {new Date(s.createdAt).toLocaleString()} · expires{' '}
                      {new Date(s.expiresAt).toLocaleDateString()}{' '}
                      {s.current && <b className="text-emerald-600">(this device)</b>}
                    </span>
                    {!s.current && (
                      <button
                        className="text-red-600"
                        onClick={async () => {
                          await fetch('/api/account/sessions', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sessionId: s.id }),
                          });
                          load();
                        }}
                      >
                        Sign out
                      </button>
                    )}
                  </li>
                ))}
                {!sessions.length && <li className="text-slate-500">No active sessions found.</li>}
              </ul>
              <button
                className="px-4 py-2 border rounded-lg text-sm mt-3"
                onClick={async () => {
                  await fetch('/api/account/sessions', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ all: true }),
                  });
                  setMsg('All other sessions signed out.');
                  load();
                }}
              >
                Sign out all other devices
              </button>
              <div className="flex gap-3 mt-4">
                <a href="/forgot-password" className="text-sm text-[#2563EB]">
                  Forgot password?
                </a>
                <a href="/verify-email" className="text-sm text-[#2563EB]">
                  Resend email verification
                </a>
              </div>
            </section>
          </>
        )}
        {tab === 'preferences' && (
          <section className={card}>
            <h2 className="font-bold">Preferences</h2>
            <label className={lbl}>Date format</label>
            <select
              className={inp}
              value={prefs.dateFormat || 'MM/DD/YYYY'}
              onChange={(e) => savePrefs({ ...prefs, dateFormat: e.target.value })}
            >
              {['MM/DD/YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <label className={lbl}>Timezone</label>
            <select
              className={inp}
              value={prefs.timezone || 'America/New_York (EST)'}
              onChange={(e) => savePrefs({ ...prefs, timezone: e.target.value })}
            >
              {[
                'America/New_York (EST)',
                'America/Chicago (CST)',
                'America/Denver (MST)',
                'America/Los_Angeles (PST)',
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <label className={lbl}>Rows per page</label>
            <select
              className={inp}
              value={prefs.pageSize || 25}
              onChange={(e) => savePrefs({ ...prefs, pageSize: +e.target.value })}
            >
              {[10, 25, 50, 100].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-3">
              Notification &amp; inactivity-lock preferences are available on{' '}
              <a className="text-[#2563EB]" href="/profile">
                My Profile &amp; Settings
              </a>
              .
            </p>
          </section>
        )}
        {tab === 'organizations' && (
          <section className={card}>
            <h2 className="font-bold">My organizations</h2>
            <ul className="text-sm mt-2 space-y-2">
              {orgs.map((o) => (
                <li key={o.id} className="border rounded-lg p-3 flex justify-between">
                  <span>
                    <b>{o.name}</b> ({o.slug}) — {o.status}
                  </span>
                  <a className="text-[#2563EB]" href="/settings/organization">
                    Manage
                  </a>
                </li>
              ))}
              {!orgs.length && (
                <li className="text-slate-500">
                  You are not a member of any organization yet.{' '}
                  <a className="text-[#2563EB]" href="/settings/organization">
                    Create one
                  </a>
                </li>
              )}
            </ul>
            <div className="flex gap-3 mt-4">
              <a href="/settings/organization" className="text-sm text-[#2563EB] font-semibold">
                Organization settings &amp; team →
              </a>
              <a href="/settings/billing" className="text-sm text-[#2563EB] font-semibold">
                Billing &amp; plan →
              </a>
              <a href="/onboarding" className="text-sm text-[#2563EB] font-semibold">
                Onboarding →
              </a>
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
}

export default function AccountSettings() {
  return (
    <Suspense
      fallback={
        <AppLayout title="Account Settings">
          <div className="p-8 text-sm text-slate-600">Loading account…</div>
        </AppLayout>
      }
    >
      <AccountSettingsContent />
    </Suspense>
  );
}
