import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { denialCodes } from '@/db/schema';
import { eq, ilike, or, and, isNull } from 'drizzle-orm';
import { canManageUsers } from '@/lib/auth';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { ensureStandardDenialCodes } from '@/lib/standard-denial-codes';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    await ensureStandardDenialCodes();

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');
    const codeType = searchParams.get('codeType');
    const category = searchParams.get('category');

    // Return global standard X12 CARC/RARC codes PLUS custom codes belonging ONLY to this organization
    const conditions = [
      or(
        isNull(denialCodes.organizationId),
        eq(denialCodes.organizationId, ctx.organizationId)
      )!,
      eq(denialCodes.isActive, true),
    ];

    if (search) {
      conditions.push(
        or(
          ilike(denialCodes.code, `%${search}%`),
          ilike(denialCodes.description, `%${search}%`),
          ilike(denialCodes.category, `%${search}%`)
        )!
      );
    }

    if (codeType) {
      conditions.push(eq(denialCodes.codeType, codeType));
    }

    if (category) {
      conditions.push(eq(denialCodes.category, category));
    }

    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '500') || 500, 1), 1000);

    const codes = await db
      .select()
      .from(denialCodes)
      .where(and(...conditions))
      .orderBy(denialCodes.code)
      .limit(limit);

    return NextResponse.json({ denialCodes: codes });
  } catch (error) {
    console.error('Get denial codes error:', error);
    return NextResponse.json({ error: 'Failed to fetch denial codes' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    if (!canManageUsers(ctx.user.role)) {
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

    const normalizedCode = String(code).trim().toUpperCase();

    const [existing] = await db
      .select()
      .from(denialCodes)
      .where(
        and(
          eq(denialCodes.code, normalizedCode),
          or(
            isNull(denialCodes.organizationId),
            eq(denialCodes.organizationId, ctx.organizationId)
          )
        )
      )
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: 'Denial code already exists in standard or workspace catalog' },
        { status: 400 }
      );
    }

    const [newCode] = await db
      .insert(denialCodes)
      .values({
        organizationId: ctx.organizationId,
        code: normalizedCode,
        codeType,
        description: String(description).trim(),
        category: category || null,
      })
      .returning();

    await createAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      actorRole: ctx.orgRole,
      action: AUDIT_ACTIONS.DENIAL_CODE_ADDED,
      entityType: 'denialCode',
      entityId: String(newCode.id),
      newValue: { code: normalizedCode, codeType, description, category },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ denialCode: newCode });
  } catch (error) {
    console.error('Create denial code error:', error);
    return NextResponse.json({ error: 'Failed to create denial code' }, { status: 500 });
  }
}
