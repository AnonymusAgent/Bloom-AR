import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  users,
  claims,
  authorizations,
  billingTasks,
  notifications,
  organizationMembers,
} from '@/db/schema';
import { eq, and, gte, lte, inArray, sql, desc } from 'drizzle-orm';
import { isSupervisorOrAbove } from '@/lib/auth';
import { sendEmail, buildDigestHtml } from '@/lib/email';
import { requireTenantContext } from '@/lib/tenant-context';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { user, organizationId } = auth.ctx;

    if (!isSupervisorOrAbove(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { userId, sendToAll } = await request.json();

    const targetUsers = sendToAll
      ? await db
          .select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            role: users.role,
          })
          .from(users)
          .innerJoin(
            organizationMembers,
            and(
              eq(organizationMembers.userId, users.id),
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.isActive, true)
            )
          )
          .where(eq(users.isActive, true))
      : userId
      ? await db
          .select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            role: users.role,
          })
          .from(users)
          .innerJoin(
            organizationMembers,
            and(
              eq(organizationMembers.userId, users.id),
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.isActive, true)
            )
          )
          .where(eq(users.id, userId))
      : [];

    if (targetUsers.length === 0) {
      return NextResponse.json(
        { error: 'No matching users found in your organization' },
        { status: 400 }
      );
    }

    const results = [];

    for (const targetUser of targetUsers) {
      const openStatuses: Array<typeof claims.status.enumValues[number]> = [
        'new',
        'assigned',
        'in_progress',
        'pending',
      ];
      const [pendingClaims] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(claims)
        .where(
          and(
            eq(claims.organizationId, organizationId),
            eq(claims.assignedTo, targetUser.id),
            inArray(claims.status, openStatuses)
          )
        );
      const [pendingAuths] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(authorizations)
        .where(
          and(
            eq(authorizations.organizationId, organizationId),
            eq(authorizations.assignedTo, targetUser.id),
            inArray(authorizations.status, ['pending', 'in_progress'])
          )
        );
      const [deniedClaims] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(claims)
        .where(
          and(
            eq(claims.organizationId, organizationId),
            eq(claims.assignedTo, targetUser.id),
            eq(claims.status, 'denied')
          )
        );
      const [pendingTasks] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(billingTasks)
        .where(
          and(
            eq(billingTasks.organizationId, organizationId),
            eq(billingTasks.assignedTo, targetUser.id),
            inArray(billingTasks.status, ['new', 'assigned', 'in_progress'])
          )
        );
      const [pendingReviews] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(claims)
        .where(
          and(
            eq(claims.organizationId, organizationId),
            eq(claims.status, 'submitted_for_review')
          )
        );

      const today = new Date().toISOString().split('T')[0];
      const [overdueTasks] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(billingTasks)
        .where(
          and(
            eq(billingTasks.organizationId, organizationId),
            eq(billingTasks.assignedTo, targetUser.id),
            lte(billingTasks.dueDate, today),
            inArray(billingTasks.status, ['new', 'assigned', 'in_progress'])
          )
        );

      const recentNotifs = await db
        .select({
          title: notifications.title,
          message: notifications.message,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.organizationId, organizationId),
            eq(notifications.userId, targetUser.id),
            gte(notifications.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
          )
        )
        .orderBy(desc(notifications.createdAt))
        .limit(5);

      const html = buildDigestHtml({
        userName: `${targetUser.firstName} ${targetUser.lastName}`,
        pendingClaims: pendingClaims.count,
        pendingAuths: pendingAuths.count,
        pendingTasks: pendingTasks.count,
        deniedClaims: deniedClaims.count,
        pendingReviews: isSupervisorOrAbove(targetUser.role) ? pendingReviews.count : 0,
        overdueTasks: overdueTasks.count,
        recentNotifications: recentNotifs.map((n) => ({
          title: n.title,
          message: n.message,
          createdAt: n.createdAt.toISOString(),
        })),
      });

      const result = await sendEmail({
        to: targetUser.email,
        subject: `BloomAR Manager Daily Digest - ${new Date().toLocaleDateString()}`,
        html,
      });

      results.push({ userId: targetUser.id, email: targetUser.email, ...result });
    }

    return NextResponse.json({
      success: true,
      results,
      sentCount: results.filter((r) => r.success).length,
    });
  } catch (error) {
    console.error('Digest error:', error);
    return NextResponse.json({ error: 'Failed to send digest' }, { status: 500 });
  }
}
