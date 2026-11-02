import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { practices } from '@/db/schema';
import { eq, and, ilike, or, desc } from 'drizzle-orm';
import { canAssignPractices } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');
    const isActive = searchParams.get('isActive');

    const conditions = [eq(practices.organizationId, ctx.organizationId)];

    if (search) {
      conditions.push(
        or(ilike(practices.name, `%${search}%`), ilike(practices.code, `%${search}%`))!
      );
    }

    if (isActive !== null && isActive !== undefined) {
      conditions.push(eq(practices.isActive, isActive === 'true'));
    }

    const result = await db
      .select()
      .from(practices)
      .where(and(...conditions))
      .orderBy(desc(practices.createdAt));

    return NextResponse.json({ practices: result });
  } catch (error) {
    console.error('Get practices error:', error);
    return NextResponse.json({ error: 'Failed to fetch practices' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    if (!canAssignPractices(ctx.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const { name, code, address, phone, email, npi, taxId, specialty } = body;

    if (!name || !code) {
      return NextResponse.json({ error: 'Name and code are required' }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(practices)
      .where(
        and(
          eq(practices.organizationId, ctx.organizationId),
          eq(practices.code, String(code).trim())
        )
      )
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: 'Practice with this code already exists in your organization' },
        { status: 400 }
      );
    }

    const [newPractice] = await db
      .insert(practices)
      .values({
        organizationId: ctx.organizationId,
        name: String(name).trim(),
        code: String(code).trim(),
        address: address || null,
        phone: phone || null,
        email: email || null,
        npi: npi || null,
        taxId: taxId || null,
        specialty: specialty || null,
      })
      .returning();

    await createAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      actorRole: ctx.orgRole,
      action: 'practice_created',
      entityType: 'practice',
      entityId: newPractice.id,
      newValue: { name, code },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ practice: newPractice });
  } catch (error) {
    console.error('Create practice error:', error);
    return NextResponse.json({ error: 'Failed to create practice' }, { status: 500 });
  }
}
