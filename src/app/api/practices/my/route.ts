import { NextResponse } from 'next/server';
import { db } from '@/db';
import { practices } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { getUserAuthorizedPracticeIds } from '@/lib/rbac';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET() {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const authorized = await getUserAuthorizedPracticeIds(ctx.user, ctx.organizationId);

    let result: Array<{ id: string; name: string; code: string; specialty: string | null }> = [];
    if (authorized === 'all') {
      result = await db
        .select({
          id: practices.id,
          name: practices.name,
          code: practices.code,
          specialty: practices.specialty,
        })
        .from(practices)
        .where(
          and(
            eq(practices.organizationId, ctx.organizationId),
            eq(practices.isActive, true)
          )
        )
        .orderBy(practices.name);
    } else if (authorized.length === 0) {
      result = [];
    } else {
      result = await db
        .select({
          id: practices.id,
          name: practices.name,
          code: practices.code,
          specialty: practices.specialty,
        })
        .from(practices)
        .where(
          and(
            eq(practices.organizationId, ctx.organizationId),
            inArray(practices.id, authorized)
          )
        )
        .orderBy(practices.name);
    }

    return NextResponse.json({ practices: result });
  } catch (error) {
    console.error('Get my practices error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
