import { NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, users, organizationMembers } from '@/db/schema';
import { eq, sql, and, gte, inArray } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET() {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    const baseOrgCond = eq(claims.organizationId, organizationId);
    let scopeCond = baseOrgCond;

    if (ctx.isReadOnly) {
      // Read-only workspace observers/auditors see aggregate KPIs of their active organization
      scopeCond = baseOrgCond;
    } else if (user.role === 'ar_executive' || user.role === 'billing_user') {
      scopeCond = and(baseOrgCond, eq(claims.assignedTo, user.id))!;
    } else if (user.role === 'team_lead' || user.role === 'senior_lead') {
      const teamMembers = await db
        .select({ userId: organizationMembers.userId })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.teamLeadId, user.id),
            eq(organizationMembers.isActive, true)
          )
        );
      const teamMemberIds = [user.id, ...teamMembers.map((m) => m.userId)];
      scopeCond = and(baseOrgCond, inArray(claims.assignedTo, teamMemberIds))!;
    }

    const statusCounts = await db
      .select({
        status: claims.status,
        count: sql<number>`count(*)::int`,
      })
      .from(claims)
      .where(scopeCond)
      .groupBy(claims.status);

    const statusMap: Record<string, number> = {};
    statusCounts.forEach((sc) => {
      statusMap[sc.status] = sc.count;
    });

    const [billedTotal] = await db
      .select({ total: sql<string>`COALESCE(SUM(billed_amount::numeric), 0)::text` })
      .from(claims)
      .where(scopeCond);

    const [paidTotal] = await db
      .select({ total: sql<string>`COALESCE(SUM(paid_amount::numeric), 0)::text` })
      .from(claims)
      .where(scopeCond);

    const [balanceTotal] = await db
      .select({ total: sql<string>`COALESCE(SUM(balance::numeric), 0)::text` })
      .from(claims)
      .where(scopeCond);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayActivity] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(and(scopeCond, gte(claims.updatedAt, today)));

    const claimsByAssignee: Array<{ userId: string; userName: string; count: number }> = [];

    if (['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead'].includes(user.role)) {
      const assigneeStats = await db
        .select({
          assignedTo: claims.assignedTo,
          count: sql<number>`count(*)::int`,
        })
        .from(claims)
        .where(scopeCond)
        .groupBy(claims.assignedTo);

      for (const stat of assigneeStats) {
        if (stat.assignedTo) {
          const [assignee] = await db
            .select({ firstName: users.firstName, lastName: users.lastName })
            .from(organizationMembers)
            .innerJoin(users, eq(organizationMembers.userId, users.id))
            .where(
              and(
                eq(organizationMembers.organizationId, organizationId),
                eq(organizationMembers.userId, stat.assignedTo)
              )
            )
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

    const [pendingReviews] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(and(scopeCond, eq(claims.status, 'submitted_for_review')));

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
      organization: {
        id: ctx.organizationId,
        name: ctx.organization.name,
        slug: ctx.organization.slug,
      },
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 });
  }
}
