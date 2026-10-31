import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { authorizations, users } from '@/db/schema';
import { eq, and, or, ilike, desc, sql, inArray } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getUserAuthorizedUserIds } from '@/lib/rbac';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { cleanUuid, cleanDate, cleanPage, cleanLimit } from '@/lib/sanitize';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = request.nextUrl.searchParams;
    const search = sp.get('search')?.trim();
    const status = sp.get('status');
    const assignedTo = cleanUuid(sp.get('assignedTo'));
    const page = cleanPage(sp.get('page'));
    const limit = cleanLimit(sp.get('limit'), 20, 100);

    const authorizedUsers = await getUserAuthorizedUserIds(user);
    const scopeCondition =
      authorizedUsers === 'all'
        ? undefined
        : inArray(authorizations.assignedTo, authorizedUsers);

    const conditions = [];
    if (scopeCondition) conditions.push(scopeCondition);
    if (search) {
      conditions.push(
        or(
          ilike(authorizations.patientName, `%${search}%`),
          ilike(authorizations.insuranceName, `%${search}%`),
          ilike(authorizations.authNumber, `%${search}%`)
        )!
      );
    }
    if (status) {
      conditions.push(
        eq(authorizations.status, status as 'pending' | 'in_progress' | 'completed' | 'denied' | 'expired')
      );
    }
    if (assignedTo) {
      conditions.push(eq(authorizations.assignedTo, assignedTo));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(authorizations)
      .where(whereClause);

    const rows = await db
      .select()
      .from(authorizations)
      .where(whereClause)
      .orderBy(desc(authorizations.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const withNames = await Promise.all(
      rows.map(async (a) => {
        let assigneeName = null;
        if (a.assignedTo) {
          const [u] = await db
            .select({ firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(eq(users.id, a.assignedTo))
            .limit(1);
          assigneeName = u ? `${u.firstName} ${u.lastName}` : null;
        }
        return { ...a, assigneeName };
      })
    );

    const stats = await db
      .select({
        status: authorizations.status,
        count: sql<number>`count(*)::int`,
      })
      .from(authorizations)
      .where(scopeCondition)
      .groupBy(authorizations.status);

    const statusMap: Record<string, number> = {};
    stats.forEach((s) => {
      statusMap[s.status] = s.count;
    });

    return NextResponse.json({
      authorizations: withNames,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
      stats: {
        total: Object.values(statusMap).reduce((a, b) => a + b, 0),
        pending: (statusMap['pending'] || 0) + (statusMap['in_progress'] || 0),
        completed: statusMap['completed'] || 0,
        denied: statusMap['denied'] || 0,
      },
    });
  } catch (error) {
    console.error('Get authorizations error:', error);
    return NextResponse.json({ error: 'Failed to fetch authorizations' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const {
      patientName,
      insuranceName,
      authNumber,
      serviceRequested,
      cptCodes,
      diagnosisCodes,
      notes,
    } = body;

    if (!patientName || !insuranceName) {
      return NextResponse.json({ error: 'Patient name and insurance name are required' }, { status: 400 });
    }

    const claimId = cleanUuid(body.claimId);
    const practiceId = cleanUuid(body.practiceId);
    const assignedTo = cleanUuid(body.assignedTo);
    const expirationDate = cleanDate(body.expirationDate);
    const dateObtained = cleanDate(body.dateObtained);

    const [newAuth] = await db
      .insert(authorizations)
      .values({
        patientName: String(patientName).trim(),
        insuranceName: String(insuranceName).trim(),
        authNumber: authNumber ? String(authNumber).trim() : null,
        serviceRequested: serviceRequested ? String(serviceRequested).trim() : null,
        cptCodes: cptCodes ? String(cptCodes).trim() : null,
        diagnosisCodes: diagnosisCodes ? String(diagnosisCodes).trim() : null,
        notes: notes ? String(notes).trim() : null,
        claimId,
        practiceId,
        dateObtained,
        expirationDate,
        status: assignedTo ? 'in_progress' : 'pending',
        assignedTo,
        assignedBy: user.id,
        assignedAt: assignedTo ? new Date() : undefined,
      })
      .returning();

    if (assignedTo) {
      await createNotification({
        userId: assignedTo,
        type: 'task_assigned',
        title: 'New Authorization Assigned',
        message: `Authorization for ${patientName} (${insuranceName}) has been assigned to you`,
      });
    }

    await createAuditLog({
      userId: user.id,
      action: 'authorization_created',
      entityType: 'authorization',
      entityId: newAuth.id,
      newValue: { patientName, insuranceName },
    });

    return NextResponse.json({ authorization: newAuth });
  } catch (error) {
    console.error('Create authorization error:', error);
    return NextResponse.json({ error: 'Failed to create authorization' }, { status: 500 });
  }
}
