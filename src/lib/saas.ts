import crypto from 'crypto';
import { db } from '@/db';
import {
  plans,
  subscriptions,
  organizations,
  organizationDomains,
  organizationMembers,
  practices,
  claims,
  siteSettings,
} from '@/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { DEFAULT_PLAN_CATALOG } from './plans-shared';

export { DEFAULT_PLAN_CATALOG as DEFAULT_PLANS } from './plans-shared';

export const RESERVED_SLUGS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'login',
  'register',
  'pricing',
  'features',
  'about',
  'contact',
  'faq',
  'dashboard',
  'support',
  'billing',
  'mail',
  'vercel',
  'ar-manager',
  'bloomar',
  'bloomar-manager',
  'bloom',
]);

export type SubscriptionLifecycleState =
  | 'active'
  | 'trialing'
  | 'past_due_grace'
  | 'past_due_locked'
  | 'expired'
  | 'cancelled';

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function validateSlug(slug: string) {
  return /^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

export function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(t: string) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

export const appUrl = () =>
  (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000').replace(
    /\/$/,
    ''
  );

export const rootDomain = () => process.env.NEXT_PUBLIC_ROOT_DOMAIN || '';

export async function ensureDefaultPlans() {
  const existing = await db.select().from(plans);
  if (existing.length) return existing;
  await db.insert(plans).values(
    DEFAULT_PLAN_CATALOG.map((p, idx) => ({
      slug: p.slug,
      name: p.name,
      description: p.description,
      monthlyPriceCents: p.monthlyPriceCents,
      annualPriceCents: p.annualPriceCents,
      trialDays: p.trialDays,
      features: p.features,
      limits: p.limits,
      sortOrder: idx,
    })) as never
  );
  return db.select().from(plans);
}

export function evaluateSubscriptionState(
  sub: typeof subscriptions.$inferSelect | null,
  orgStatus = 'active'
): {
  lifecycleState: SubscriptionLifecycleState;
  canRead: boolean;
  canMutate: boolean;
  readOnlyReason: string | null;
} {
  if (orgStatus === 'suspended') {
    return {
      lifecycleState: 'cancelled',
      canRead: false,
      canMutate: false,
      readOnlyReason: 'Organization workspace is suspended.',
    };
  }

  if (!sub) {
    return {
      lifecycleState: 'trialing',
      canRead: true,
      canMutate: true,
      readOnlyReason: null,
    };
  }

  const now = Date.now();
  const status = (sub.status || 'trialing').toLowerCase();

  if (status === 'active') {
    if (
      sub.currentPeriodEnd &&
      sub.cancelAtPeriodEnd &&
      new Date(sub.currentPeriodEnd).getTime() < now
    ) {
      return {
        lifecycleState: 'cancelled',
        canRead: true,
        canMutate: false,
        readOnlyReason:
          'Subscription ended at the close of the billing period. Workspace is in read-only mode until renewed.',
      };
    }
    return { lifecycleState: 'active', canRead: true, canMutate: true, readOnlyReason: null };
  }

  if (status === 'trialing') {
    if (sub.trialEnd && new Date(sub.trialEnd).getTime() < now) {
      return {
        lifecycleState: 'expired',
        canRead: true,
        canMutate: false,
        readOnlyReason:
          'Trial period has ended. Upgrade your plan in Billing Settings to create or edit records.',
      };
    }
    return { lifecycleState: 'trialing', canRead: true, canMutate: true, readOnlyReason: null };
  }

  if (status === 'past_due') {
    const graceEnd = sub.gracePeriodEndsAt
      ? new Date(sub.gracePeriodEndsAt).getTime()
      : sub.pastDueSince
      ? new Date(sub.pastDueSince).getTime() + 7 * 24 * 60 * 60 * 1000
      : now + 7 * 24 * 60 * 60 * 1000;
    if (graceEnd >= now) {
      return {
        lifecycleState: 'past_due_grace',
        canRead: true,
        canMutate: true,
        readOnlyReason: null,
      };
    }
    return {
      lifecycleState: 'past_due_locked',
      canRead: true,
      canMutate: false,
      readOnlyReason:
        'Subscription payment is past due beyond the 7-day grace window. Workspace is in read-only mode.',
    };
  }

  return {
    lifecycleState: status === 'cancelled' || status === 'canceled' ? 'cancelled' : 'expired',
    canRead: true,
    canMutate: false,
    readOnlyReason:
      'Subscription is inactive. Workspace is in read-only export/view mode until reactivated.',
  };
}

/** Central entitlement check — server-side only. Never trust plan names from the client. */
export async function getEntitlements(organizationId: string) {
  await ensureDefaultPlans();
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return null;

  let plan: typeof plans.$inferSelect | null = null;
  if (sub?.planId) {
    const [p] = await db.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
    plan = p ?? null;
  }
  if (!plan) {
    const [starter] = await db.select().from(plans).where(eq(plans.slug, 'starter')).limit(1);
    plan = starter ?? null;
  }

  const [{ seatCount }] = await db
    .select({ seatCount: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.isActive, true)
      )
    );

  const [{ practiceCount }] = await db
    .select({ practiceCount: sql<number>`count(*)::int` })
    .from(practices)
    .where(eq(practices.organizationId, organizationId));

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [{ claimsThisMonth }] = await db
    .select({ claimsThisMonth: sql<number>`count(*)::int` })
    .from(claims)
    .where(
      and(eq(claims.organizationId, organizationId), gte(claims.createdAt, startOfMonth))
    );

  const subEval = evaluateSubscriptionState(sub ?? null, org.status);
  const limits = (plan?.limits as { seats?: number; claimsPerMonth?: number }) ?? {
    seats: 5,
    claimsPerMonth: 1000,
  };
  const features = (plan?.features as string[]) ?? [];

  return {
    org,
    subscription: sub ?? null,
    plan,
    active: subEval.canMutate,
    grace: subEval.lifecycleState === 'past_due_grace',
    lifecycleState: subEval.lifecycleState,
    canRead: subEval.canRead,
    canMutate: subEval.canMutate,
    readOnlyReason: subEval.readOnlyReason,
    limits,
    features,
    usage: {
      seatsUsed: seatCount,
      seatsLimit: limits.seats ?? 5,
      practicesCount: practiceCount,
      claimsThisMonth,
      claimsLimit: limits.claimsPerMonth ?? 1000,
    },
    canAddSeat: !limits.seats || seatCount < limits.seats,
    canCreateClaim: !limits.claimsPerMonth || claimsThisMonth < limits.claimsPerMonth,
  };
}

