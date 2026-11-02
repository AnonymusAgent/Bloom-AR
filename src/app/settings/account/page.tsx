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
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [mfa, setMfa] = useState<{ enabled: boolean; verifiedAt?: string | null }>({
    enabled: false,
  });
  const [mfaSetup, setMfaSetup] = useState<{
    secret: string;
    otpauthUri: string;
    recoveryCodes?: string[];
  } | null>(null);
  const [issuedRecoveryCodes, setIssuedRecoveryCodes] = useState<string[] | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [disableMfaPassword, setDisableMfaPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  const load = async () => {
    const p = await (await fetch('/api/profile')).json();
    setProfile(p);
    setSessions((await (await fetch('/api/account/sessions')).json()).sessions || []);
    const orgData = await (await fetch('/api/organizations')).json();
    setOrgs(orgData.organizations || []);
    setActiveOrgId(orgData.activeOrganizationId || null);
    const mfaRes = await fetch('/api/account/mfa');
    if (mfaRes.ok) {
      setMfa(await mfaRes.json());
    }
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
    ['security', 'Security, MFA & Sessions'],
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
          <p
            role="status"
            className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-2 text-sm"
          >
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
                  onChange={(e) =>
                    setProfile({ ...profile, user: { ...u, firstName: e.target.value } })
                  }
                />
              </div>
              <div>
                <label className={lbl}>Last name</label>
                <input
                  className={inp}
                  value={u.lastName}
                  onChange={(e) =>
                    setProfile({ ...profile, user: { ...u, lastName: e.target.value } })
                  }
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
                  onChange={(e) =>
                    setProfile({ ...profile, user: { ...u, phone: e.target.value } })
                  }
                />
              </div>
              <div>
                <label className={lbl}>Avatar URL</label>
                <input
                  className={inp}
                  value={u.avatarUrl || ''}
                  onChange={(e) =>
                    setProfile({ ...profile, user: { ...u, avatarUrl: e.target.value } })
                  }
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
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold">Two-Factor Authentication (TOTP MFA)</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Protect healthcare workspace sign-ins with RFC 6238 authenticator codes and
                    backup recovery codes.
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    mfa.enabled
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {mfa.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>

              {!mfa.enabled && !mfaSetup && (
                <button
                  className={`${btn} mt-4`}
                  onClick={async () => {
                    const r = await fetch('/api/account/mfa', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'setup' }),
                    });
                    const d = await r.json();
                    if (r.ok) {
                      setMfaSetup(d);
                      setMsg('Enter a 6-digit code from your authenticator app to activate MFA.');
                    } else {
                      setMsg(d.error || 'Failed to start MFA setup.');
                    }
                  }}
                >
                  Set up Authenticator App
                </button>
              )}

              {mfaSetup && !mfa.enabled && (
                <div className="mt-4 space-y-3 bg-slate-50 border rounded-lg p-4">
                  <p className="text-xs font-semibold text-slate-700">
                    1. Add this setup key to your authenticator app (Google Authenticator, 1Password,
                    Authy, Microsoft Authenticator):
                  </p>
                  <code className="block bg-white border rounded px-3 py-2 text-xs font-mono select-all">
                    {mfaSetup.secret}
                  </code>
                  <div>
                    <label className={lbl}>2. Enter 6-digit code to verify &amp; enable</label>
                    <div className="flex gap-2 mt-1">
                      <input
                        className={inp}
                        placeholder="123456"
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value)}
                      />
                      <button
                        className={btn}
                        onClick={async () => {
                          const r = await fetch('/api/account/mfa', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'verify', code: mfaCode }),
                          });
                          const d = await r.json();
                          if (r.ok) {
                            setMfaSetup(null);
                            setMfaCode('');
                            setIssuedRecoveryCodes(d.recoveryCodes || null);
                            setMsg(
                              'Two-factor authentication is now enabled. Save your recovery codes below!'
                            );
                            load();
                          } else {
                            setMsg(d.error || 'Invalid verification code.');
                          }
                        }}
                      >
                        Enable MFA
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {issuedRecoveryCodes && issuedRecoveryCodes.length > 0 && (
                <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
                  <p className="text-xs font-bold text-amber-900">
                    Save these one-time recovery codes in a safe place (shown only once):
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {issuedRecoveryCodes.map((rc) => (
                      <code
                        key={rc}
                        className="bg-white border rounded px-2 py-1 text-center text-xs font-mono"
                      >
                        {rc}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {mfa.enabled && (
                <div className="mt-4 pt-3 border-t space-y-2">
                  <label className={lbl}>Confirm account password to disable MFA</label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      className={inp}
                      placeholder="Current password"
                      value={disableMfaPassword}
                      onChange={(e) => setDisableMfaPassword(e.target.value)}
                    />
                    <button
                      className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold whitespace-nowrap"
                      onClick={async () => {
                        const r = await fetch('/api/account/mfa', {
                          method: 'DELETE',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ password: disableMfaPassword }),
                        });
                        const d = await r.json();
                        if (r.ok) {
                          setDisableMfaPassword('');
                          setMsg('MFA disabled.');
                          load();
                        } else {
                          setMsg(d.error || 'Could not disable MFA.');
                        }
                      }}
                    >
                      Disable MFA
                    </button>
                  </div>
                </div>
              )}
            </section>

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
              {orgs.map((o) => {
                const isActiveOrg = o.id === activeOrgId;
                return (
                  <li
                    key={o.id}
                    className="border rounded-lg p-3 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <b>{o.name}</b> ({o.slug}) — {o.status}
                      {o.orgRole && (
                        <span className="ml-2 text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold uppercase">
                          {o.orgRole.replace(/_/g, ' ')}
                        </span>
                      )}
                      {isActiveOrg && (
                        <span className="ml-2 text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">
                          Active workspace
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {!isActiveOrg && (
                        <button
                          className="text-[#2563EB] font-semibold"
                          onClick={async () => {
                            const r = await fetch('/api/organizations/switch', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ organizationId: o.id }),
                            });
                            if (r.ok) window.location.reload();
                          }}
                        >
                          Switch workspace
                        </button>
                      )}
                      <a className="text-[#2563EB]" href="/settings/organization">
                        Manage
                      </a>
                    </div>
                  </li>
                );
              })}
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
