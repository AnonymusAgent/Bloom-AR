import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { plans } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { ensureDefaultPlans } from '@/lib/saas';
export async function GET() { const u = await requirePlatformAdmin(); if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); return NextResponse.json({ plans: await ensureDefaultPlans() }); }
export async function POST(req: NextRequest) {
  const u = await requirePlatformAdmin(); if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  if (!b.slug || !b.name) return NextResponse.json({ error: 'slug and name required' }, { status: 400 });
  const [existing] = await db.select().from(plans).where(eq(plans.slug, b.slug)).limit(1);
  if (existing) return NextResponse.json({ error: 'A plan with that slug already exists' }, { status: 409 });
  const [plan] = await db.insert(plans).values({ slug: b.slug, name: b.name, description: b.description || null, monthlyPriceCents: b.monthlyPriceCents || 0, annualPriceCents: b.annualPriceCents || 0, trialDays: b.trialDays ?? 14, features: b.features || [], limits: b.limits || {}, stripeMonthlyPriceId: b.stripeMonthlyPriceId || null, stripeAnnualPriceId: b.stripeAnnualPriceId || null }).returning();
  return NextResponse.json({ plan }, { status: 201 });
}
export async function DELETE(req: NextRequest) {
  const u = await requirePlatformAdmin(); if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({} as Record<string, string>));
  const id = req.nextUrl.searchParams.get('id') || body.id;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  // Soft-disable instead of deleting so existing subscriptions keep their plan reference.
  await db.update(plans).set({ isActive: false }).where(eq(plans.id, id));
  return NextResponse.json({ success: true, message: 'Plan disabled (existing subscriptions unaffected).' });
}
export async function PUT(req: NextRequest) {
  const u = await requirePlatformAdmin(); if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json(); if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const [p] = await db.update(plans).set({ name: b.name, description: b.description, monthlyPriceCents: b.monthlyPriceCents, annualPriceCents: b.annualPriceCents, trialDays: b.trialDays, features: b.features, limits: b.limits, stripeMonthlyPriceId: b.stripeMonthlyPriceId||null, stripeAnnualPriceId: b.stripeAnnualPriceId||null, isActive: b.isActive }).where(eq(plans.id, b.id)).returning();
  return NextResponse.json({ plan: p });
}
