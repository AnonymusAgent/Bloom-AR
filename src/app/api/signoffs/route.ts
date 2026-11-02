import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { signoffs, billingTasks, claims, users } from '@/db/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { isSupervisorOrAbove, canReviewSignoffs } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { cleanUuid, cleanPage, cleanLimit } from '@/lib/sanitize';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const entityType = searchParams.get('entityType');
    const page = cleanPage(searchParams.get('page'));
    const limit = cleanLimit(searchParams.get('limit'), 20, 100);

    const conditions = [eq(signoffs.organizationId, organizationId)];

    if (!ctx.isReadOnly && !canReviewSignoffs(user.role)) {
      conditions.push(eq(signoffs.submittedBy, user.id));
    }

    if (status) {
      conditions.push(eq(signoffs.status, status as 'pending' | 'approved' | 'rejected'));
    }

    if (entityType) {
      conditions.push(eq(signoffs.entityType, entityType));
    }

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(signoffs)
      .where(whereClause);

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

    const userIds = Array.from(
      new Set(
        result.flatMap((s) =>
          [s.submittedBy, s.reviewedBy].filter((id): id is string => Boolean(id))
        )
      )
    );
    const taskIds = Array.from(
      new Set(result.map((s) => s.taskId).filter((id): id is string => Boolean(id)))
    );
    const claimIds = Array.from(
      new Set(result.map((s) => s.claimId).filter((id): id is string => Boolean(id)))
    );

    const userRows =
      userIds.length > 0
        ? await db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(inArray(users.id, userIds))
        : [];
    const taskRows =
      taskIds.length > 0
        ? await db
            .select({ id: billingTasks.id, title: billingTasks.title })
            .from(billingTasks)
            .where(
              and(
                eq(billingTasks.organizationId, organizationId),
                inArray(billingTasks.id, taskIds)
              )
            )
        : [];
    const claimRows =
      claimIds.length > 0
        ? await db
            .select({ id: claims.id, claimNumber: claims.claimNumber })
            .from(claims)
            .where(and(eq(claims.organizationId, organizationId), inArray(claims.id, claimIds)))
        : [];

    const namesMap = new Map(userRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const tasksMap = new Map(taskRows.map((t) => [t.id, t.title]));
    const claimsMap = new Map(claimRows.map((c) => [c.id, c.claimNumber]));

    const signoffsWithDetails = result.map((signoff) => ({
      ...signoff,
      submitterName: namesMap.get(signoff.submittedBy) || 'Unknown',
      entityTitle: signoff.taskId
        ? tasksMap.get(signoff.taskId) || 'Unknown Task'
        : signoff.claimId
        ? claimsMap.get(signoff.claimId) || 'Unknown Claim'
        : '',
      reviewerName: signoff.reviewedBy ? namesMap.get(signoff.reviewedBy) || null : null,
    }));

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
    return NextResponse.json({ error: 'Failed to fetch signoffs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

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

    if (taskId) {
      const [task] = await db
        .select()
        .from(billingTasks)
        .where(and(eq(billingTasks.id, taskId), eq(billingTasks.organizationId, organizationId)))
        .limit(1);

      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }

      if (task.assignedTo !== user.id && !isSupervisorOrAbove(user.role)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      await db
        .update(billingTasks)
        .set({ status: 'submitted_for_signoff', updatedAt: new Date() })
        .where(and(eq(billingTasks.id, taskId), eq(billingTasks.organizationId, organizationId)));
    }

    if (claimId) {
      const [claim] = await db
        .select()
        .from(claims)
        .where(and(eq(claims.id, claimId), eq(claims.organizationId, organizationId)))
        .limit(1);
      if (!claim) {
        return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
      }
      if (claim.assignedTo !== user.id && !isSupervisorOrAbove(user.role)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    const [newSignoff] = await db
      .insert(signoffs)
      .values({
        organizationId,
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
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
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
    return NextResponse.json({ error: 'Failed to create signoff' }, { status: 500 });
  }
}
