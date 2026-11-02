import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { organizationMembers, organizations } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { getCurrentSessionWithUser, switchSessionOrganization } from '@/lib/auth';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { cleanUuid } from '@/lib/sanitize';
import { mapOrgRoleToOperationalRole } from '@/lib/tenant-context';

export async function POST(req: NextRequest) {
  const details = await getCurrentSessionWithUser();
  if (!details) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { session, user } = details;
  const body = await req.json().catch(() => ({}));
  const targetOrgId = cleanUuid(body.organizationId);

  if (!targetOrgId) {
    return NextResponse.json({ error: 'Valid organizationId is required' }, { status: 400 });
  }

  const [membership] = await db
    .select({ member: organizationMembers, org: organizations })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(
      and(
        eq(organizationMembers.organizationId, targetOrgId),
        eq(organizationMembers.userId, user.id),
        eq(organizationMembers.isActive, true)
      )
    )
    .limit(1);

  if (!membership) {
    await createAuditLog({
      organizationId: session.activeOrganizationId || null,
      userId: user.id,
      action: AUDIT_ACTIONS.ORG_SWITCH_DENIED,
      entityType: 'organization',
      entityId: targetOrgId,
      newValue: { reason: 'not_a_member' },
    });
    return NextResponse.json(
      { error: 'Access denied: you do not belong to the requested organization.' },
      { status: 403 }
    );
  }

  if (membership.org.status === 'suspended') {
    return NextResponse.json(
      { error: `Workspace "${membership.org.name}" is currently suspended.` },
      { status: 403 }
    );
  }

  await switchSessionOrganization(session.id, membership.org.id);

  await createAuditLog({
    organizationId: membership.org.id,
    userId: user.id,
    actorRole: membership.member.orgRole,
    action: AUDIT_ACTIONS.ORG_SWITCHED,
    entityType: 'organization',
    entityId: membership.org.id,
    previousValue: { organizationId: session.activeOrganizationId },
    newValue: { organizationId: membership.org.id, name: membership.org.name },
  });

  return NextResponse.json({
    success: true,
    activeOrganization: {
      id: membership.org.id,
      name: membership.org.name,
      slug: membership.org.slug,
      orgRole: membership.member.orgRole,
      effectiveRole: mapOrgRoleToOperationalRole(
        membership.member.orgRole,
        membership.member.operationalRole
      ),
    },
  });
}
