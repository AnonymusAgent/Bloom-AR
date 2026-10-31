import { MarketingShell, H1 } from '@/components/marketing/Marketing';
import { getSiteContent } from '@/lib/site-content';
import PricingClient from '@/components/marketing/PricingClient';
import { DEFAULT_PLAN_CATALOG, type PlanCatalogItem } from '@/lib/plans-shared';
import { db } from '@/db';
import { plans as plansTable } from '@/db/schema';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pricing — BloomAR Manager', description: 'Starter, Professional and Enterprise plans for medical billing and AR management. Start a free trial, no card required.' };

async function loadPlans(): Promise<{ plans: PlanCatalogItem[]; source: 'live' | 'catalog' }> {
  try {
    const rows = (await db.select().from(plansTable)).filter(r => r.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
    if (!rows.length) return { plans: DEFAULT_PLAN_CATALOG, source: 'catalog' };
    // Merge DB pricing/features over the catalog so copy like "best for" is never lost.
    return { source: 'live', plans: rows.map(r => {
      const base = DEFAULT_PLAN_CATALOG.find(c => c.slug === r.slug);
      return { slug: r.slug, name: r.name, description: r.description || base?.description || '', bestFor: base?.bestFor || '',
        monthlyPriceCents: r.monthlyPriceCents, annualPriceCents: r.annualPriceCents, trialDays: r.trialDays,
        features: (Array.isArray(r.features) && r.features.length ? r.features as string[] : base?.features || []),
        limits: (r.limits as PlanCatalogItem['limits']) || base?.limits || { seats: 5, claimsPerMonth: 1000 },
        highlight: r.slug === 'professional', cta: base?.cta || 'Start free trial' };
    }) };
  } catch { return { plans: DEFAULT_PLAN_CATALOG, source: 'catalog' }; }
}
export default async function Page() {
  const [c, { plans, source }] = await Promise.all([getSiteContent(), loadPlans()]);
  return <MarketingShell content={c}><section className="mkt-hero-bg"><div className="mx-auto max-w-6xl px-5 py-14">
    <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Pricing</p>
    <div className="mt-2 max-w-2xl"><H1>Simple pricing that pays for itself in recovered AR.</H1></div>
    <p className="mt-4 max-w-2xl text-lg text-slate-600">Pick a plan, start your free trial in minutes, and give your team the full AR workspace below. No setup fees, no card to try, cancel anytime.</p>
    <PricingClient plans={plans} source={source} />
  </div></section></MarketingShell>;
}
