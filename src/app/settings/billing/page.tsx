'use client';
import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';

export default function BillingSettingsPage() {
  const [data, setData] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [orgRes, plansRes] = await Promise.all([fetch('/api/organizations'), fetch('/api/plans')]);
        const o = await orgRes.json();
        const p = await plansRes.json();
        setPlans(p.plans || []);
        const org = o.organizations?.[0];
        if (org) {
          const e = await (await fetch(`/api/subscriptions/me?organizationId=${org.id}`)).json();
          setData({ ...e, org });
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  if (!loaded) {
    return (
      <AppLayout title="Billing & Plan">
        <div className="p-8 text-sm text-slate-600">Loading billing…</div>
      </AppLayout>
    );
  }

  if (!data?.org) {
    return (
      <AppLayout title="Billing & Plan">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-sm border p-6 space-y-3">
          <h1 className="text-xl font-bold text-[#0F2D52]">Billing &amp; Plan</h1>
          <p className="text-sm text-slate-600">
            Create or join an organization workspace first to manage subscriptions and plan limits.
          </p>
          <a
            href="/settings/organization"
            className="inline-block px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-semibold"
          >
            Set up organization →
          </a>
        </div>
      </AppLayout>
    );
  }

  const ent = data.entitlements;
  return (
    <AppLayout title="Billing & Plan">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border p-6">
        <h1 className="text-xl font-bold text-[#0F2D52]">Billing — {data.org.name}</h1>
        <p className="text-sm mt-2">
          Current plan: <b>{ent?.plan?.name || '—'}</b> · Status:{' '}
          <b>{ent?.subscription?.status || data.org.status}</b>
          {ent?.subscription?.trialEnd && (
            <> · Trial ends {new Date(ent.subscription.trialEnd).toLocaleDateString()}</>
          )}
        </p>
        {!data.paymentsConfigured && (
          <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3">
            Online checkout is not configured on this deployment yet (payment provider keys missing). No charge can be made — your trial continues. Operator: see docs/SAAS_SETUP.md.
          </p>
        )}
        <div className="grid md:grid-cols-3 gap-4 mt-5">
          {plans.map((p) => (
            <div key={p.id} className="border rounded-xl p-4 flex flex-col justify-between">
              <div>
                <b>{p.name}</b>
                <p className="text-sm text-slate-600 mt-1">
                  ${(p.monthlyPriceCents / 100).toLocaleString()}/mo
                </p>
              </div>
              <button
                className="mt-3 px-3 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-semibold"
                onClick={async () => {
                  const r = await fetch('/api/subscriptions/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      organizationId: data.org.id,
                      planSlug: p.slug,
                      interval: 'monthly',
                    }),
                  });
                  const d = await r.json();
                  if (d.url) window.location.href = d.url;
                  else setMsg(d.error);
                }}
              >
                Subscribe / change plan
              </button>
            </div>
          ))}
        </div>
        {msg && (
          <p role="status" className="text-sm mt-4 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            {msg}
          </p>
        )}
        <p className="text-xs text-slate-500 mt-4">
          Paid plans activate only after the payment provider confirms via webhook — returning from checkout alone never activates a subscription.
        </p>
      </div>
    </AppLayout>
  );
}
