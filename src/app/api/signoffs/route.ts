import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { signoffs, billingTasks, claims, users } from '@/db/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove, canReviewSignoffs } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { cleanUuid, cleanPage, cleanLimit } from '@/lib/sanitize';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const entityType = searchParams.get('entityType');
    const page = cleanPage(searchParams.get('page'));
    const limit = cleanLimit(searchParams.get('limit'), 20, 100);

    const conditions = [];

    // Role-based filtering
    if (!canReviewSignoffs(user.role)) {
      // Regular users can only see their own signoffs
      conditions.push(eq(signoffs.submittedBy, user.id));
    }

    if (status) {
      conditions.push(eq(signoffs.status, status as 'pending' | 'approved' | 'rejected'));
    }

    if (entityType) {
      conditions.push(eq(signoffs.entityType, entityType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(signoffs)
      .where(whereClause);

    // Get signoffs
    const result = await db
      .select({
        id: signoffs.id,
        entityType: signoffs.entityType,
        entityId: signoffs.entityId,
        taskId: signoffs.taskId,
        claimId: signoffs.claimId,
        status: signoffs.status,
        submittedBy: signoffs.submittedBy,
        submittedAt: signoffs.submittedAt,
        submissionNotes: signoffs.submissionNotes,
        isAutomatic: signoffs.isAutomatic,
        reviewedBy: signoffs.reviewedBy,
        reviewedAt: signoffs.reviewedAt,
        reviewNotes: signoffs.reviewNotes,
        createdAt: signoffs.createdAt,
      })
      .from(signoffs)
      .where(whereClause)
      .orderBy(desc(signoffs.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    // Get submitter names and entity details
    const signoffsWithDetails = await Promise.all(
      result.map(async (signoff) => {
        const [submitter] = await db
          .select({ firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(eq(users.id, signoff.submittedBy))
          .limit(1);

        let entityTitle = '';
        if (signoff.taskId) {
          const [task] = await db
            .select({ title: billingTasks.title })
            .from(billingTasks)
            .where(eq(billingTasks.id, signoff.taskId))
            .limit(1);
          entityTitle = task?.title || 'Unknown Task';
        } else if (signoff.claimId) {
          const [claim] = await db
            .select({ claimNumber: claims.claimNumber })
            .from(claims)
            .where(eq(claims.id, signoff.claimId))
            .limit(1);
          entityTitle = claim?.claimNumber || 'Unknown Claim';
        }

        let reviewerName = null;
        if (signoff.reviewedBy) {
          const [reviewer] = await db
            .select({ firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(eq(users.id, signoff.reviewedBy))
            .limit(1);
          reviewerName = reviewer ? `${reviewer.firstName} ${reviewer.lastName}` : null;
        }

        return {
          ...signoff,
          submitterName: submitter ? `${submitter.firstName} ${submitter.lastName}` : 'Unknown',
          entityTitle,
          reviewerName,
        };
      })
    );

    return NextResponse.json({
      signoffs: signoffsWithDetails,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error('Get signoffs error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch signoffs' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { entityType, submissionNotes, isAutomatic } = body;
    const entityId = cleanUuid(body.entityId);
    const taskId = cleanUuid(body.taskId);
    const claimId = cleanUuid(body.claimId);

    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: 'Valid entity type and UUID are required' },
        { status: 400 }
      );
    }

    // Verify entity exists and user has access
    if (entityType === 'task' && taskId) {
      const [task] = await db
        .select()
        .from(billingTasks)
        .where(eq(billingTasks.id, taskId))
        .limit(1);

      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }

      if (task.assignedTo !== user.id && !isSupervisorOrAbove(user.role)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      // Update task status
      await db
        .update(billingTasks)
        .set({ status: 'submitted_for_signoff', updatedAt: new Date() })
        .where(eq(billingTasks.id, taskId));
    }

    const [newSignoff] = await db
      .insert(signoffs)
      .values({
        entityType,
        entityId,
        taskId,
        claimId,
        submittedBy: user.id,
        submissionNotes,
        isAutomatic: isAutomatic || false,
      })
      .returning();

    await createAuditLog({
      userId: user.id,
      action: 'signoff_submitted',
      entityType: 'signoff',
      entityId: newSignoff.id,
      newValue: { entityType, entityId, taskId, claimId },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ signoff: newSignoff });
  } catch (error) {
    console.error('Create signoff error:', error);
    return NextResponse.json(
      { error: 'Failed to create signoff' },
      { status: 500 }
    );
  }
}
