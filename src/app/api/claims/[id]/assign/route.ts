import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, users, claimStatusHistory } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { canAssignClaims } from '@/lib/auth';
import { verifyUserInOrg } from '@/lib/rbac';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { createNotification, NOTIFICATION_TEMPLATES } from '@/lib/notifications';
import { requireTenantContext } from '@/lib/tenant-context';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    if (!canAssignClaims(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id } = await params;
    const { assigneeId } = await request.json();

    if (!assigneeId) {
      return NextResponse.json({ error: 'Assignee ID is required' }, { status: 400 });
    }

    const [existingClaim] = await db
      .select()
      .from(claims)
      .where(and(eq(claims.id, id), eq(claims.organizationId, organizationId)))
      .limit(1);

    if (!existingClaim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    const inOrg = await verifyUserInOrg(assigneeId, organizationId);
    if (!inOrg) {
      return NextResponse.json(
        { error: 'Assignee not found in your organization' },
        { status: 404 }
      );
    }

    const [assignee] = await db.select().from(users).where(eq(users.id, assigneeId)).limit(1);
    if (!assignee) {
      return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
    }

    const newStatus = existingClaim.status === 'new' ? 'assigned' : existingClaim.status;

    const [updatedClaim] = await db
      .update(claims)
      .set({
        assignedTo: assigneeId,
        assignedBy: user.id,
        assignedAt: new Date(),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(claims.id, id), eq(claims.organizationId, organizationId)))
      .returning();

    if (newStatus !== existingClaim.status) {
      await db.insert(claimStatusHistory).values({
        organizationId,
        claimId: id,
        previousStatus: existingClaim.status,
        newStatus,
        changedBy: user.id,
        reason: `Assigned to ${assignee.firstName} ${assignee.lastName}`,
      });
    }

    const template = NOTIFICATION_TEMPLATES.newAssignment(existingClaim.claimNumber);
    await createNotification({
      organizationId,
      userId: assigneeId,
      relatedClaimId: id,
      ...template,
    });

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: AUDIT_ACTIONS.CLAIM_ASSIGNED,
      entityType: 'claim',
      entityId: id,
      previousValue: { assignedTo: existingClaim.assignedTo },
      newValue: { assignedTo: assigneeId },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ claim: updatedClaim });
  } catch (error) {
    console.error('Assign claim error:', error);
    return NextResponse.json({ error: 'Failed to assign claim' }, { status: 500 });
  }
}
