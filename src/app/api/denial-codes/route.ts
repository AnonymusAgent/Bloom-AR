import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { denialCodes } from '@/db/schema';
import { eq, ilike, or, and, sql } from 'drizzle-orm';
import { getCurrentUser, canManageUsers } from '@/lib/auth';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { ALL_DENIAL_CODES } from '@/lib/denial-codes-data';

async function ensureBuiltinDenialCodes(): Promise<void> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(denialCodes);
  if (count > 0) return;
  const seen = new Set<string>();
  const batch = [];
  for (const c of ALL_DENIAL_CODES) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    batch.push({
      code: c.code,
      codeType: c.codeType,
      description: c.description,
      category: c.category,
    });
  }
  if (batch.length > 0) {
    await db.insert(denialCodes).values(batch).onConflictDoNothing();
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await ensureBuiltinDenialCodes();

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');
    const codeType = searchParams.get('codeType');
    const category = searchParams.get('category');

    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(denialCodes.code, `%${search}%`),
          ilike(denialCodes.description, `%${search}%`),
          ilike(denialCodes.category, `%${search}%`)
        )
      );
    }

    if (codeType) {
      conditions.push(eq(denialCodes.codeType, codeType));
    }

    if (category) {
      conditions.push(eq(denialCodes.category, category));
    }

    conditions.push(eq(denialCodes.isActive, true));

    const limit = parseInt(searchParams.get('limit') || '500');

    const codes = await db
      .select()
      .from(denialCodes)
      .where(and(...conditions))
      .orderBy(denialCodes.code)
      .limit(limit);

    return NextResponse.json({ denialCodes: codes });
  } catch (error) {
    console.error('Get denial codes error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch denial codes' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || !canManageUsers(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { code, codeType, description, category } = await request.json();

    if (!code || !codeType || !description) {
      return NextResponse.json(
        { error: 'Code, type, and description are required' },
        { status: 400 }
      );
    }

    if (!['CARC', 'RARC'].includes(codeType)) {
      return NextResponse.json(
        { error: 'Code type must be CARC or RARC' },
        { status: 400 }
      );
    }

    // Check if code already exists
    const [existing] = await db
      .select()
      .from(denialCodes)
      .where(eq(denialCodes.code, code))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: 'Denial code already exists' },
        { status: 400 }
      );
    }

    const [newCode] = await db
      .insert(denialCodes)
      .values({
        code,
        codeType,
        description,
        category: category || null,
      })
      .returning();

    await createAuditLog({
      userId: user.id,
      action: AUDIT_ACTIONS.DENIAL_CODE_ADDED,
      entityType: 'denialCode',
      entityId: String(newCode.id),
      newValue: { code, codeType, description, category },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ denialCode: newCode });
  } catch (error) {
    console.error('Create denial code error:', error);
    return NextResponse.json(
      { error: 'Failed to create denial code' },
      { status: 500 }
    );
  }
}
