import { NextResponse } from 'next/server';
import { db } from '@/db';
import {
  claims,
  billingTasks,
  authorizations,
  codingRequests,
  users,
  signoffs,
  organizationMembers,
} from '@/db/schema';
import { eq, sql, and, gte, inArray } from 'drizzle-orm';
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

    const userStats = [];
    for (const w of workers) {
      const [claimsTotal] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(claims)
        .where(and(eq(claims.organizationId, organizationId), eq(claims.assignedTo, w.id)));
      const [claimsCompleted] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(claims)
        .where(
          and(
            eq(claims.organizationId, organizationId),
            eq(claims.assignedTo, w.id),
            inArray(claims.status, ['approved', 'paid', 'closed'])
          )
        );
      const [claimsDenied] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(claims)
        .where(
          and(
            eq(claims.organizationId, organizationId),
            eq(claims.assignedTo, w.id),
            eq(claims.status, 'denied')
          )
        );
      const [claimsPending] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(claims)
        .where(
          and(
            eq(claims.organizationId, organizationId),
            eq(claims.assignedTo, w.id),
            inArray(claims.status, ['new', 'assigned', 'in_progress', 'pending'])
          )
        );

      const [authTotal] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(authorizations)
        .where(
          and(
            eq(authorizations.organizationId, organizationId),
            eq(authorizations.assignedTo, w.id)
          )
        );
      const [authCompleted] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(authorizations)
        .where(
          and(
            eq(authorizations.organizationId, organizationId),
            eq(authorizations.assignedTo, w.id),
            eq(authorizations.status, 'completed')
          )
        );
      const [authPending] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(authorizations)
        .where(
          and(
            eq(authorizations.organizationId, organizationId),
            eq(authorizations.assignedTo, w.id),
            inArray(authorizations.status, ['pending', 'in_progress'])
          )
        );

      const [tasksTotal] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(billingTasks)
        .where(
          and(
            eq(billingTasks.organizationId, organizationId),
            eq(billingTasks.assignedTo, w.id)
          )
        );
      const [tasksCompleted] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(billingTasks)
        .where(
          and(
            eq(billingTasks.organizationId, organizationId),
            eq(billingTasks.assignedTo, w.id),
            inArray(billingTasks.status, ['completed', 'signed_off'])
          )
        );

      const [todayCompleted] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(billingTasks)
        .where(
          and(
            eq(billingTasks.organizationId, organizationId),
            eq(billingTasks.completedBy, w.id),
            gte(billingTasks.completedAt, today)
          )
        );

      const totalWork = claimsTotal.count + authTotal.count + tasksTotal.count;
      const completedWork = claimsCompleted.count + authCompleted.count + tasksCompleted.count;

      userStats.push({
        id: w.id,
        name: `${w.firstName} ${w.lastName}`,
        role: w.role,
        claims: {
          total: claimsTotal.count,
          completed: claimsCompleted.count,
          denied: claimsDenied.count,
          pending: claimsPending.count,
        },
        authorizations: {
          total: authTotal.count,
          completed: authCompleted.count,
          pending: authPending.count,
        },
        tasks: { total: tasksTotal.count, completed: tasksCompleted.count },
        todayCompleted: todayCompleted.count,
        completionPercentage: totalWork > 0 ? Math.round((completedWork / totalWork) * 100) : 0,
      });
    }

    const codingStats = await db
      .select({ status: codingRequests.status, count: sql<number>`count(*)::int` })
      .from(codingRequests)
      .where(eq(codingRequests.organizationId, organizationId))
      .groupBy(codingRequests.status);
    const codingMap: Record<string, number> = {};
    codingStats.forEach((s) => {
      codingMap[s.status] = s.count;
    });

    const [totalClaims] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(eq(claims.organizationId, organizationId));
    const [totalAuths] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(authorizations)
      .where(eq(authorizations.organizationId, organizationId));
    const [pendingSignoffs] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(signoffs)
      .where(and(eq(signoffs.organizationId, organizationId), eq(signoffs.status, 'pending')));

    return NextResponse.json({
      userProductivity: userStats,
      coding: {
        pending: (codingMap['sent_to_coding'] || 0) + (codingMap['under_review'] || 0),
        completed:
          (codingMap['corrected'] || 0) +
          (codingMap['returned_to_billing'] || 0) +
          (codingMap['resubmitted'] || 0),
        byStatus: codingMap,
      },
      totals: {
        claims: totalClaims.count,
        authorizations: totalAuths.count,
        pendingSignoffs: pendingSignoffs.count,
      },
    });
  } catch (error) {
    console.error('Productivity error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
