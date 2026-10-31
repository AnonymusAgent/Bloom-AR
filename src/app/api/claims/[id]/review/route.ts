import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, claimStatusHistory, claimNotes } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser, canReviewClaims } from '@/lib/auth';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { createNotification, NOTIFICATION_TEMPLATES } from '@/lib/notifications';
import { ensureSaaSColumns } from '@/lib/db-schema';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSaaSColumns();
    const user = await getCurrentUser();
    if (!user || !canReviewClaims(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id } = await params;
    const { action, comments } = await request.json();

    if (!action || !['approve', 'reject', 'rework'].includes(action)) {
      return NextResponse.json(
        { error: 'Valid action is required (approve, reject, or rework)' },
        { status: 400 }
      );
    }

    const trimmedComments = typeof comments === 'string' ? comments.trim() : '';
    if ((action === 'rework' || action === 'reject') && !trimmedComments) {
      return NextResponse.json(
        { error: 'Please provide feedback comments when requesting rework or rejecting a claim' },
        { status: 400 }
      );
    }

    const [claim] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, id))
      .limit(1);

    if (!claim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    if (claim.status !== 'submitted_for_review' && claim.workflowStatus !== 'pending_approval') {
      return NextResponse.json({ error: 'Claim is not pending review' }, { status: 400 });
    }

    if (action === 'approve' && claim.workedBy === user.id) {
      return NextResponse.json({ error: 'You cannot approve your own work' }, { status: 403 });
    }

    const now = new Date();
    let newStatus: 'approved' | 'denied' | 'paid' | 'closed' | 'rework_required';
    let newWorkflowStatus: string;
    let auditAction: string;
    let notificationTemplate;
    const extraUpdate: Record<string, unknown> = {};

    switch (action) {
      case 'approve': {
        const outcome = claim.claimInsuranceStatus;
        newStatus =
          outcome === 'denied'
            ? 'denied'
            : outcome === 'paid'
            ? 'paid'
            : outcome === 'closed'
            ? 'closed'
            : 'approved';
        newWorkflowStatus = 'approved';
        extraUpdate.approvedBy = user.id;
        extraUpdate.approvedAt = now;
        auditAction = AUDIT_ACTIONS.CLAIM_APPROVED;
        notificationTemplate = NOTIFICATION_TEMPLATES.claimApproved(claim.claimNumber);
        break;
      }
      case 'reject': {
        newStatus = 'rework_required';
        newWorkflowStatus = 'rework';
        extraUpdate.reworkReason = trimmedComments;
        extraUpdate.reworkCount = ((claim.reworkCount as number) || 0) + 1;
        auditAction = AUDIT_ACTIONS.CLAIM_REJECTED;
        notificationTemplate = NOTIFICATION_TEMPLATES.claimRejected(claim.claimNumber, trimmedComments);
        break;
      }
      case 'rework': {
        newStatus = 'rework_required';
        newWorkflowStatus = 'rework';
        extraUpdate.reworkReason = trimmedComments;
        extraUpdate.reworkCount = ((claim.reworkCount as number) || 0) + 1;
        auditAction = AUDIT_ACTIONS.CLAIM_REWORK_REQUESTED;
        notificationTemplate = NOTIFICATION_TEMPLATES.reworkRequested(claim.claimNumber, trimmedComments);
        break;
      }
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const [updatedClaim] = await db
      .update(claims)
      .set({
        status: newStatus,
        workflowStatus: newWorkflowStatus,
        reviewedBy: user.id,
        reviewedAt: now,
        reviewComments: trimmedComments || null,
        updatedAt: now,
        ...extraUpdate,
      })
      .where(eq(claims.id, id))
      .returning();

    await db.insert(claimStatusHistory).values({
      claimId: id,
      previousStatus: claim.status,
      newStatus,
      changedBy: user.id,
      reason: trimmedComments || `Review action: ${action}`,
    });

    await db.insert(claimNotes).values({
      claimId: id,
      userId: user.id,
      note: trimmedComments || `Claim ${action}d by supervisor`,
      actionPerformed: `review ${action}`,
    });

    const recipient = claim.workedBy || claim.assignedTo;
    if (recipient) {
      await createNotification({
        userId: recipient,
        type: notificationTemplate.type,
        title: notificationTemplate.title,
        message: notificationTemplate.message,
        relatedClaimId: id,
      });
    }

    await createAuditLog({
      userId: user.id,
      action: auditAction,
      entityType: 'claim',
      entityId: id,
      previousValue: { status: claim.status, workflowStatus: claim.workflowStatus },
      newValue: { status: newStatus, workflowStatus: newWorkflowStatus, reviewComments: trimmedComments },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ claim: updatedClaim });
  } catch (error) {
    console.error('Review claim error:', error);
    return NextResponse.json({ error: 'Failed to review claim' }, { status: 500 });
  }
}
