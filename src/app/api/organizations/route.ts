import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { organizations, organizationMembers, subscriptions } from '@/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getCurrentSessionWithUser, switchSessionOrganization } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { slugify, validateSlug, ensureDefaultPlans } from '@/lib/saas';
import { cleanUuid } from '@/lib/sanitize';

export async function GET() {
  try {
    const details = await getCurrentSessionWithUser();
    if (!details) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { user, session } = details;

    // Strict multi-tenant isolation: users ONLY see organizations where they hold an active membership.
    const memberships = await db
      .select({
        organizationId: organizationMembers.organizationId,
        orgRole: organizationMembers.orgRole,
      })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.isActive, true)));

    if (memberships.length === 0) {
      return NextResponse.json({ organizations: [], activeOrganizationId: null });
    }

    const roleByOrg = new Map(memberships.map((m) => [m.organizationId, m.orgRole]));
    const orgIds = memberships.map((m) => m.organizationId);

    const orgs = await db
      .select()
      .from(organizations)
      .where(inArray(organizations.id, orgIds))
      .orderBy(organizations.name);

    const withCounts = [];
    for (const org of orgs) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, org.id),
            eq(organizationMembers.isActive, true)
          )
        );
      withCounts.push({
        ...org,
        orgRole: roleByOrg.get(org.id) || 'member',
        memberCount: count,
      });
    }

    return NextResponse.json({
      organizations: withCounts,
      activeOrganizationId: session.activeOrganizationId || withCounts[0]?.id || null,
    });
  } catch (error) {
    console.error('Get organizations error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const details = await getCurrentSessionWithUser();
    if (!details) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { user, session } = details;

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
      operationalRole: 'administrator',
      isActive: true,
    });

    if (plan) {
      const now = new Date();
      await db.insert(subscriptions).values({
        organizationId: org.id,
        planId: plan.id,
        status: 'trialing',
        trialStart: now,
        trialEnd: new Date(Date.now() + (plan.trialDays || 14) * 864e5),
      });
    }

    await switchSessionOrganization(session.id, org.id);

    await createAuditLog({
      organizationId: org.id,
      userId: user.id,
      actorRole: 'owner',
      action: 'organization_created',
      entityType: 'organization',
      entityId: org.id,
      newValue: { name, slug },
    });

    return NextResponse.json({ organization: org }, { status: 201 });
  } catch (error) {
    console.error('Create organization error:', error);
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const details = await getCurrentSessionWithUser();
    if (!details) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { user, session } = details;

    const body = await request.json();
    const orgId = cleanUuid(body.id || body.organizationId || session.activeOrganizationId);
    if (!orgId) return NextResponse.json({ error: 'Valid organizationId required' }, { status: 400 });

    const [member] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, user.id),
          eq(organizationMembers.isActive, true)
        )
      )
      .limit(1);

    if (!member || !['owner', 'admin'].includes(member.orgRole)) {
      return NextResponse.json({ error: 'Only organization owners or admins can update workspace settings' }, { status: 403 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['name', 'address', 'phone', 'email', 'taxId', 'npi', 'primaryColor', 'timezone', 'country', 'orgType'] as const) {
      if (body[k] !== undefined) updates[k] = body[k] || null;
    }
    if (updates.name === null) delete updates.name;

    const [updated] = await db
      .update(organizations)
      .set(updates)
      .where(eq(organizations.id, orgId))
      .returning();

    await createAuditLog({
      organizationId: orgId,
      userId: user.id,
      actorRole: member.orgRole,
      action: 'organization_updated',
      entityType: 'organization',
      entityId: orgId,
      newValue: updates,
    });

    return NextResponse.json({ organization: updated });
  } catch (error) {
    console.error('Update organization error:', error);
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
  }
}
