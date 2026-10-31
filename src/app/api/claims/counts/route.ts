import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, users } from '@/db/schema';
import { eq, sql, and, or, inArray, gte, isNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { ensureSaaSColumns } from '@/lib/db-schema';
import { cleanUuid } from '@/lib/sanitize';

export async function GET(request: NextRequest) {
  try {
    await ensureSaaSColumns();
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const practiceId = request.nextUrl.searchParams.get('practiceId');
    const conditions = [];

    // Match GET /api/claims RBAC exactly
    if (['ar_executive', 'billing_user'].includes(user.role)) {
      conditions.push(eq(claims.assignedTo, user.id));
    } else if (['team_lead', 'senior_lead'].includes(user.role)) {
      const teamMembers = await db.select({ id: users.id }).from(users).where(eq(users.teamLeadId, user.id));
      const teamMemberIds = [user.id, ...teamMembers.map((m) => m.id)];
      conditions.push(or(inArray(claims.assignedTo, teamMemberIds), eq(claims.assignedBy, user.id)));
    }

    if (practiceId === 'unassigned') {
      conditions.push(isNull(claims.practiceId));
    } else if (practiceId) {
      const pid = cleanUuid(practiceId);
      if (pid) conditions.push(eq(claims.practiceId, pid));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Workflow counts
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

    // Insurance status counts (for Record tab)
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

    // Today's stats for the user
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [todayWorked] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(and(eq(claims.workedBy, user.id), gte(claims.workedDate, today)));
    const [todaySubmitted] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(and(eq(claims.workedBy, user.id), gte(claims.submittedForApprovalAt, today)));
    const [todayApproved] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(and(eq(claims.approvedBy, user.id), gte(claims.approvedAt, today)));

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
