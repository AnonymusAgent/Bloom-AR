import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims } from '@/db/schema';
import { desc, ilike, or, sql, eq, and, inArray } from 'drizzle-orm';
import { authenticateApiKey } from '@/lib/api-auth';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { getUserAuthorizedPracticeIds, getUserAuthorizedUserIds } from '@/lib/rbac';
import { cleanPage, cleanLimit } from '@/lib/sanitize';

async function getAuth(request: NextRequest) {
  const apiAuth = await authenticateApiKey(request);
  if (apiAuth) return { user: apiAuth.user, organizationId: apiAuth.apiKey.organizationId };
  const user = await getCurrentUser();
  return user ? { user, organizationId: null } : null;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuth(request);
    if (!auth || !auth.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { user, organizationId } = auth;

    const sp = request.nextUrl.searchParams;
    const search = sp.get('search')?.trim();
    const page = cleanPage(sp.get('page'));
    const limit = cleanLimit(sp.get('limit'), 50, 100);

    const conditions = [];

    if (organizationId) {
      conditions.push(eq(claims.organizationId, organizationId));
    }

    if (!isSupervisorOrAbove(user.role)) {
      const authorizedPractices = await getUserAuthorizedPracticeIds(user);
      const authorizedUsers = await getUserAuthorizedUserIds(user);
      const visibility = [];
      if (authorizedUsers !== 'all' && authorizedUsers.length > 0) {
        visibility.push(inArray(claims.assignedTo, authorizedUsers));
      }
      if (authorizedPractices !== 'all' && authorizedPractices.length > 0) {
        visibility.push(inArray(claims.practiceId, authorizedPractices));
      }
      if (visibility.length === 0) {
        return NextResponse.json({ data: [], meta: { page, limit, total: 0, totalPages: 0 } });
      }
      conditions.push(visibility.length === 1 ? visibility[0] : or(...visibility)!);
    }

    if (search) {
      conditions.push(or(ilike(claims.claimNumber, `%${search}%`), ilike(claims.patientName, `%${search}%`))!);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(whereClause);

    const rows = await db
      .select({
        id: claims.id,
        claimNumber: claims.claimNumber,
        accountNumber: claims.accountNumber,
        patientName: claims.patientName,
        dateOfService: claims.dateOfService,
        cptCodes: claims.cptCodes,
        provider: claims.provider,
        insurance: claims.insurance,
        billedAmount: claims.billedAmount,
        paidAmount: claims.paidAmount,
        balance: claims.balance,
        status: claims.status,
        createdAt: claims.createdAt,
      })
      .from(claims)
      .where(whereClause)
      .orderBy(desc(claims.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return NextResponse.json({
      data: rows,
      meta: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    console.error('API v1 claims error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
