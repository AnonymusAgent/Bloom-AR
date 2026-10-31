import { NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, billingTasks, authorizations, codingRequests, users, signoffs } from '@/db/schema';
import { eq, sql, and, gte, inArray } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || !isSupervisorOrAbove(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: user ? 403 : 401 });
    }

    const today = new Date(); today.setHours(0,0,0,0);
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);

    // Get active workers
    const workers = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
      .from(users).where(and(eq(users.isActive, true), inArray(users.role, ['ar_executive', 'billing_user'])));

    const userStats = await Promise.all(workers.map(async (w) => {
      const [claimsTotal] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(eq(claims.assignedTo, w.id));
      const [claimsCompleted] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(eq(claims.assignedTo, w.id), inArray(claims.status, ['approved', 'paid', 'closed'])));
      const [claimsDenied] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(eq(claims.assignedTo, w.id), eq(claims.status, 'denied')));
      const [claimsPending] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(eq(claims.assignedTo, w.id), inArray(claims.status, ['new', 'assigned', 'in_progress', 'pending'])));

      const [authTotal] = await db.select({ count: sql<number>`count(*)::int` }).from(authorizations).where(eq(authorizations.assignedTo, w.id));
      const [authCompleted] = await db.select({ count: sql<number>`count(*)::int` }).from(authorizations).where(and(eq(authorizations.assignedTo, w.id), eq(authorizations.status, 'completed')));
      const [authPending] = await db.select({ count: sql<number>`count(*)::int` }).from(authorizations).where(and(eq(authorizations.assignedTo, w.id), inArray(authorizations.status, ['pending', 'in_progress'])));

      const [tasksTotal] = await db.select({ count: sql<number>`count(*)::int` }).from(billingTasks).where(eq(billingTasks.assignedTo, w.id));
      const [tasksCompleted] = await db.select({ count: sql<number>`count(*)::int` }).from(billingTasks).where(and(eq(billingTasks.assignedTo, w.id), inArray(billingTasks.status, ['completed', 'signed_off'])));

      const [todayCompleted] = await db.select({ count: sql<number>`count(*)::int` }).from(billingTasks).where(and(eq(billingTasks.completedBy, w.id), gte(billingTasks.completedAt, today)));

      const totalWork = claimsTotal.count + authTotal.count + tasksTotal.count;
      const completedWork = claimsCompleted.count + authCompleted.count + tasksCompleted.count;

      return {
        id: w.id, name: `${w.firstName} ${w.lastName}`, role: w.role,
        claims: { total: claimsTotal.count, completed: claimsCompleted.count, denied: claimsDenied.count, pending: claimsPending.count },
        authorizations: { total: authTotal.count, completed: authCompleted.count, pending: authPending.count },
        tasks: { total: tasksTotal.count, completed: tasksCompleted.count },
        todayCompleted: todayCompleted.count,
        completionPercentage: totalWork > 0 ? Math.round((completedWork / totalWork) * 100) : 0,
      };
    }));

    // Coding summary
    const codingStats = await db.select({ status: codingRequests.status, count: sql<number>`count(*)::int` }).from(codingRequests).groupBy(codingRequests.status);
    const codingMap: Record<string, number> = {};
    codingStats.forEach(s => { codingMap[s.status] = s.count; });

    // Global counts
    const [totalClaims] = await db.select({ count: sql<number>`count(*)::int` }).from(claims);
    const [totalAuths] = await db.select({ count: sql<number>`count(*)::int` }).from(authorizations);
    const [pendingSignoffs] = await db.select({ count: sql<number>`count(*)::int` }).from(signoffs).where(eq(signoffs.status, 'pending'));

    return NextResponse.json({
      userProductivity: userStats,
      coding: { pending: (codingMap['sent_to_coding'] || 0) + (codingMap['under_review'] || 0), completed: (codingMap['corrected'] || 0) + (codingMap['returned_to_billing'] || 0) + (codingMap['resubmitted'] || 0), byStatus: codingMap },
      totals: { claims: totalClaims.count, authorizations: totalAuths.count, pendingSignoffs: pendingSignoffs.count },
    });
  } catch (error) {
    console.error('Productivity error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
