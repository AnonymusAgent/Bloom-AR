import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, users, claimStatusHistory, claimNotes, organizationMembers } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { createNotification, NOTIFICATION_TEMPLATES } from '@/lib/notifications';
import { ensureSaaSColumns } from '@/lib/db-schema';
import { requireTenantContext } from '@/lib/tenant-context';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSaaSColumns();
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { notes, actionPerformed } = body;

    const [claim] = await db
      .select()
      .from(claims)
      .where(and(eq(claims.id, id), eq(claims.organizationId, organizationId)))
      .limit(1);

    if (!claim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    if (
      ['ar_executive', 'billing_user'].includes(user.role) &&
      claim.assignedTo !== user.id
    ) {
      return NextResponse.json(
        { error: 'You can only submit claims assigned to you' },
        { status: 403 }
      );
    }

    if (!['assigned', 'in_progress', 'rework_required'].includes(claim.status)) {
      return NextResponse.json(
        { error: 'Claim cannot be submitted in its current state' },
        { status: 400 }
      );
    }

    const now = new Date();
    const [updatedClaim] = await db
      .update(claims)
      .set({
        status: 'submitted_for_review',
        workflowStatus: 'pending_approval',
        submittedForApprovalAt: now,
        workedBy: claim.workedBy || user.id,
        workedDate: claim.workedDate || now,
        updatedAt: now,
      })
      .where(and(eq(claims.id, id), eq(claims.organizationId, organizationId)))
      .returning();

    await db.insert(claimStatusHistory).values({
      organizationId,
      claimId: id,
      previousStatus: claim.status,
      newStatus: 'submitted_for_review',
      changedBy: user.id,
      reason: notes || 'Submitted for review',
    });

    if (notes) {
      await db.insert(claimNotes).values({
        organizationId,
        claimId: id,
        userId: user.id,
        note: notes,
        actionPerformed: actionPerformed || 'Submitted for Review',
      });
    }

    const template = NOTIFICATION_TEMPLATES.claimSubmitted(
      claim.claimNumber,
      `${user.firstName} ${user.lastName}`
    );

    if (user.teamLeadId) {
      await createNotification({
        organizationId,
        userId: user.teamLeadId,
        relatedClaimId: id,
        ...template,
      });
    } else {
      const supervisors = await db
        .select({ id: users.id })
        .from(users)
        .innerJoin(
          organizationMembers,
          and(
            eq(organizationMembers.userId, users.id),
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.isActive, true)
          )
        )
        .where(and(eq(users.role, 'supervisor'), eq(users.isActive, true)));

      for (const supervisor of supervisors) {
        await createNotification({
          organizationId,
          userId: supervisor.id,
          relatedClaimId: id,
          ...template,
        });
      }
    }

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: AUDIT_ACTIONS.CLAIM_SUBMITTED_FOR_REVIEW,
      entityType: 'claim',
      entityId: id,
      previousValue: { status: claim.status },
      newValue: { status: 'submitted_for_review' },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ claim: updatedClaim });
  } catch (error) {
    console.error('Submit claim error:', error);
    return NextResponse.json({ error: 'Failed to submit claim' }, { status: 500 });
  }
}
