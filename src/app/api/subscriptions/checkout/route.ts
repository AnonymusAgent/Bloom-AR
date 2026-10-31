import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { plans } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { requireMembership } from '@/lib/tenant';
import { appUrl, ensureDefaultPlans } from '@/lib/saas';
import { cleanUuid } from '@/lib/sanitize';
/**
 * Stripe Checkout — created server-side. If Stripe is not configured we return
 * an honest 503 (never fake a successful payment). Set STRIPE_SECRET_KEY and
 * per-plan stripe price ids (platform admin → Plans) to enable.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const reqBody = await req.json();
  const organizationId = cleanUuid(reqBody.organizationId);
  const { planSlug, interval } = reqBody;
  if (!organizationId) return NextResponse.json({ error: 'Valid organizationId required' }, { status: 400 });
  if (!await requireMembership(user.id, organizationId, ['owner','super_admin'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await ensureDefaultPlans();
  const [plan] = await db.select().from(plans).where(eq(plans.slug, planSlug)).limit(1);
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: 'Payments are not configured yet. Add STRIPE_SECRET_KEY (and Stripe price IDs on the plan) — see docs/SAAS_SETUP.md. Your trial remains active; no charge was made.', code: 'payments_not_configured' }, { status: 503 });
  const priceId = interval === 'annual' ? plan.stripeAnnualPriceId : plan.stripeMonthlyPriceId;
  if (!priceId) return NextResponse.json({ error: 'This plan has no Stripe price configured yet.', code: 'price_not_configured' }, { status: 503 });
  const body = new URLSearchParams({
    mode: 'subscription', 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1',
    success_url: `${appUrl()}/settings/billing?checkout=success`, cancel_url: `${appUrl()}/pricing?checkout=cancelled`,
    'metadata[organizationId]': organizationId, 'metadata[planId]': plan.id, customer_email: user.email,
    'subscription_data[metadata][organizationId]': organizationId, 'subscription_data[metadata][planId]': plan.id,
  });
  if (plan.trialDays) body.set('subscription_data[trial_period_days]', String(plan.trialDays));
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await r.json();
  if (!r.ok) return NextResponse.json({ error: data?.error?.message || 'Stripe checkout failed' }, { status: 502 });
  return NextResponse.json({ url: data.url });
}
