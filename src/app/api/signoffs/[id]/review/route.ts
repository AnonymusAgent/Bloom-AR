import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { signoffs, billingTasks, claims, taskStatusHistory, claimStatusHistory } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser, canReviewSignoffs } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user || !canReviewSignoffs(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id } = await params;
    const { action, reviewNotes } = await request.json();

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Valid action is required (approve or reject)' },
        { status: 400 }
      );
    }

    const [signoff] = await db
      .select()
      .from(signoffs)
      .where(eq(signoffs.id, id))
      .limit(1);

    if (!signoff) {
      return NextResponse.json({ error: 'Signoff not found' }, { status: 404 });
    }

    if (signoff.status !== 'pending') {
      return NextResponse.json(
        { error: 'Signoff has already been reviewed' },
        { status: 400 }
      );
    }

    if (signoff.submittedBy === user.id && user.role !== 'administrator') {
      return NextResponse.json(
        { error: 'Self-approval is not permitted. Another lead or supervisor must review this sign-off.' },
        { status: 403 }
      );
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    const [updatedSignoff] = await db
      .update(signoffs)
      .set({
        status: newStatus,
        reviewedBy: user.id,
        reviewedAt: new Date(),
        reviewNotes,
      })
      .where(eq(signoffs.id, id))
      .returning();

    // Update associated entity status
    if (signoff.taskId) {
      const newTaskStatus = action === 'approve' ? 'signed_off' : 'in_progress';
      
      const [task] = await db
        .select()
        .from(billingTasks)
        .where(eq(billingTasks.id, signoff.taskId))
        .limit(1);

      if (task) {
        await db
          .update(billingTasks)
          .set({ status: newTaskStatus, updatedAt: new Date() })
          .where(eq(billingTasks.id, signoff.taskId));

        await db.insert(taskStatusHistory).values({
          taskId: signoff.taskId,
          previousStatus: task.status,
          newStatus: newTaskStatus,
          changedBy: user.id,
          reason: `Signoff ${action}d`,
        });
      }
    }

    if (signoff.claimId) {
      const newClaimStatus = action === 'approve' ? 'approved' : 'rework_required';
      const newWorkflowStatus = action === 'approve' ? 'approved' : 'rework';

      const [claim] = await db
        .select()
        .from(claims)
        .where(eq(claims.id, signoff.claimId))
        .limit(1);

      if (claim) {
        await db
          .update(claims)
          .set({
            status: newClaimStatus,
            workflowStatus: newWorkflowStatus,
            ...(action === 'approve'
              ? { approvedBy: user.id, approvedAt: new Date() }
              : { reworkReason: reviewNotes || 'Sign-off rejected', reworkCount: (claim.reworkCount || 0) + 1 }),
            updatedAt: new Date(),
          })
          .where(eq(claims.id, signoff.claimId));

        await db.insert(claimStatusHistory).values({
          claimId: signoff.claimId,
          previousStatus: claim.status,
          newStatus: newClaimStatus,
          changedBy: user.id,
          reason: `Signoff ${action}d${reviewNotes ? `: ${reviewNotes}` : ''}`,
        });
      }
    }

    // Notify submitter
    const notificationType = action === 'approve' ? 'signoff_approved' : 'signoff_rejected';
    await createNotification({
      userId: signoff.submittedBy,
      type: notificationType,
      title: `Sign-off ${action === 'approve' ? 'Approved' : 'Rejected'}`,
      message: `Your sign-off has been ${action}d${reviewNotes ? `: ${reviewNotes}` : ''}`,
    });

    await createAuditLog({
      userId: user.id,
      action: `signoff_${action}d`,
      entityType: 'signoff',
      entityId: id,
      previousValue: { status: 'pending' },
      newValue: { status: newStatus, reviewNotes },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ signoff: updatedSignoff });
  } catch (error) {
    console.error('Review signoff error:', error);
    return NextResponse.json(
      { error: 'Failed to review signoff' },
      { status: 500 }
    );
  }
}
