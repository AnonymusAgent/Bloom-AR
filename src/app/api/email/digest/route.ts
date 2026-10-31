import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, claims, authorizations, billingTasks, notifications } from '@/db/schema';
import { eq, and, gte, lte, inArray, sql, desc } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { sendEmail, buildDigestHtml } from '@/lib/email';

// POST - send digest to a specific user or all users
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || !isSupervisorOrAbove(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { userId, sendToAll } = await request.json();

    const targetUsers = sendToAll
      ? await db.select().from(users).where(eq(users.isActive, true))
      : userId
        ? await db.select().from(users).where(eq(users.id, userId))
        : [];

    if (targetUsers.length === 0) {
      return NextResponse.json({ error: 'No users selected' }, { status: 400 });
    }

    const results = [];

    for (const targetUser of targetUsers) {
      // Gather stats for this user
      const openStatuses: Array<typeof claims.status.enumValues[number]> = ['new', 'assigned', 'in_progress', 'pending'];
      const [pendingClaims] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(eq(claims.assignedTo, targetUser.id), inArray(claims.status, openStatuses)));
      const [pendingAuths] = await db.select({ count: sql<number>`count(*)::int` }).from(authorizations).where(and(eq(authorizations.assignedTo, targetUser.id), inArray(authorizations.status, ['pending', 'in_progress'])));
      const [deniedClaims] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(eq(claims.assignedTo, targetUser.id), eq(claims.status, 'denied')));
      const [pendingTasks] = await db.select({ count: sql<number>`count(*)::int` }).from(billingTasks).where(and(eq(billingTasks.assignedTo, targetUser.id), inArray(billingTasks.status, ['new', 'assigned', 'in_progress'])));
      const [pendingReviews] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(eq(claims.status, 'submitted_for_review'));

      // Overdue tasks
      const today = new Date().toISOString().split('T')[0];
      const [overdueTasks] = await db.select({ count: sql<number>`count(*)::int` }).from(billingTasks).where(and(eq(billingTasks.assignedTo, targetUser.id), lte(billingTasks.dueDate, today), inArray(billingTasks.status, ['new', 'assigned', 'in_progress'])));

      // Recent notifications
      const recentNotifs = await db.select({ title: notifications.title, message: notifications.message, createdAt: notifications.createdAt }).from(notifications).where(and(eq(notifications.userId, targetUser.id), gte(notifications.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))).orderBy(desc(notifications.createdAt)).limit(5);

      const html = buildDigestHtml({
        userName: `${targetUser.firstName} ${targetUser.lastName}`,
        pendingClaims: pendingClaims.count,
        pendingAuths: pendingAuths.count,
        pendingTasks: pendingTasks.count,
        deniedClaims: deniedClaims.count,
        pendingReviews: isSupervisorOrAbove(targetUser.role) ? pendingReviews.count : 0,
        overdueTasks: overdueTasks.count,
        recentNotifications: recentNotifs.map(n => ({ title: n.title, message: n.message, createdAt: n.createdAt.toISOString() })),
      });

      const result = await sendEmail({
        to: targetUser.email,
        subject: `BloomAR Manager Daily Digest - ${new Date().toLocaleDateString()}`,
        html,
      });

      results.push({ userId: targetUser.id, email: targetUser.email, ...result });
    }

    return NextResponse.json({ success: true, results, sentCount: results.filter(r => r.success).length });
  } catch (error) {
    console.error('Digest error:', error);
    return NextResponse.json({ error: 'Failed to send digest' }, { status: 500 });
  }
}
