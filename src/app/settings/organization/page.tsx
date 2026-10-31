'use client';
import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';

export default function OrganizationSettingsPage() {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [org, setOrg] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [domains, setDomains] = useState<any[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [host, setHost] = useState('');
  const [msg, setMsg] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [creating, setCreating] = useState(false);

  const loadDetails = async (o: any) => {
    if (!o) return;
    const i = await (await fetch(`/api/organizations/${o.id}/invitations`)).json();
    setMembers(i.members || []);
    setInvites(i.invitations || []);
    const d = await (await fetch(`/api/organizations/${o.id}/domains`)).json();
    setDomains(d.domains || []);
  };

  const loadOrgs = async () => {
    try {
      const r = await fetch('/api/organizations');
      const d = await r.json();
      const list = d.organizations || [];
      setOrgs(list);
      const active = list[0] || null;
      setOrg(active);
      if (active) await loadDetails(active);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    loadOrgs();
  }, []);

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) return;
    setCreating(true);
    setMsg('');
    try {
      const slug =
        newOrgSlug.trim() ||
        newOrgName
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-|-$/g, '');
      const r = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newOrgName.trim(), slug }),
      });
      const d = await r.json();
      if (r.ok && d.organization) {
        setNewOrgName('');
        setNewOrgSlug('');
        setMsg(`Organization "${d.organization.name}" created.`);
        await loadOrgs();
      } else {
        setMsg(d.error || 'Failed to create organization.');
      }
    } finally {
      setCreating(false);
    }
  };

  if (!loaded) {
    return (
      <AppLayout title="Organization & Team">
        <div className="p-8 text-sm text-slate-600">Loading organization…</div>
      </AppLayout>
    );
  }

  if (!org) {
    return (
      <AppLayout title="Organization & Team">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-sm border p-6 space-y-4">
          <h1 className="text-xl font-bold text-[#0F2D52]">Create your organization workspace</h1>
          <p className="text-sm text-slate-600">
            Your account is not linked to an organization yet. Create one below to manage team invitations, billing, and custom domains.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Organization Name</label>
              <input
                aria-label="Organization name"
                placeholder="Metro Family Medicine Group"
                value={newOrgName}
                onChange={(e) => {
                  setNewOrgName(e.target.value);
                  if (!newOrgSlug) {
                    setNewOrgSlug(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]+/g, '-')
                        .replace(/^-|-$/g, '')
                    );
                  }
                }}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Workspace Slug</label>
              <input
                aria-label="Organization slug"
                placeholder="metro-family-medicine"
                value={newOrgSlug}
                onChange={(e) => setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <button
              disabled={creating || !newOrgName.trim()}
              onClick={handleCreateOrg}
              className="px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create organization'}
            </button>
          </div>
          {msg && <p role="status" className="text-sm text-red-600">{msg}</p>}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Organization & Team">
      <div className="max-w-3xl mx-auto space-y-6">
        <section className="bg-white rounded-2xl shadow-sm border p-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#0F2D52]">{org.name} — settings</h1>
            <p className="text-sm text-slate-600">
              Slug: {org.slug} · Status: {org.status} · Timezone: {org.timezone || '—'}
            </p>
          </div>
          {orgs.length > 1 && (
            <select
              aria-label="Switch organization"
              value={org.id}
              onChange={(e) => {
                const next = orgs.find((x) => x.id === e.target.value);
                if (next) {
                  setOrg(next);
                  loadDetails(next);
                }
              }}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.slug})
                </option>
              ))}
            </select>
          )}
        </section>

        <section className="bg-white rounded-2xl shadow-sm border p-6">
          <h2 className="font-bold text-slate-900">Team Members ({members.length})</h2>
          <ul className="text-sm mt-3 space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between border rounded-lg px-3 py-2">
                <span>
                  <b>
                    {m.firstName || m.lastName
                      ? `${m.firstName || ''} ${m.lastName || ''}`.trim()
                      : m.email || m.userId}
                  </b>
                  {m.email && <span className="text-slate-500 ml-2">{m.email}</span>}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                  {m.orgRole}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm font-medium mt-4">
            Pending invitations: {invites.filter((i) => !i.acceptedAt).length}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <input
              aria-label="Invite email"
              type="email"
              placeholder="teammate@practice.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border rounded-lg px-3 py-2 flex-1 min-w-[200px] text-sm"
            />
            <select
              aria-label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option>member</option>
              <option>manager</option>
              <option>admin</option>
              <option>read_only</option>
            </select>
            <button
              className="px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-semibold"
              onClick={async () => {
                const r = await fetch(`/api/organizations/${org.id}/invitations`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email, orgRole: role }),
                });
                const d = await r.json();
                setMsg(
                  r.ok
                    ? `Invitation created (${
                        d.emailDelivery === 'not_configured'
                          ? `email not configured — share link directly: ${d.inviteUrl}`
                          : 'email sent'
                      })`
                    : d.error
                );
                if (r.ok) setEmail('');
                loadDetails(org);
              }}
            >
              Invite
            </button>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border p-6">
          <h2 className="font-bold text-slate-900">Custom domain</h2>
          <p className="text-sm text-slate-600 mt-1">
            Add a hostname you own, publish the TXT record shown, then Verify. After verification you must also add the domain in your hosting provider so HTTPS is provisioned — verification alone does not activate hosting.
          </p>
          <div className="flex gap-2 mt-3">
            <input
              aria-label="Hostname"
              placeholder="billing.example.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="border rounded-lg px-3 py-2 flex-1 text-sm"
            />
            <button
              className="px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-semibold"
              onClick={async () => {
                const r = await fetch(`/api/organizations/${org.id}/domains`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ hostname: host }),
                });
                const d = await r.json();
                setMsg(r.ok ? `Add TXT ${d.dnsRecord.host} = ${d.dnsRecord.value}` : d.error);
                if (r.ok) setHost('');
                loadDetails(org);
              }}
            >
              Add domain
            </button>
          </div>
          <ul className="text-sm mt-4 space-y-2">
            {domains.map((d) => (
              <li key={d.id} className="border rounded-lg p-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b>{d.hostname}</b> — {d.verificationStatus} · hosting: {d.hostingStatus} · TLS: {d.tlsStatus}
                  {d.dnsRecord && (
                    <div className="text-xs mt-1 text-slate-500">
                      TXT {d.dnsRecord.host} = {d.dnsRecord.value}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    className="text-[#2563EB] font-medium"
                    onClick={async () => {
                      const r = await fetch(`/api/organizations/${org.id}/domains`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ hostname: d.hostname, action: 'verify' }),
                      });
                      const x = await r.json();
                      setMsg(x.message || x.error);
                      loadDetails(org);
                    }}
                  >
                    Verify DNS
                  </button>
                  <button
                    className="text-red-600 font-medium"
                    onClick={async () => {
                      const r = await fetch(`/api/organizations/${org.id}/domains?domainId=${d.id}`, {
                        method: 'DELETE',
                      });
                      if (r.ok) {
                        setMsg(`Removed domain ${d.hostname}`);
                        loadDetails(org);
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {msg && (
          <p role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-4 text-sm">
            {msg}
          </p>
        )}
      </div>
    </AppLayout>
  );
}
