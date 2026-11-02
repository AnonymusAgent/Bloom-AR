import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, users, claimStatusHistory } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { canAssignClaims } from '@/lib/auth';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { createNotification, NOTIFICATION_TEMPLATES } from '@/lib/notifications';
import { requireTenantContext } from '@/lib/tenant-context';
import { verifyUserInOrg } from '@/lib/rbac';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    if (!canAssignClaims(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { claimIds, assigneeId } = await request.json();

    if (!claimIds || !Array.isArray(claimIds) || claimIds.length === 0) {
      return NextResponse.json({ error: 'Claim IDs are required' }, { status: 400 });
    }

    if (!assigneeId) {
      return NextResponse.json({ error: 'Assignee ID is required' }, { status: 400 });
    }

    const inOrg = await verifyUserInOrg(assigneeId, organizationId);
    if (!inOrg) {
      return NextResponse.json(
        { error: 'Assignee not found in your organization' },
        { status: 404 }
      );
    }

    const [assignee] = await db
      .select()
      .from(users)
      .where(eq(users.id, assigneeId))
      .limit(1);

    if (!assignee) {
      return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
    }

    const existingClaims = await db
      .select()
      .from(claims)
      .where(and(eq(claims.organizationId, organizationId), inArray(claims.id, claimIds)));

    if (existingClaims.length === 0) {
      return NextResponse.json(
        { error: 'No matching claims found in your organization' },
        { status: 404 }
      );
    }

    const validIds = existingClaims.map((c) => c.id);

    await db
      .update(claims)
      .set({
        assignedTo: assigneeId,
        assignedBy: user.id,
        assignedAt: new Date(),
        status: 'assigned',
        updatedAt: new Date(),
      })
      .where(and(eq(claims.organizationId, organizationId), inArray(claims.id, validIds)));

    for (const claim of existingClaims) {
      if (claim.status !== 'assigned') {
        await db.insert(claimStatusHistory).values({
          organizationId,
          claimId: claim.id,
          previousStatus: claim.status,
          newStatus: 'assigned',
          changedBy: user.id,
          reason: `Bulk assigned to ${assignee.firstName} ${assignee.lastName}`,
        });
      }
    }

    const template = NOTIFICATION_TEMPLATES.newAssignment(`${validIds.length} claims`);
    await createNotification({
      organizationId,
      userId: assigneeId,
      type: template.type,
      title: 'New Claims Assigned',
      message: `You have been assigned ${validIds.length} new claims`,
    });

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: AUDIT_ACTIONS.CLAIM_ASSIGNED,
      entityType: 'claim',
      entityId: validIds.join(',').slice(0, 100),
      newValue: { assignedTo: assigneeId, claimCount: validIds.length },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      success: true,
      assignedCount: validIds.length,
    });
  } catch (error) {
    console.error('Bulk assign error:', error);
    return NextResponse.json({ error: 'Failed to assign claims' }, { status: 500 });
  }
}
