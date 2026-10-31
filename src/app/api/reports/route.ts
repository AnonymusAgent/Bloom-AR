import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, authorizations, billingTasks, codingRequests, users, signoffs } from '@/db/schema';
import { eq, and, gte, lte, lt, sql, inArray, desc } from 'drizzle-orm';
import { getCurrentUser, canViewReports } from '@/lib/auth';
import { parseEndOfDay } from '@/lib/sanitize';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || !canViewReports(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: user ? 403 : 401 });
    }

    const sp = request.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const dateTo = sp.get('dateTo') || new Date().toISOString().split('T')[0];

    const fromDate = new Date(dateFrom);
    const toDate = parseEndOfDay(dateTo);

    // === CLAIMS KPIs ===
    const claimDateCond = and(gte(claims.createdAt, fromDate), lte(claims.createdAt, toDate));
    const [claimTotal] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(claimDateCond);
    const [claimPaid] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(claimDateCond, eq(claims.status, 'paid')));
    const [claimDenied] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(claimDateCond, eq(claims.status, 'denied')));
    const [claimPending] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(claimDateCond, inArray(claims.status, ['new', 'assigned', 'in_progress', 'pending'])));
    const [billedSum] = await db.select({ total: sql<string>`COALESCE(SUM(billed_amount::numeric), 0)::text` }).from(claims).where(claimDateCond);
    const [paidSum] = await db.select({ total: sql<string>`COALESCE(SUM(paid_amount::numeric), 0)::text` }).from(claims).where(claimDateCond);
    const [balanceSum] = await db.select({ total: sql<string>`COALESCE(SUM(balance::numeric), 0)::text` }).from(claims).where(claimDateCond);

    const denialRate = claimTotal.count > 0 ? Math.round((claimDenied.count / claimTotal.count) * 100) : 0;
    const collectionRate = parseFloat(billedSum.total) > 0 ? Math.round((parseFloat(paidSum.total) / parseFloat(billedSum.total)) * 100) : 0;

    // === CLAIMS BY STATUS ===
    const claimsByStatus = await db.select({ status: claims.status, count: sql<number>`count(*)::int` }).from(claims).where(claimDateCond).groupBy(claims.status);

    // === TREND DATA (daily claim counts over date range) ===
    const trendData = await db.select({
      date: sql<string>`TO_CHAR(created_at, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    }).from(claims).where(claimDateCond).groupBy(sql`TO_CHAR(created_at, 'YYYY-MM-DD')`).orderBy(sql`TO_CHAR(created_at, 'YYYY-MM-DD')`);

    // === CLAIMS BY INSURANCE (top 10) ===
    const claimsByInsurance = await db.select({
      insurance: claims.insurance,
      count: sql<number>`count(*)::int`,
      totalBilled: sql<string>`COALESCE(SUM(billed_amount::numeric), 0)::text`,
    }).from(claims).where(and(claimDateCond, sql`${claims.insurance} IS NOT NULL`)).groupBy(claims.insurance).orderBy(desc(sql`count(*)`)).limit(10);

    // === AUTH KPIs ===
    const authDateCond = and(gte(authorizations.createdAt, fromDate), lte(authorizations.createdAt, toDate));
    const [authTotal] = await db.select({ count: sql<number>`count(*)::int` }).from(authorizations).where(authDateCond);
    const [authCompleted] = await db.select({ count: sql<number>`count(*)::int` }).from(authorizations).where(and(authDateCond, eq(authorizations.status, 'completed')));
    const [authPending] = await db.select({ count: sql<number>`count(*)::int` }).from(authorizations).where(and(authDateCond, inArray(authorizations.status, ['pending', 'in_progress'])));

    // === CODING KPIs ===
    const codingDateCond = and(gte(codingRequests.createdAt, fromDate), lte(codingRequests.createdAt, toDate));
    const codingByStatus = await db.select({ status: codingRequests.status, count: sql<number>`count(*)::int` }).from(codingRequests).where(codingDateCond).groupBy(codingRequests.status);

    // === USER PERFORMANCE (top performers) ===
    const workers = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(and(eq(users.isActive, true), inArray(users.role, ['ar_executive', 'billing_user'])));

    const userPerformance = await Promise.all(workers.map(async (w) => {
      const [completed] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(eq(claims.assignedTo, w.id), inArray(claims.status, ['approved', 'paid', 'closed']), claimDateCond));
      const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(eq(claims.assignedTo, w.id), claimDateCond));
      const [authDone] = await db.select({ count: sql<number>`count(*)::int` }).from(authorizations).where(and(eq(authorizations.assignedTo, w.id), eq(authorizations.status, 'completed'), authDateCond));
      return { name: `${w.firstName} ${w.lastName}`, claimsCompleted: completed.count, claimsTotal: total.count, authsCompleted: authDone.count };
    }));
    userPerformance.sort((a, b) => b.claimsCompleted - a.claimsCompleted);

    // === AGING BUCKETS (non-overlapping, aged from DOS or created_at across all open unpaid claims) ===
    const now = new Date();
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const d60 = new Date(now); d60.setDate(d60.getDate() - 60);
    const d90 = new Date(now); d90.setDate(d90.getDate() - 90);
    const openStatuses: Array<typeof claims.status.enumValues[number]> = [
      'new',
      'assigned',
      'in_progress',
      'pending',
      'submitted_for_review',
      'rework_required',
      'sent_to_coding',
      'coding_review',
      'coding_corrected',
      'returned_to_billing',
      'resubmitted',
    ];
    const ageTimestamp = sql`COALESCE(${claims.dateOfService}::timestamp, ${claims.createdAt})`;

    const [a0_30] = await db.select({ count: sql<number>`count(*)::int`, total: sql<string>`COALESCE(SUM(balance::numeric),0)::text` }).from(claims).where(and(gte(ageTimestamp, d30), inArray(claims.status, openStatuses)));
    const [a31_60] = await db.select({ count: sql<number>`count(*)::int`, total: sql<string>`COALESCE(SUM(balance::numeric),0)::text` }).from(claims).where(and(gte(ageTimestamp, d60), lt(ageTimestamp, d30), inArray(claims.status, openStatuses)));
    const [a61_90] = await db.select({ count: sql<number>`count(*)::int`, total: sql<string>`COALESCE(SUM(balance::numeric),0)::text` }).from(claims).where(and(gte(ageTimestamp, d90), lt(ageTimestamp, d60), inArray(claims.status, openStatuses)));
    const [a90plus] = await db.select({ count: sql<number>`count(*)::int`, total: sql<string>`COALESCE(SUM(balance::numeric),0)::text` }).from(claims).where(and(lt(ageTimestamp, d90), inArray(claims.status, openStatuses)));

    return NextResponse.json({
      dateRange: { from: dateFrom, to: dateTo },
      kpis: {
        totalClaims: claimTotal.count, paidClaims: claimPaid.count, deniedClaims: claimDenied.count, pendingClaims: claimPending.count,
        totalBilled: parseFloat(billedSum.total), totalPaid: parseFloat(paidSum.total), totalBalance: parseFloat(balanceSum.total),
        denialRate, collectionRate,
        totalAuths: authTotal.count, completedAuths: authCompleted.count, pendingAuths: authPending.count,
      },
      claimsByStatus, trendData,
      claimsByInsurance: claimsByInsurance.map(r => ({ insurance: r.insurance || 'Unknown', count: r.count, totalBilled: parseFloat(r.totalBilled) })),
      codingByStatus,
      userPerformance: userPerformance.slice(0, 15),
      aging: [
        { bucket: '0-30 days', claims: a0_30.count, balance: parseFloat(a0_30.total) },
        { bucket: '31-60 days', claims: a31_60.count, balance: parseFloat(a31_60.total) },
        { bucket: '61-90 days', claims: a61_90.count, balance: parseFloat(a61_90.total) },
        { bucket: '90+ days', claims: a90plus.count, balance: parseFloat(a90plus.total) },
      ],
    });
  } catch (error) {
    console.error('Reports error:', error);
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
