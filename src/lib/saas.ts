import crypto from 'crypto';
import { db } from '@/db';
import { plans, subscriptions, organizations, organizationDomains } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const RESERVED_SLUGS = new Set(['www','app','api','admin','login','register','pricing','features','about','contact','faq','dashboard','support','billing','mail','vercel','ar-manager','bloomar','bloomar-manager','bloom']);
export function slugify(input: string) { return input.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60); }
export function validateSlug(slug: string) { return /^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$/.test(slug) && !RESERVED_SLUGS.has(slug); }
export function makeToken() { return crypto.randomBytes(32).toString('hex'); }
export function hashToken(t: string) { return crypto.createHash('sha256').update(t).digest('hex'); }
export const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/,'');
export const rootDomain = () => process.env.NEXT_PUBLIC_ROOT_DOMAIN || ''; // e.g. bloomar-manager.vercel.app

import { DEFAULT_PLAN_CATALOG } from './plans-shared';
export { DEFAULT_PLAN_CATALOG as DEFAULT_PLANS } from './plans-shared';
export async function ensureDefaultPlans() {
  const existing = await db.select().from(plans);
  if (existing.length) return existing;
  await db.insert(plans).values(DEFAULT_PLAN_CATALOG.map(p=>({ slug:p.slug, name:p.name, description:p.description, monthlyPriceCents:p.monthlyPriceCents, annualPriceCents:p.annualPriceCents, trialDays:p.trialDays, features:p.features, limits:p.limits })) as never);
  return db.select().from(plans);
}
/** Central entitlement check — server-side only. Never trust plan names from the client. */
export async function getEntitlements(organizationId: string) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return null;
  let plan = null as null | typeof plans.$inferSelect;
  if (sub?.planId) { const [p] = await db.select().from(plans).where(eq(plans.id, sub.planId)).limit(1); plan = p ?? null; }
  const status = sub?.status ?? org.status;
  const active = ['trialing','active','past_due'].includes(status) && org.status !== 'suspended';
  const grace = status === 'past_due'; // grace period: keep data, warn, don't delete
  return { org, subscription: sub ?? null, plan, active, grace, limits: (plan?.limits as {seats?:number;claimsPerMonth?:number}) ?? {seats:5}, features: (plan?.features as string[]) ?? [] };
}
/** Resolve tenant from a hostname: verified custom domain, or <slug>.<rootDomain>. Slug alone is never authorization. */
export async function resolveTenantByHostname(hostname: string) {
  const host = hostname.split(':')[0].toLowerCase();
  const [domain] = await db.select().from(organizationDomains).where(eq(organizationDomains.hostname, host)).limit(1);
  if (domain) {
    if (domain.verificationStatus !== 'verified') return { error: 'domain_not_verified' as const };
    const [org] = await db.select().from(organizations).where(eq(organizations.id, domain.organizationId)).limit(1);
    return org && org.status !== 'suspended' ? { org, domain } : { error: 'org_inactive' as const };
  }
  const root = rootDomain();
  if (root && host.endsWith('.' + root)) {
    const slug = host.slice(0, -(root.length + 1));
    if (slug && !slug.includes('.')) {
      const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
      if (org) return org.status !== 'suspended' ? { org } : { error: 'org_inactive' as const };
    }
  }
  return { error: 'unknown_host' as const };
}
