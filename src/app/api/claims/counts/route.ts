import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, organizationMembers } from '@/db/schema';
import { eq, sql, and, or, inArray, gte, isNull } from 'drizzle-orm';
import { ensureSaaSColumns } from '@/lib/db-schema';
import { cleanUuid } from '@/lib/sanitize';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    await ensureSaaSColumns();
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    const practiceId = request.nextUrl.searchParams.get('practiceId');
    const conditions = [eq(claims.organizationId, organizationId)];

    if (!ctx.isReadOnly && ['ar_executive', 'billing_user'].includes(user.role)) {
      conditions.push(eq(claims.assignedTo, user.id));
    } else if (!ctx.isReadOnly && ['team_lead', 'senior_lead'].includes(user.role)) {
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
      conditions.push(
        or(inArray(claims.assignedTo, teamMemberIds), eq(claims.assignedBy, user.id))!
      );
    }

    if (practiceId === 'unassigned') {
      conditions.push(isNull(claims.practiceId));
    } else if (practiceId) {
      const pid = cleanUuid(practiceId);
      if (pid) conditions.push(eq(claims.practiceId, pid));
    }

    const whereClause = and(...conditions);

    const wfCounts = await db
      .select({
        workflowStatus: claims.workflowStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(claims)
      .where(whereClause)
      .groupBy(claims.workflowStatus);

    const wf: Record<string, number> = {};
    wfCounts.forEach((c) => {
      wf[c.workflowStatus || 'unworked'] = c.count;
    });

    const insCounts = await db
      .select({
        claimInsuranceStatus: claims.claimInsuranceStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(claims)
      .where(whereClause)
      .groupBy(claims.claimInsuranceStatus);

    const ins: Record<string, number> = {};
    insCounts.forEach((c) => {
      ins[c.claimInsuranceStatus || 'none'] = c.count;
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [todayWorked] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(
        and(
          eq(claims.organizationId, organizationId),
          eq(claims.workedBy, user.id),
          gte(claims.workedDate, today)
        )
      );
    const [todaySubmitted] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(
        and(
          eq(claims.organizationId, organizationId),
          eq(claims.workedBy, user.id),
          gte(claims.submittedForApprovalAt, today)
        )
      );
    const [todayApproved] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(
        and(
          eq(claims.organizationId, organizationId),
          eq(claims.approvedBy, user.id),
          gte(claims.approvedAt, today)
        )
      );

    return NextResponse.json({
      workflow: {
        unworked: wf['unworked'] || 0,
        working: wf['working'] || 0,
        pending_approval: wf['pending_approval'] || 0,
        rework: wf['rework'] || 0,
        approved: wf['approved'] || 0,
        dead: wf['dead'] || 0,
      },
      insuranceStatus: ins,
      today: {
        worked: todayWorked.count,
        submitted: todaySubmitted.count,
        approved: todayApproved.count,
      },
    });
  } catch (error) {
    console.error('Counts error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
