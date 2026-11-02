import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { signoffs, billingTasks, claims, taskStatusHistory, claimStatusHistory } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { canReviewSignoffs } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
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

    if (!canReviewSignoffs(user.role)) {
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
      .where(and(eq(signoffs.id, id), eq(signoffs.organizationId, organizationId)))
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
        {
          error:
            'Self-approval is not permitted. Another lead or supervisor must review this sign-off.',
        },
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
      .where(and(eq(signoffs.id, id), eq(signoffs.organizationId, organizationId)))
      .returning();

    if (signoff.taskId) {
      const newTaskStatus = action === 'approve' ? 'signed_off' : 'in_progress';

      const [task] = await db
        .select()
        .from(billingTasks)
        .where(
          and(
            eq(billingTasks.id, signoff.taskId),
            eq(billingTasks.organizationId, organizationId)
          )
        )
        .limit(1);

      if (task) {
        await db
          .update(billingTasks)
          .set({ status: newTaskStatus, updatedAt: new Date() })
          .where(
            and(
              eq(billingTasks.id, signoff.taskId),
              eq(billingTasks.organizationId, organizationId)
            )
          );

        await db.insert(taskStatusHistory).values({
          organizationId,
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
        .where(and(eq(claims.id, signoff.claimId), eq(claims.organizationId, organizationId)))
        .limit(1);

      if (claim) {
        await db
          .update(claims)
          .set({
            status: newClaimStatus,
            workflowStatus: newWorkflowStatus,
            ...(action === 'approve'
              ? { approvedBy: user.id, approvedAt: new Date() }
              : {
                  reworkReason: reviewNotes || 'Sign-off rejected',
                  reworkCount: (claim.reworkCount || 0) + 1,
                }),
            updatedAt: new Date(),
          })
          .where(and(eq(claims.id, signoff.claimId), eq(claims.organizationId, organizationId)));

        await db.insert(claimStatusHistory).values({
          organizationId,
          claimId: signoff.claimId,
          previousStatus: claim.status,
          newStatus: newClaimStatus,
          changedBy: user.id,
          reason: `Signoff ${action}d${reviewNotes ? `: ${reviewNotes}` : ''}`,
        });
      }
    }

    const notificationType = action === 'approve' ? 'signoff_approved' : 'signoff_rejected';
    await createNotification({
      organizationId,
      userId: signoff.submittedBy,
      type: notificationType,
      title: `Sign-off ${action === 'approve' ? 'Approved' : 'Rejected'}`,
      message: `Your sign-off has been ${action}d${reviewNotes ? `: ${reviewNotes}` : ''}`,
    });

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
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
    return NextResponse.json({ error: 'Failed to review signoff' }, { status: 500 });
  }
}
