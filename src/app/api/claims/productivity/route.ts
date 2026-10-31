import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, users } from '@/db/schema';
import { eq, sql, and, gte, lte, inArray } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { getUserAuthorizedUserIds, getUserAuthorizedPracticeIds } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = request.nextUrl.searchParams;
    const period = sp.get('period') || 'today';
    const userId = sp.get('userId');
    const practiceFilter = sp.get('practiceId');

    // RBAC: Enforce visibility rules
    const authorizedUsers = await getUserAuthorizedUserIds(user);
    const authorizedPractices = await getUserAuthorizedPracticeIds(user);

    // If a specific userId is requested, validate access
    if (userId && authorizedUsers !== 'all' && !authorizedUsers.includes(userId)) {
      return NextResponse.json({ error: 'You do not have permission to view this user\'s productivity' }, { status: 403 });
    }

    // If a specific practice is requested, validate access
    if (practiceFilter && authorizedPractices !== 'all' && !authorizedPractices.includes(practiceFilter)) {
      return NextResponse.json({ error: 'You do not have permission to view this practice' }, { status: 403 });
    }

    // Calculate date range
    const now = new Date();
    let fromDate = new Date(now); fromDate.setHours(0, 0, 0, 0);
    let toDate = new Date(now); toDate.setHours(23, 59, 59, 999);
    let yesterdayFrom = new Date(fromDate); yesterdayFrom.setDate(yesterdayFrom.getDate() - 1);
    let yesterdayTo = new Date(yesterdayFrom); yesterdayTo.setHours(23, 59, 59, 999);

    if (period === 'yesterday') {
      fromDate = yesterdayFrom; toDate = yesterdayTo;
      yesterdayFrom.setDate(yesterdayFrom.getDate() - 1);
      yesterdayTo = new Date(yesterdayFrom); yesterdayTo.setHours(23, 59, 59, 999);
    } else if (period === 'current_week') {
      const day = now.getDay(); fromDate.setDate(now.getDate() - day);
    } else if (period === 'previous_week') {
      const day = now.getDay();
      toDate = new Date(now); toDate.setDate(now.getDate() - day - 1); toDate.setHours(23, 59, 59, 999);
      fromDate = new Date(toDate); fromDate.setDate(toDate.getDate() - 6); fromDate.setHours(0, 0, 0, 0);
    } else if (period === 'current_month') {
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'previous_month') {
      fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      toDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (period === 'custom') {
      const df = sp.get('dateFrom'); const dt = sp.get('dateTo');
      if (df) fromDate = new Date(df);
      if (dt) { toDate = new Date(dt); toDate.setHours(23, 59, 59, 999); }
    }

    // RBAC: Determine which users to report on
    // Regular users can ONLY see their own data — enforced at backend
    const targetUserId = userId || (authorizedUsers === 'all' ? null : user.id);

    // Build base conditions including practice filter
    const baseConds: ReturnType<typeof eq>[] = [];
    if (practiceFilter) baseConds.push(eq(claims.practiceId, practiceFilter));

    const uidCond = targetUserId ? eq(claims.workedBy, targetUserId) : undefined;
    const assignedConds = [...baseConds];
    if (targetUserId) assignedConds.push(eq(claims.assignedTo, targetUserId));
    const [assigned] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(assignedConds.length ? and(...assignedConds) : undefined);
    const [worked] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(...baseConds, gte(claims.workedDate, fromDate), lte(claims.workedDate, toDate), uidCond));
    const [submitted] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(...baseConds, gte(claims.submittedForApprovalAt, fromDate), lte(claims.submittedForApprovalAt, toDate), uidCond));
    const [approved] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(...baseConds, gte(claims.approvedAt, fromDate), lte(claims.approvedAt, toDate), uidCond));
    const [rework] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(...baseConds, eq(claims.workflowStatus, 'rework'), uidCond));
    const [pendingApproval] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(...baseConds, eq(claims.workflowStatus, 'pending_approval'), uidCond));
    const [remaining] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(...baseConds, inArray(claims.workflowStatus, ['unworked', 'working', 'rework']), targetUserId ? eq(claims.assignedTo, targetUserId) : undefined));

    // Yesterday stats (for comparison)
    const [yWorked] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(...baseConds, gte(claims.workedDate, yesterdayFrom), lte(claims.workedDate, yesterdayTo), uidCond));
    const [ySubmitted] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(...baseConds, gte(claims.submittedForApprovalAt, yesterdayFrom), lte(claims.submittedForApprovalAt, yesterdayTo), uidCond));
    const [yApproved] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(...baseConds, gte(claims.approvedAt, yesterdayFrom), lte(claims.approvedAt, yesterdayTo), uidCond));

    // Daily trend (last 14 days)
    const dailyTrend = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
      const dEnd = new Date(d); dEnd.setHours(23, 59, 59, 999);
      const [cnt] = await db.select({ count: sql<number>`count(*)::int` }).from(claims)
        .where(and(...baseConds, gte(claims.workedDate, d), lte(claims.workedDate, dEnd), uidCond));
      dailyTrend.push({ date: d.toISOString().split('T')[0], count: cnt.count });
    }

    // Status distribution
    const statusWhere = [...baseConds, ...(uidCond ? [uidCond] : [])];
    const statusDist = await db.select({ status: claims.workflowStatus, count: sql<number>`count(*)::int` })
      .from(claims).where(statusWhere.length ? and(...statusWhere) : undefined).groupBy(claims.workflowStatus);

    // Monthly progress
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [monthWorked] = await db.select({ count: sql<number>`count(*)::int` }).from(claims)
      .where(and(...baseConds, gte(claims.workedDate, monthStart), uidCond));
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const monthlyTarget = assigned.count > 0 ? assigned.count : 100;
    const expectedByNow = Math.round((dayOfMonth / daysInMonth) * monthlyTarget);

    // Productivity change
    const todayVal = worked.count;
    const yesterdayVal = yWorked.count;
    const change = yesterdayVal > 0 ? Math.round(((todayVal - yesterdayVal) / yesterdayVal) * 100) : todayVal > 0 ? 100 : 0;

    return NextResponse.json({
      period: { from: fromDate.toISOString(), to: toDate.toISOString(), label: period },
      current: {
        assigned: assigned.count, worked: worked.count, submitted: submitted.count,
        approved: approved.count, rework: rework.count, pendingApproval: pendingApproval.count,
        remaining: remaining.count,
        productivityPct: assigned.count > 0 ? Math.round((worked.count / assigned.count) * 100) : 0,
      },
      yesterday: { worked: yWorked.count, submitted: ySubmitted.count, approved: yApproved.count },
      comparison: { change, direction: change > 0 ? 'up' : change < 0 ? 'down' : 'same' },
      dailyTrend,
      statusDistribution: statusDist,
      monthly: {
        target: monthlyTarget, expected: expectedByNow, completed: monthWorked.count,
        achievement: monthlyTarget > 0 ? Math.round((monthWorked.count / monthlyTarget) * 100) : 0,
        dayOfMonth, daysInMonth,
      },
    });
  } catch (error) {
    console.error('Productivity error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
