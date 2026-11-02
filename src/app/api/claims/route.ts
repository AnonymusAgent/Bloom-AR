import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, users, practices, claimStatusHistory, organizationMembers } from '@/db/schema';
import { eq, and, or, ilike, desc, asc, inArray, gte, lte, isNull, sql } from 'drizzle-orm';
import { canAssignClaims } from '@/lib/auth';
import { ensureSaaSColumns } from '@/lib/db-schema';
import { cleanUuid, cleanDate, cleanPage, cleanLimit } from '@/lib/sanitize';
import { requireTenantContext } from '@/lib/tenant-context';
import { getEntitlements } from '@/lib/saas';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';

export async function GET(request: NextRequest) {
  try {
    await ensureSaaSColumns();
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

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

    // Mandatory tenant boundary filter
    const conditions = [eq(claims.organizationId, organizationId)];

    // Role-based filtering inside the active organization
    if (!ctx.isReadOnly && ['ar_executive', 'billing_user'].includes(user.role)) {
      conditions.push(eq(claims.assignedTo, user.id));
    } else if (!ctx.isReadOnly && ['team_lead', 'senior_lead'].includes(user.role)) {
      const teamMembers = await db
        .select({ userId: organizationMembers.userId })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.teamLeadId, user.id),
            eq(organizationMembers.isActive, true)
          )
        );
      const teamMemberIds = [user.id, ...teamMembers.map((m) => m.userId)];
      conditions.push(
        or(inArray(claims.assignedTo, teamMemberIds), eq(claims.assignedBy, user.id))!
      );
    }

    const rawPracticeId = searchParams.get('practiceId');
    if (rawPracticeId === 'unassigned') {
      conditions.push(isNull(claims.practiceId));
    } else if (rawPracticeId) {
      const pid = cleanUuid(rawPracticeId);
      if (pid) conditions.push(eq(claims.practiceId, pid));
    }

    if (search) {
      conditions.push(
        or(
          ilike(claims.claimNumber, `%${search}%`),
          ilike(claims.patientName, `%${search}%`),
          ilike(claims.accountNumber, `%${search}%`),
          ilike(claims.insurance, `%${search}%`),
          ilike(claims.payer, `%${search}%`),
          ilike(claims.provider, `%${search}%`)
        )!
      );
    }

    if (status) {
      const statuses = status.split(',') as Array<(typeof claims.status.enumValues)[number]>;
      conditions.push(inArray(claims.status, statuses));
    }

    const workflowStatus = searchParams.get('workflowStatus');
    if (workflowStatus) {
      const wfStatuses = workflowStatus.split(',');
      conditions.push(inArray(claims.workflowStatus, wfStatuses));
    }

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

    if (assignedTo === 'unassigned') {
      conditions.push(isNull(claims.assignedTo));
    } else if (assignedTo) {
      const aid = cleanUuid(assignedTo);
      if (aid) conditions.push(eq(claims.assignedTo, aid));
    }

    if (insurance) {
      conditions.push(ilike(claims.insurance, `%${insurance}%`));
    }

    if (provider) {
      conditions.push(ilike(claims.provider, `%${provider}%`));
    }

    if (dateFrom) {
      conditions.push(gte(claims.dateOfService, dateFrom));
    }
    if (dateTo) {
      conditions.push(lte(claims.dateOfService, dateTo));
    }

    const whereClause = and(...conditions);

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

    const userIds = Array.from(
      new Set(
        result.flatMap((c) =>
          [c.assignedTo, c.approvedBy, c.workedBy].filter((id): id is string => Boolean(id))
        )
      )
    );
    const practiceIds = Array.from(
      new Set(result.map((c) => c.practiceId).filter((id): id is string => Boolean(id)))
    );

    const nameRows =
      userIds.length > 0
        ? await db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(inArray(users.id, userIds))
        : [];

    const practiceRows =
      practiceIds.length > 0
        ? await db
            .select({ id: practices.id, name: practices.name, code: practices.code })
            .from(practices)
            .where(
              and(eq(practices.organizationId, organizationId), inArray(practices.id, practiceIds))
            )
        : [];

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
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    if (!canAssignClaims(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const ent = await getEntitlements(organizationId);
    if (ent && !ent.canCreateClaim) {
      return NextResponse.json(
        {
          error: `Monthly claim volume limit (${ent.usage.claimsLimit}) reached for your plan. Upgrade in Billing Settings.`,
          code: 'CLAIM_LIMIT_REACHED',
        },
        { status: 402 }
      );
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
    const billedAmount =
      body.billedAmount !== undefined && body.billedAmount !== ''
        ? String(body.billedAmount)
        : null;
    const paidAmount =
      body.paidAmount !== undefined && body.paidAmount !== '' ? String(body.paidAmount) : '0';
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
        .where(and(eq(practices.id, practiceId), eq(practices.organizationId, organizationId)))
        .limit(1);
      if (!practice) {
        return NextResponse.json(
          { error: 'Selected practice not found in your organization' },
          { status: 400 }
        );
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
        organizationId,
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
      organizationId,
      claimId: newClaim.id,
      newStatus: initialStatus,
      changedBy: user.id,
      reason: 'Claim created',
    });

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: AUDIT_ACTIONS.CLAIM_CREATED,
      entityType: 'claim',
      entityId: newClaim.id,
      newValue: { claimNumber, status: initialStatus },
    });

    return NextResponse.json({ claim: newClaim });
  } catch (error) {
    console.error('Create claim error:', error);
    return NextResponse.json({ error: 'Failed to create claim' }, { status: 500 });
  }
}
