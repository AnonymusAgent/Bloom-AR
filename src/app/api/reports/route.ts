import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  claims,
  authorizations,
  codingRequests,
  users,
  organizationMembers,
} from '@/db/schema';
import { eq, and, gte, lte, lt, sql, inArray, desc } from 'drizzle-orm';
import { canViewReports } from '@/lib/auth';
import { parseEndOfDay } from '@/lib/sanitize';
import { requireTenantContext, mapOrgRoleToOperationalRole } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    if (!canViewReports(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const sp = request.nextUrl.searchParams;
    const dateFrom =
      sp.get('dateFrom') ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const dateTo = sp.get('dateTo') || new Date().toISOString().split('T')[0];

    const fromDate = new Date(dateFrom);
    const toDate = parseEndOfDay(dateTo);

    const claimOrgCond = eq(claims.organizationId, organizationId);
    const claimDateCond = and(
      claimOrgCond,
      gte(claims.createdAt, fromDate),
      lte(claims.createdAt, toDate)
    );

    const [claimTotal] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(claimDateCond);
    const [claimPaid] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(and(claimDateCond, eq(claims.status, 'paid')));
    const [claimDenied] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(and(claimDateCond, eq(claims.status, 'denied')));
    const [claimPending] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(
        and(claimDateCond, inArray(claims.status, ['new', 'assigned', 'in_progress', 'pending']))
      );
    const [billedSum] = await db
      .select({ total: sql<string>`COALESCE(SUM(billed_amount::numeric), 0)::text` })
      .from(claims)
      .where(claimDateCond);
    const [paidSum] = await db
      .select({ total: sql<string>`COALESCE(SUM(paid_amount::numeric), 0)::text` })
      .from(claims)
      .where(claimDateCond);
    const [balanceSum] = await db
      .select({ total: sql<string>`COALESCE(SUM(balance::numeric), 0)::text` })
      .from(claims)
      .where(claimDateCond);

    const denialRate =
      claimTotal.count > 0 ? Math.round((claimDenied.count / claimTotal.count) * 100) : 0;
    const collectionRate =
      parseFloat(billedSum.total) > 0
        ? Math.round((parseFloat(paidSum.total) / parseFloat(billedSum.total)) * 100)
        : 0;

    const claimsByStatus = await db
      .select({ status: claims.status, count: sql<number>`count(*)::int` })
      .from(claims)
      .where(claimDateCond)
      .groupBy(claims.status);

    const trendData = await db
      .select({
        date: sql<string>`TO_CHAR(created_at, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(claims)
      .where(claimDateCond)
      .groupBy(sql`TO_CHAR(created_at, 'YYYY-MM-DD')`)
      .orderBy(sql`TO_CHAR(created_at, 'YYYY-MM-DD')`);

    const claimsByInsurance = await db
      .select({
        insurance: claims.insurance,
        count: sql<number>`count(*)::int`,
        totalBilled: sql<string>`COALESCE(SUM(billed_amount::numeric), 0)::text`,
      })
      .from(claims)
      .where(and(claimDateCond, sql`${claims.insurance} IS NOT NULL`))
      .groupBy(claims.insurance)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const authDateCond = and(
      eq(authorizations.organizationId, organizationId),
      gte(authorizations.createdAt, fromDate),
      lte(authorizations.createdAt, toDate)
    );
    const [authTotal] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(authorizations)
      .where(authDateCond);
    const [authCompleted] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(authorizations)
      .where(and(authDateCond, eq(authorizations.status, 'completed')));
    const [authPending] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(authorizations)
      .where(and(authDateCond, inArray(authorizations.status, ['pending', 'in_progress'])));

    const codingDateCond = and(
      eq(codingRequests.organizationId, organizationId),
      gte(codingRequests.createdAt, fromDate),
      lte(codingRequests.createdAt, toDate)
    );
    const codingByStatus = await db
      .select({ status: codingRequests.status, count: sql<number>`count(*)::int` })
      .from(codingRequests)
      .where(codingDateCond)
      .groupBy(codingRequests.status);

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

    const userPerformance = [];
    for (const w of workers) {
      const [completed] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(claims)
        .where(
          and(
            eq(claims.assignedTo, w.id),
            inArray(claims.status, ['approved', 'paid', 'closed']),
            claimDateCond
          )
        );
      const [total] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(claims)
        .where(and(eq(claims.assignedTo, w.id), claimDateCond));
      const [authDone] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(authorizations)
        .where(
          and(
            eq(authorizations.assignedTo, w.id),
            eq(authorizations.status, 'completed'),
            authDateCond
          )
        );
      userPerformance.push({
        name: `${w.firstName} ${w.lastName}`,
        claimsCompleted: completed.count,
        claimsTotal: total.count,
        authsCompleted: authDone.count,
      });
    }
    userPerformance.sort((a, b) => b.claimsCompleted - a.claimsCompleted);

    const now = new Date();
    const d30 = new Date(now);
    d30.setDate(d30.getDate() - 30);
    const d60 = new Date(now);
    d60.setDate(d60.getDate() - 60);
    const d90 = new Date(now);
    d90.setDate(d90.getDate() - 90);

    const openStatuses: Array<(typeof claims.status.enumValues)[number]> = [
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

    const [a0_30] = await db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`COALESCE(SUM(balance::numeric),0)::text`,
      })
      .from(claims)
      .where(and(claimOrgCond, gte(ageTimestamp, d30), inArray(claims.status, openStatuses)));
    const [a31_60] = await db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`COALESCE(SUM(balance::numeric),0)::text`,
      })
      .from(claims)
      .where(
        and(
          claimOrgCond,
          gte(ageTimestamp, d60),
          lt(ageTimestamp, d30),
          inArray(claims.status, openStatuses)
        )
      );
    const [a61_90] = await db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`COALESCE(SUM(balance::numeric),0)::text`,
      })
      .from(claims)
      .where(
        and(
          claimOrgCond,
          gte(ageTimestamp, d90),
          lt(ageTimestamp, d60),
          inArray(claims.status, openStatuses)
        )
      );
    const [a90plus] = await db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`COALESCE(SUM(balance::numeric),0)::text`,
      })
      .from(claims)
      .where(and(claimOrgCond, lt(ageTimestamp, d90), inArray(claims.status, openStatuses)));

    return NextResponse.json({
      dateRange: { from: dateFrom, to: dateTo },
      kpis: {
        totalClaims: claimTotal.count,
        paidClaims: claimPaid.count,
        deniedClaims: claimDenied.count,
        pendingClaims: claimPending.count,
        totalBilled: parseFloat(billedSum.total),
        totalPaid: parseFloat(paidSum.total),
        totalBalance: parseFloat(balanceSum.total),
        denialRate,
        collectionRate,
        totalAuths: authTotal.count,
        completedAuths: authCompleted.count,
        pendingAuths: authPending.count,
      },
      claimsByStatus,
      trendData,
      claimsByInsurance: claimsByInsurance.map((r) => ({
        insurance: r.insurance || 'Unknown',
        count: r.count,
        totalBilled: parseFloat(r.totalBilled),
      })),
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
