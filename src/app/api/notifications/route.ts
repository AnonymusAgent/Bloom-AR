import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { notifications } from '@/db/schema';
import { eq, desc, and, sql, or, isNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { resolveTenantContext } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenant = await resolveTenantContext();
    const activeOrgId = tenant.status === 'ok' ? tenant.ctx.organizationId : null;

    const searchParams = request.nextUrl.searchParams;
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20') || 20, 1), 100);

    const orgScope = activeOrgId
      ? or(eq(notifications.organizationId, activeOrgId), isNull(notifications.organizationId))!
      : isNull(notifications.organizationId);

    const conditions = [eq(notifications.userId, user.id), orgScope];

    if (unreadOnly) {
      conditions.push(eq(notifications.isRead, false));
    }

    const result = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), orgScope, eq(notifications.isRead, false)));

    return NextResponse.json({
      notifications: result,
      unreadCount: count,
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}
