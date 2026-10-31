import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { organizations, organizationMembers, subscriptions } from '@/db/schema';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { slugify, validateSlug, ensureDefaultPlans } from '@/lib/saas';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Multi-tenant isolation: every user (including org administrators) only sees
    // organizations they belong to or own. Platform-wide org listing is strictly
    // in /api/platform/admin gated by requirePlatformAdmin.
    const memberships = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user.id));
    const orgIds = memberships.map((m) => m.organizationId);

    const whereCond =
      orgIds.length > 0
        ? or(inArray(organizations.id, orgIds), eq(organizations.ownerUserId, user.id))
        : eq(organizations.ownerUserId, user.id);

    const orgs = await db
      .select()
      .from(organizations)
      .where(whereCond)
      .orderBy(organizations.name);

    const withCounts = await Promise.all(
      orgs.map(async (org) => {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(organizationMembers)
          .where(eq(organizationMembers.organizationId, org.id));
        return { ...org, memberCount: count };
      })
    );

    return NextResponse.json({ organizations: withCounts });
  } catch (error) {
    console.error('Get organizations error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'administrator') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const { name, slug: rawSlug, address, phone, email, taxId, npi, primaryColor, subscriptionTier } = body;

    if (!name) return NextResponse.json({ error: 'Organization name is required' }, { status: 400 });

    const slug = slugify(rawSlug || name);
    if (!validateSlug(slug)) {
      return NextResponse.json(
        { error: 'Enter a valid, non-reserved URL slug (3-60 lowercase letters, numbers, or hyphens).' },
        { status: 400 }
      );
    }

    const [existing] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (existing) return NextResponse.json({ error: 'Slug already exists' }, { status: 409 });

    const allPlans = await ensureDefaultPlans();
    const plan =
      allPlans.find((p) => p.slug === subscriptionTier) ||
      allPlans.find((p) => p.slug === 'starter') ||
      allPlans[0];

    const [org] = await db
      .insert(organizations)
      .values({
        name: String(name).trim(),
        slug,
        address: address || null,
        phone: phone || null,
        email: email || user.email,
        taxId: taxId || null,
        npi: npi || null,
        primaryColor: primaryColor || null,
        subscriptionTier: plan?.slug || 'starter',
        ownerUserId: user.id,
      })
      .returning();

    await db.insert(organizationMembers).values({
      organizationId: org.id,
      userId: user.id,
      orgRole: 'owner',
    });

    if (plan) {
      await db.insert(subscriptions).values({
        organizationId: org.id,
        planId: plan.id,
        status: 'trialing',
        trialEnd: new Date(Date.now() + (plan.trialDays || 14) * 864e5),
      });
    }

    await createAuditLog({
      userId: user.id,
      action: 'organization_created',
      entityType: 'organization',
      entityId: org.id,
      newValue: { name, slug },
    });

    return NextResponse.json({ organization: org }, { status: 201 });
  } catch (error) {
    console.error('Create organization error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
