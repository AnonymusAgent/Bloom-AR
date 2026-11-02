import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/db';
import { subscriptions, processedWebhooks, billingInvoices } from '@/db/schema';
import { eq } from 'drizzle-orm';

// Stripe webhook: verify signature (HMAC), idempotent via processed_webhooks.
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get('stripe-signature') || '';
  const parts = Object.fromEntries(sig.split(',').map((p) => p.split('=') as [string, string]));
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');

  if (
    !parts.t ||
    !parts.v1 ||
    expected.length !== parts.v1.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const event = JSON.parse(raw);
  const [seen] = await db
    .select()
    .from(processedWebhooks)
    .where(eq(processedWebhooks.id, event.id))
    .limit(1);
  if (seen) return NextResponse.json({ received: true, duplicate: true });

  await db.insert(processedWebhooks).values({
    id: event.id,
    provider: 'stripe',
    type: event.type,
  });

  const obj = event.data?.object || {};
  const orgId = obj.metadata?.organizationId || obj.subscription_details?.metadata?.organizationId;
  const planId = obj.metadata?.planId;

  if (
    orgId &&
    [
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
    ].includes(event.type)
  ) {
    const status = obj.status || 'active';
    const [ex] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, orgId))
      .limit(1);
    const vals = {
      planId: planId || ex?.planId || null,
      billingProvider: 'stripe',
      externalCustomerId: obj.customer || ex?.externalCustomerId || null,
      externalSubscriptionId: obj.subscription || obj.id || ex?.externalSubscriptionId || null,
      status,
      pastDueSince: null,
      gracePeriodEndsAt: null,
      currentPeriodStart: obj.current_period_start
        ? new Date(obj.current_period_start * 1000)
        : ex?.currentPeriodStart || new Date(),
      currentPeriodEnd: obj.current_period_end
        ? new Date(obj.current_period_end * 1000)
        : ex?.currentPeriodEnd || null,
      updatedAt: new Date(),
    };
    if (ex) {
      await db.update(subscriptions).set(vals).where(eq(subscriptions.id, ex.id));
    } else {
      await db.insert(subscriptions).values({ organizationId: orgId, ...vals });
    }
  }

  if (orgId && event.type === 'customer.subscription.deleted') {
    await db
      .update(subscriptions)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(subscriptions.organizationId, orgId));
  }

  if (orgId && event.type === 'invoice.paid') {
    const [ex] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, orgId))
      .limit(1);
    if (ex) {
      await db
        .update(subscriptions)
        .set({
          status: 'active',
          pastDueSince: null,
          gracePeriodEndsAt: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, ex.id));
    }
    await db.insert(billingInvoices).values({
      organizationId: orgId,
      subscriptionId: ex?.id || null,
      externalInvoiceId: obj.id || null,
      amountCents: Number(obj.amount_paid || obj.total || 0),
      currency: String(obj.currency || 'USD').toUpperCase(),
      status: 'paid',
      billingReason: obj.billing_reason || 'subscription_cycle',
      invoicePdfUrl: obj.invoice_pdf || null,
      hostedInvoiceUrl: obj.hosted_invoice_url || null,
      paidAt: new Date(),
    });
  }

  if (orgId && event.type === 'invoice.payment_failed') {
    const now = new Date();
    const graceEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [ex] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, orgId))
      .limit(1);
    if (ex) {
      await db
        .update(subscriptions)
        .set({
          status: 'past_due',
          pastDueSince: ex.pastDueSince || now,
          gracePeriodEndsAt: ex.gracePeriodEndsAt || graceEnd,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, ex.id));
    }
    await db.insert(billingInvoices).values({
      organizationId: orgId,
      subscriptionId: ex?.id || null,
      externalInvoiceId: obj.id || null,
      amountCents: Number(obj.amount_due || obj.total || 0),
      currency: String(obj.currency || 'USD').toUpperCase(),
      status: 'failed',
      billingReason: obj.billing_reason || 'subscription_cycle',
      hostedInvoiceUrl: obj.hosted_invoice_url || null,
      failedAt: now,
    });
  }

  return NextResponse.json({ received: true });
}
