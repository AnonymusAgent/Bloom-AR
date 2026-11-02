import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { patients } from '@/db/schema';
import { eq, and, or, ilike, desc, sql } from 'drizzle-orm';
import { createAuditLog } from '@/lib/audit';
import { cleanDate, cleanPage, cleanLimit } from '@/lib/sanitize';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const sp = request.nextUrl.searchParams;
    const search = sp.get('search')?.trim();
    const page = cleanPage(sp.get('page'));
    const limit = cleanLimit(sp.get('limit'), 20, 100);

    const conditions = [
      eq(patients.organizationId, ctx.organizationId),
      eq(patients.isActive, true),
    ];

    if (search) {
      conditions.push(
        or(
          ilike(patients.firstName, `%${search}%`),
          ilike(patients.lastName, `%${search}%`),
          ilike(patients.phone, `%${search}%`),
          ilike(patients.memberId, `%${search}%`),
          ilike(patients.email, `%${search}%`)
        )!
      );
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(patients)
      .where(and(...conditions));

    const rows = await db
      .select()
      .from(patients)
      .where(and(...conditions))
      .orderBy(desc(patients.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return NextResponse.json({
      patients: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    console.error('Get patients error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const body = await request.json();
    const {
      firstName,
      lastName,
      middleName,
      gender,
      address,
      city,
      state,
      zip,
      phone,
      email,
      memberId,
      groupNumber,
      subscriberName,
      relationshipToSubscriber,
    } = body;

    if (!firstName || !lastName) {
      return NextResponse.json(
        { error: 'First and last name are required' },
        { status: 400 }
      );
    }

    const dateOfBirth = cleanDate(body.dateOfBirth);

    const dupeConditions = [
      eq(patients.organizationId, ctx.organizationId),
      ilike(patients.firstName, firstName),
      ilike(patients.lastName, lastName),
    ];
    if (dateOfBirth) dupeConditions.push(eq(patients.dateOfBirth, dateOfBirth));

    const [dupe] = await db
      .select({ id: patients.id })
      .from(patients)
      .where(and(...dupeConditions))
      .limit(1);

    const [patient] = await db
      .insert(patients)
      .values({
        organizationId: ctx.organizationId,
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        middleName: middleName ? String(middleName).trim() : null,
        dateOfBirth,
        gender: gender || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zip: zip || null,
        phone: phone || null,
        email: email || null,
        memberId: memberId || null,
        groupNumber: groupNumber || null,
        subscriberName: subscriberName || null,
        relationshipToSubscriber: relationshipToSubscriber || null,
      })
      .returning();

    await createAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      actorRole: ctx.orgRole,
      action: 'patient_created',
      entityType: 'patient',
      entityId: patient.id,
      newValue: { firstName, lastName },
    });

    return NextResponse.json({
      patient,
      duplicateWarning: dupe
        ? 'A similar patient record already exists in your organization. Please verify.'
        : null,
    });
  } catch (error) {
    console.error('Create patient error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
