import { NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, users } from '@/db/schema';
import { eq, sql, and, gte, inArray } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Build condition based on user role
    let userCondition;

    if (user.role === 'ar_executive' || user.role === 'billing_user') {
      userCondition = eq(claims.assignedTo, user.id);
    } else if (user.role === 'team_lead' || user.role === 'senior_lead') {
      const teamMembers = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.teamLeadId, user.id));

      const teamMemberIds = [user.id, ...teamMembers.map((m) => m.id)];
      userCondition = inArray(claims.assignedTo, teamMemberIds);
    }
    // For manager, supervisor, administrator - no condition (see all)

    // Get claims by status
    const statusCounts = await db
      .select({
        status: claims.status,
        count: sql<number>`count(*)::int`,
      })
      .from(claims)
      .where(userCondition)
      .groupBy(claims.status);

    const statusMap: Record<string, number> = {};
    statusCounts.forEach(sc => {
      statusMap[sc.status] = sc.count;
    });

    // Get total billed amount
    const [billedTotal] = await db
      .select({
        total: sql<string>`COALESCE(SUM(billed_amount::numeric), 0)::text`,
      })
      .from(claims)
      .where(userCondition);

    // Get total paid amount
    const [paidTotal] = await db
      .select({
        total: sql<string>`COALESCE(SUM(paid_amount::numeric), 0)::text`,
      })
      .from(claims)
      .where(userCondition);

    // Get total balance
    const [balanceTotal] = await db
      .select({
        total: sql<string>`COALESCE(SUM(balance::numeric), 0)::text`,
      })
      .from(claims)
      .where(userCondition);

    // Get today's activity
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayConditions = userCondition 
      ? and(userCondition, gte(claims.updatedAt, today))
      : gte(claims.updatedAt, today);

    const [todayActivity] = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(claims)
      .where(todayConditions);

    // Get claims by assignee (for managers/leads)
    let claimsByAssignee: Array<{ userId: string; userName: string; count: number }> = [];
    
    if (['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead'].includes(user.role)) {
      const assigneeStats = await db
        .select({
          assignedTo: claims.assignedTo,
          count: sql<number>`count(*)::int`,
        })
        .from(claims)
        .where(userCondition)
        .groupBy(claims.assignedTo);

      for (const stat of assigneeStats) {
        if (stat.assignedTo) {
          const [assignee] = await db
            .select({ firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(eq(users.id, stat.assignedTo))
            .limit(1);
          
          if (assignee) {
            claimsByAssignee.push({
              userId: stat.assignedTo,
              userName: `${assignee.firstName} ${assignee.lastName}`,
              count: stat.count,
            });
          }
        }
      }
    }

    // Get pending reviews count
    const [pendingReviews] = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(claims)
      .where(
        userCondition 
          ? and(userCondition, eq(claims.status, 'submitted_for_review'))
          : eq(claims.status, 'submitted_for_review')
      );

    return NextResponse.json({
      summary: {
        total: Object.values(statusMap).reduce((a, b) => a + b, 0),
        new: statusMap['new'] || 0,
        assigned: statusMap['assigned'] || 0,
        inProgress: statusMap['in_progress'] || 0,
        pending: statusMap['pending'] || 0,
        submittedForReview: statusMap['submitted_for_review'] || 0,
        approved: statusMap['approved'] || 0,
        reworkRequired: statusMap['rework_required'] || 0,
        paid: statusMap['paid'] || 0,
        denied: statusMap['denied'] || 0,
        closed: statusMap['closed'] || 0,
      },
      financials: {
        totalBilled: parseFloat(billedTotal.total),
        totalPaid: parseFloat(paidTotal.total),
        totalBalance: parseFloat(balanceTotal.total),
      },
      activity: {
        todayUpdated: todayActivity.count,
        pendingReviews: pendingReviews.count,
      },
      claimsByAssignee,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}