/** Resolve tenant from a hostname: verified custom domain, or <slug>.<rootDomain>. Slug alone is never authorization. */
export async function resolveTenantByHostname(hostname: string) {
  const host = hostname.split(':')[0].toLowerCase();
  const [domain] = await db
    .select()
    .from(organizationDomains)
    .where(eq(organizationDomains.hostname, host))
    .limit(1);
  if (domain) {
    if (domain.verificationStatus !== 'verified') return { error: 'domain_not_verified' as const };
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, domain.organizationId))
      .limit(1);
    return org && org.status !== 'suspended' ? { org, domain } : { error: 'org_inactive' as const };
  }
  const root = rootDomain();
  if (root && host.endsWith('.' + root)) {
    const slug = host.slice(0, -(root.length + 1));
    if (slug && !slug.includes('.')) {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);
      if (org) return org.status !== 'suspended' ? { org } : { error: 'org_inactive' as const };
    }
  }
  return { error: 'unknown_host' as const };
}

export async function isMaintenanceMode(): Promise<{ enabled: boolean; message: string }> {
  try {
    const [row] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, 'maintenance_mode'));
    if (!row) return { enabled: false, message: '' };
    const val = row.value as { enabled?: boolean; message?: string };
    return {
      enabled: Boolean(val?.enabled),
      message: val?.message || 'Scheduled maintenance in progress.',
    };
  } catch {
    return { enabled: false, message: '' };
  }
}
