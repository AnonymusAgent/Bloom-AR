import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, users, practices, claimStatusHistory } from '@/db/schema';
import { eq, and, or, ilike, desc, asc, inArray, gte, lte, isNull, sql } from 'drizzle-orm';
import { getCurrentUser, canAssignClaims } from '@/lib/auth';
import { ensureSaaSColumns } from '@/lib/db-schema';
import { cleanUuid, cleanDate, cleanPage, cleanLimit } from '@/lib/sanitize';

export async function GET(request: NextRequest) {
  try {
    await ensureSaaSColumns();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');
    const status = searchParams.get('status');
    const assignedTo = searchParams.get('assignedTo');
    const insurance = searchParams.get('insurance');
    const provider = searchParams.get('provider');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const page = cleanPage(searchParams.get('page'));
    const limit = cleanLimit(searchParams.get('limit'), 20, 200);

    const conditions = [];

    // Role-based filtering using RBAC
    if (['ar_executive', 'billing_user'].includes(user.role)) {
      conditions.push(eq(claims.assignedTo, user.id));
    } else if (['team_lead', 'senior_lead'].includes(user.role)) {
      const teamMembers = await db.select({ id: users.id }).from(users).where(eq(users.teamLeadId, user.id));
      const teamMemberIds = [user.id, ...teamMembers.map((m) => m.id)];
      conditions.push(or(inArray(claims.assignedTo, teamMemberIds), eq(claims.assignedBy, user.id)));
    }
    // Admins, Supervisors, Managers see all claims

    // Practice filter
    const rawPracticeId = searchParams.get('practiceId');
    if (rawPracticeId === 'unassigned') {
      conditions.push(isNull(claims.practiceId));
    } else if (rawPracticeId) {
      const pid = cleanUuid(rawPracticeId);
      if (pid) conditions.push(eq(claims.practiceId, pid));
    }

    // Search filter (claim #, patient, account #, payer/insurance, provider)
    if (search) {
      conditions.push(
        or(
          ilike(claims.claimNumber, `%${search}%`),
          ilike(claims.patientName, `%${search}%`),
          ilike(claims.accountNumber, `%${search}%`),
          ilike(claims.insurance, `%${search}%`),
          ilike(claims.payer, `%${search}%`),
          ilike(claims.provider, `%${search}%`)
        )
      );
    }

    // Status filter
    if (status) {
      const statuses = status.split(',') as Array<(typeof claims.status.enumValues)[number]>;
      conditions.push(inArray(claims.status, statuses));
    }

    // Workflow status filter
    const workflowStatus = searchParams.get('workflowStatus');
    if (workflowStatus) {
      const wfStatuses = workflowStatus.split(',');
      conditions.push(inArray(claims.workflowStatus, wfStatuses));
    }

    // Insurance status filter
    const insuranceStatus = searchParams.get('insuranceStatus');
    if (insuranceStatus === 'partial_paid') {
      conditions.push(
        or(
          eq(claims.claimInsuranceStatus, 'partial_paid'),
          and(
            sql`COALESCE(${claims.paidAmount}::numeric, 0) > 0`,
            sql`COALESCE(${claims.balance}::numeric, 0) > 0`
          )
        )!
      );
    } else if (insuranceStatus === 'rejected') {
      conditions.push(
        or(eq(claims.claimInsuranceStatus, 'rejected'), eq(claims.status, 'rework_required'))!
      );
    } else if (insuranceStatus) {
      conditions.push(eq(claims.claimInsuranceStatus, insuranceStatus));
    }

    // Assigned to filter
    if (assignedTo === 'unassigned') {
      conditions.push(isNull(claims.assignedTo));
    } else if (assignedTo) {
      const aid = cleanUuid(assignedTo);
      if (aid) conditions.push(eq(claims.assignedTo, aid));
    }

    // Insurance filter
    if (insurance) {
      conditions.push(ilike(claims.insurance, `%${insurance}%`));
    }

    // Provider filter
    if (provider) {
      conditions.push(ilike(claims.provider, `%${provider}%`));
    }

    // Date range filter
    if (dateFrom) {
      conditions.push(gte(claims.dateOfService, dateFrom));
    }
    if (dateTo) {
      conditions.push(lte(claims.dateOfService, dateTo));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(whereClause);

    const sortColumn =
      sortBy === 'createdAt'
        ? claims.createdAt
        : sortBy === 'claimNumber'
        ? claims.claimNumber
        : sortBy === 'patientName'
        ? claims.patientName
        : sortBy === 'status'
        ? claims.status
        : sortBy === 'billedAmount'
        ? claims.billedAmount
        : claims.createdAt;

    const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

    const result = await db
      .select({
        id: claims.id,
        claimNumber: claims.claimNumber,
        accountNumber: claims.accountNumber,
        patientName: claims.patientName,
        dateOfService: claims.dateOfService,
        cptCodes: claims.cptCodes,
        provider: claims.provider,
        insurance: claims.insurance,
        payer: claims.payer,
        billedAmount: claims.billedAmount,
        paidAmount: claims.paidAmount,
        balance: claims.balance,
        status: claims.status,
        priority: claims.priority,
        practiceId: claims.practiceId,
        assignedTo: claims.assignedTo,
        assignedAt: claims.assignedAt,
        subStatus: claims.subStatus,
        workflowStatus: claims.workflowStatus,
        claimInsuranceStatus: claims.claimInsuranceStatus,
        workedDate: claims.workedDate,
        workedBy: claims.workedBy,
        submittedForApprovalAt: claims.submittedForApprovalAt,
        followUpDate: claims.followUpDate,
        reworkReason: claims.reworkReason,
        reworkCount: claims.reworkCount,
        approvedBy: claims.approvedBy,
        createdAt: claims.createdAt,
        updatedAt: claims.updatedAt,
      })
      .from(claims)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset((page - 1) * limit);

    // Batch-resolve user names and practice details in parallel (zero N+1)
    const userIds = Array.from(
      new Set(
        result.flatMap((c) => [c.assignedTo, c.approvedBy, c.workedBy].filter((id): id is string => Boolean(id)))
      )
    );
    const practiceIds = Array.from(
      new Set(result.map((c) => c.practiceId).filter((id): id is string => Boolean(id)))
    );

    const [nameRows, practiceRows] = await Promise.all([
      userIds.length > 0
        ? db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(inArray(users.id, userIds))
        : Promise.resolve([]),
      practiceIds.length > 0
        ? db
            .select({ id: practices.id, name: practices.name, code: practices.code })
            .from(practices)
            .where(inArray(practices.id, practiceIds))
        : Promise.resolve([]),
    ]);

    const namesById = new Map(nameRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const practicesById = new Map(practiceRows.map((p) => [p.id, p]));

    const claimsWithDetails = result.map((claim) => {
      const p = claim.practiceId ? practicesById.get(claim.practiceId) : undefined;
      return {
        ...claim,
        assigneeName: claim.assignedTo ? namesById.get(claim.assignedTo) || null : null,
        approvedByName: claim.approvedBy ? namesById.get(claim.approvedBy) || null : null,
        workedByName: claim.workedBy ? namesById.get(claim.workedBy) || null : null,
        practiceName: p?.name || null,
        practiceCode: p?.code || null,
      };
    });

    return NextResponse.json({
      claims: claimsWithDetails,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.max(1, Math.ceil(count / limit)),
      },
    });
  } catch (error) {
    console.error('Get claims error:', error);
    return NextResponse.json({ error: 'Failed to fetch claims' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureSaaSColumns();
    const user = await getCurrentUser();
    if (!user || !canAssignClaims(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const {
      claimNumber,
      accountNumber,
      patientName,
      cptCodes,
      diagnosisCode,
      location,
      provider,
      insurance,
      payer,
      denialReason,
      priority,
      status: requestedStatus,
    } = body;
    const dateOfService = cleanDate(body.dateOfService);
    const practiceId = cleanUuid(body.practiceId);
    const billedAmount = body.billedAmount !== undefined && body.billedAmount !== '' ? String(body.billedAmount) : null;
    const paidAmount = body.paidAmount !== undefined && body.paidAmount !== '' ? String(body.paidAmount) : '0';
    const balance =
      body.balance !== undefined && body.balance !== ''
        ? String(body.balance)
        : billedAmount !== null
        ? Math.max(0, (parseFloat(billedAmount) || 0) - (parseFloat(paidAmount) || 0)).toFixed(2)
        : null;

    if (!claimNumber) {
      return NextResponse.json({ error: 'Claim number is required' }, { status: 400 });
    }

    if (practiceId) {
      const [practice] = await db
        .select({ id: practices.id })
        .from(practices)
        .where(eq(practices.id, practiceId))
        .limit(1);
      if (!practice) {
        return NextResponse.json({ error: 'Selected practice not found' }, { status: 400 });
      }
    }

    const validInitialStatuses = new Set([
      'new',
      'assigned',
      'in_progress',
      'pending',
      'denied',
      'paid',
      'closed',
    ]);
    const initialStatus: typeof claims.$inferSelect.status =
      typeof requestedStatus === 'string' && validInitialStatuses.has(requestedStatus)
        ? (requestedStatus as typeof claims.$inferSelect.status)
        : 'new';

    const [newClaim] = await db
      .insert(claims)
      .values({
        claimNumber,
        accountNumber: accountNumber || null,
        patientName: patientName || null,
        dateOfService,
        cptCodes: cptCodes || null,
        diagnosisCode: diagnosisCode ? String(diagnosisCode).slice(0, 100) : null,
        location: location || null,
        provider: provider || null,
        insurance: insurance || null,
        payer: payer || null,
        denialReason: denialReason || null,
        priority: priority || 'normal',
        billedAmount,
        paidAmount,
        balance,
        practiceId,
        status: initialStatus,
        workflowStatus: 'unworked',
      })
      .returning();

    await db.insert(claimStatusHistory).values({
      claimId: newClaim.id,
      newStatus: initialStatus,
      changedBy: user.id,
      reason: 'Claim created',
    });

    return NextResponse.json({ claim: newClaim });
  } catch (error) {
    console.error('Create claim error:', error);
    return NextResponse.json({ error: 'Failed to create claim' }, { status: 500 });
  }
}
