import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, users, claimStatusHistory } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { createNotification, NOTIFICATION_TEMPLATES } from '@/lib/notifications';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const [claim] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, id))
      .limit(1);

    if (!claim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    // Check if user is assigned to this claim
    if (claim.assignedTo !== user.id) {
      return NextResponse.json({ error: 'You can only submit claims assigned to you' }, { status: 403 });
    }

    // Check if claim is in a valid state for submission
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
      .where(eq(claims.id, id))
      .returning();

    // Create status history
    await db.insert(claimStatusHistory).values({
      claimId: id,
      previousStatus: claim.status,
      newStatus: 'submitted_for_review',
      changedBy: user.id,
      reason: 'Submitted for review',
    });

    // Notify team lead
    if (user.teamLeadId) {
      const template = NOTIFICATION_TEMPLATES.claimSubmitted(
        claim.claimNumber,
        `${user.firstName} ${user.lastName}`
      );
      await createNotification({
        userId: user.teamLeadId,
        type: template.type,
        title: template.title,
        message: template.message,
        relatedClaimId: id,
      });
    }

    await createAuditLog({
      userId: user.id,
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
    return NextResponse.json(
      { error: 'Failed to submit claim' },
      { status: 500 }
    );
  }
}
