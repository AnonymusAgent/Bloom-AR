import { NextResponse } from 'next/server';
import { db } from '@/db';
import {
  claims,
  billingTasks,
  signoffs,
  users,
  taskDocuments,
  userPracticeAssignments,
  practices,
  organizationMembers,
} from '@/db/schema';
import { eq, sql, and, gte } from 'drizzle-orm';
import { isSupervisorOrAbove } from '@/lib/auth';
import { requireTenantContext, mapOrgRoleToOperationalRole } from '@/lib/tenant-context';

export async function GET() {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    if (!isSupervisorOrAbove(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const claimStats = await db
      .select({ status: claims.status, count: sql<number>`count(*)::int` })
      .from(claims)
      .where(eq(claims.organizationId, organizationId))
      .groupBy(claims.status);

    const claimsByStatus: Record<string, number> = {};
    claimStats.forEach((s) => {
      claimsByStatus[s.status] = s.count;
    });

    const taskStats = await db
      .select({ status: billingTasks.status, count: sql<number>`count(*)::int` })
      .from(billingTasks)
      .where(eq(billingTasks.organizationId, organizationId))
      .groupBy(billingTasks.status);

    const tasksByStatus: Record<string, number> = {};
    taskStats.forEach((s) => {
      tasksByStatus[s.status] = s.count;
    });

    const tasksByCategory = await db
      .select({ category: billingTasks.category, count: sql<number>`count(*)::int` })
      .from(billingTasks)
      .where(eq(billingTasks.organizationId, organizationId))
      .groupBy(billingTasks.category);

    const [pendingSignoffs] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(signoffs)
      .where(and(eq(signoffs.organizationId, organizationId), eq(signoffs.status, 'pending')));

    const [pendingDocuments] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(taskDocuments)
      .where(
        and(eq(taskDocuments.organizationId, organizationId), eq(taskDocuments.status, 'pending'))
      );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const memberRows = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        orgRole: organizationMembers.orgRole,
        operationalRole: organizationMembers.operationalRole,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.isActive, true),
          eq(users.isActive, true)
        )
      );

    const workers = memberRows
      .map((m) => ({
        ...m,
        role: mapOrgRoleToOperationalRole(m.orgRole, m.operationalRole),
      }))
      .filter((w) => ['ar_executive', 'billing_user'].includes(w.role) && w.orgRole !== 'read_only');

    const productivityData = [];
    for (const u of workers) {
      const [tasksCompleted] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(billingTasks)
        .where(
          and(
            eq(billingTasks.organizationId, organizationId),
            eq(billingTasks.completedBy, u.id),
            gte(billingTasks.completedAt, today)
          )
        );

      const [totalAssignedTasks] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(billingTasks)
        .where(
          and(
            eq(billingTasks.organizationId, organizationId),
            eq(billingTasks.assignedTo, u.id)
          )
        );

      const [totalAssignedClaims] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(claims)
        .where(
          and(eq(claims.organizationId, organizationId), eq(claims.assignedTo, u.id))
        );

      const [practiceCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(userPracticeAssignments)
        .innerJoin(practices, eq(userPracticeAssignments.practiceId, practices.id))
        .where(
          and(
            eq(userPracticeAssignments.userId, u.id),
            eq(practices.organizationId, organizationId)
          )
        );

      productivityData.push({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        role: u.role,
        tasksCompletedToday: tasksCompleted.count,
        totalAssignedTasks: totalAssignedTasks.count,
        totalAssignedClaims: totalAssignedClaims.count,
        practiceCount: practiceCount.count,
      });
    }

    const [totalPractices] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(practices)
      .where(
        and(eq(practices.organizationId, organizationId), eq(practices.isActive, true))
      );

    const recentPendingSignoffs = await db
      .select({
        id: signoffs.id,
        entityType: signoffs.entityType,
        submittedAt: signoffs.submittedAt,
        submittedBy: signoffs.submittedBy,
      })
      .from(signoffs)
      .where(and(eq(signoffs.organizationId, organizationId), eq(signoffs.status, 'pending')))
      .orderBy(sql`${signoffs.submittedAt} DESC`)
      .limit(5);

    const signoffsWithNames = [];
    for (const s of recentPendingSignoffs) {
      const [submitter] = await db
        .select({ firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, s.submittedBy))
        .limit(1);

      signoffsWithNames.push({
        ...s,
        submitterName: submitter ? `${submitter.firstName} ${submitter.lastName}` : 'Unknown',
      });
    }

    return NextResponse.json({
      claims: {
        total: Object.values(claimsByStatus).reduce((a, b) => a + b, 0),
        byStatus: claimsByStatus,
      },
      tasks: {
        total: Object.values(tasksByStatus).reduce((a, b) => a + b, 0),
        byStatus: tasksByStatus,
        byCategory: tasksByCategory,
      },
      signoffs: {
        pending: pendingSignoffs.count,
      },
      documents: {
        pendingReview: pendingDocuments.count,
      },
      practices: {
        total: totalPractices.count,
      },
      userProductivity: productivityData,
      recentPendingSignoffs: signoffsWithNames,
    });
  } catch (error) {
    console.error('Supervisor dashboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 });
  }
}
