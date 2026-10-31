import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  codingRequests,
  claims,
  users,
  practices,
  denialCodes,
  codingDocuments,
  claimDocuments,
  claimStatusHistory,
} from '@/db/schema';
import { eq, and, desc, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import {
  canViewUser,
  getUserAuthorizedPracticeIds,
  getUserAuthorizedUserIds,
} from '@/lib/rbac';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { cleanLimit, cleanPage, cleanUuid } from '@/lib/sanitize';
import { analyzeClaimCoding } from '@/lib/coding/coding-checker';

const VALID_CODING_STATUSES = [
  'sent_to_coding',
  'under_review',
  'corrected',
  'returned_to_billing',
  'resubmitted',
] as const;

type CodingStatusValue = (typeof VALID_CODING_STATUSES)[number];

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = request.nextUrl.searchParams;
    const status = sp.get('status');
    const assignedFilter = sp.get('assignedTo');
    const claimIdFilter = cleanUuid(sp.get('claimId'));
    const search = (sp.get('search') || '').trim();
    const page = cleanPage(sp.get('page'));
    const limit = cleanLimit(sp.get('limit'), 20, 100);

    const visibilityConditions = [];
    if (!isSupervisorOrAbove(user.role)) {
      const authPractices = await getUserAuthorizedPracticeIds(user);
      const authUsers = await getUserAuthorizedUserIds(user);
      const vis = [];
      if (authUsers !== 'all' && authUsers.length > 0) {
        vis.push(inArray(codingRequests.sentBy, authUsers));
        vis.push(inArray(codingRequests.assignedTo, authUsers));
      }
      if (authPractices !== 'all' && authPractices.length > 0) {
        vis.push(inArray(claims.practiceId, authPractices));
      }
      if (vis.length === 0) {
        return NextResponse.json({
          codingRequests: [],
          queueStats: {
            total: 0,
            sent_to_coding: 0,
            under_review: 0,
            corrected: 0,
            returned_to_billing: 0,
            resubmitted: 0,
            assignedToMe: 0,
          },
          assignableUsers: [],
          pagination: { page, limit, total: 0, totalPages: 1 },
        });
      }
      visibilityConditions.push(or(...vis)!);
    }

    const filterConditions = [...visibilityConditions];

    if (status && (VALID_CODING_STATUSES as readonly string[]).includes(status)) {
      filterConditions.push(eq(codingRequests.status, status as CodingStatusValue));
    }

    if (claimIdFilter) {
      filterConditions.push(eq(codingRequests.claimId, claimIdFilter));
    }

    if (assignedFilter === 'me') {
      filterConditions.push(eq(codingRequests.assignedTo, user.id));
    } else if (assignedFilter === 'unassigned') {
      filterConditions.push(isNull(codingRequests.assignedTo));
    } else if (assignedFilter) {
      const cleanAssignee = cleanUuid(assignedFilter);
      if (cleanAssignee) {
        filterConditions.push(eq(codingRequests.assignedTo, cleanAssignee));
      }
    }

    if (search) {
      const pattern = `%${search}%`;
      filterConditions.push(
        or(
          ilike(claims.claimNumber, pattern),
          ilike(claims.patientName, pattern),
          ilike(claims.diagnosisCode, pattern),
          ilike(claims.cptCodes, pattern),
          ilike(claims.payer, pattern),
          ilike(claims.insurance, pattern),
          ilike(codingRequests.denialReason, pattern)
        )!
      );
    }

    const whereClause = filterConditions.length > 0 ? and(...filterConditions) : undefined;
    const baseVisibilityWhere =
      visibilityConditions.length > 0 ? and(...visibilityConditions) : undefined;

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(codingRequests)
      .leftJoin(claims, eq(codingRequests.claimId, claims.id))
      .where(whereClause);

    const statusBreakdown = await db
      .select({
        status: codingRequests.status,
        cnt: sql<number>`count(*)::int`,
      })
      .from(codingRequests)
      .leftJoin(claims, eq(codingRequests.claimId, claims.id))
      .where(baseVisibilityWhere)
      .groupBy(codingRequests.status);

    const [{ myCount }] = await db
      .select({ myCount: sql<number>`count(*)::int` })
      .from(codingRequests)
      .leftJoin(claims, eq(codingRequests.claimId, claims.id))
      .where(
        baseVisibilityWhere
          ? and(baseVisibilityWhere, eq(codingRequests.assignedTo, user.id))
          : eq(codingRequests.assignedTo, user.id)
      );

    const rows = await db
      .select({
        id: codingRequests.id,
        claimId: codingRequests.claimId,
        status: codingRequests.status,
        denialReason: codingRequests.denialReason,
        comments: codingRequests.comments,
        correctionNotes: codingRequests.correctionNotes,
        createdAt: codingRequests.createdAt,
        updatedAt: codingRequests.updatedAt,
        resolvedAt: codingRequests.resolvedAt,
        sentBy: codingRequests.sentBy,
        assignedTo: codingRequests.assignedTo,
        resolvedBy: codingRequests.resolvedBy,
        claimNumber: claims.claimNumber,
        accountNumber: claims.accountNumber,
        patientName: claims.patientName,
        dateOfService: claims.dateOfService,
        diagnosisCode: claims.diagnosisCode,
        cptCodes: claims.cptCodes,
        provider: claims.provider,
        payer: claims.payer,
        insurance: claims.insurance,
        billedAmount: claims.billedAmount,
        paidAmount: claims.paidAmount,
        balance: claims.balance,
        claimStatus: claims.status,
        claimDenialReason: claims.denialReason,
        practiceId: claims.practiceId,
        denialCodeValue: denialCodes.code,
        denialCodeDesc: denialCodes.description,
      })
      .from(codingRequests)
      .leftJoin(claims, eq(codingRequests.claimId, claims.id))
      .leftJoin(denialCodes, eq(claims.denialCodeId, denialCodes.id))
      .where(whereClause)
      .orderBy(desc(codingRequests.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const reqIds = rows.map((r) => r.id);
    const userIds = Array.from(
      new Set(
        rows.flatMap((r) =>
          [r.sentBy, r.assignedTo, r.resolvedBy].filter((uid): uid is string => Boolean(uid))
        )
      )
    );
    const practiceIds = Array.from(
      new Set(rows.map((r) => r.practiceId).filter((pid): pid is string => Boolean(pid)))
    );

    const authUserScope = await getUserAuthorizedUserIds(user);

    const userRows =
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
            .where(inArray(practices.id, practiceIds))
        : [];
    const docCounts =
      reqIds.length > 0
        ? await db
            .select({
              codingRequestId: codingDocuments.codingRequestId,
              cnt: sql<number>`count(*)::int`,
            })
            .from(codingDocuments)
            .where(inArray(codingDocuments.codingRequestId, reqIds))
            .groupBy(codingDocuments.codingRequestId)
        : [];
    const assignableRows =
      authUserScope === 'all'
        ? await db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              role: users.role,
            })
            .from(users)
            .where(eq(users.isActive, true))
            .limit(100)
        : authUserScope.length > 0
          ? await db
              .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                role: users.role,
              })
              .from(users)
              .where(and(eq(users.isActive, true), inArray(users.id, authUserScope)))
          : [];

    const userMap = new Map(userRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const practiceMap = new Map(practiceRows.map((p) => [p.id, `${p.code} — ${p.name}`]));
    const docCountMap = new Map(docCounts.map((d) => [d.codingRequestId, d.cnt]));

    const enriched = rows.map((r) => {
      const effectiveDenial =
        r.denialReason ||
        r.claimDenialReason ||
        (r.denialCodeValue ? `${r.denialCodeValue}: ${r.denialCodeDesc || ''}` : null);
      const audit = analyzeClaimCoding({
        diagnosisCodes: r.diagnosisCode,
        cptCodes: r.cptCodes,
        denialReason: effectiveDenial,
        billedAmount: r.billedAmount,
        dateOfService: r.dateOfService,
      });
      const topIssue =
        audit.issues.find((i) => i.severity === 'error') ||
        audit.issues.find((i) => i.severity === 'warning') ||
        null;

      return {
        ...r,
        denialReason: effectiveDenial,
        senderName: userMap.get(r.sentBy) || 'Unknown',
        assigneeName: r.assignedTo ? userMap.get(r.assignedTo) || null : null,
        resolverName: r.resolvedBy ? userMap.get(r.resolvedBy) || null : null,
        practiceName: r.practiceId ? practiceMap.get(r.practiceId) || null : null,
        documentsCount: docCountMap.get(r.id) || 0,
        codingAudit: {
          score: audit.score,
          canSubmitClean: audit.canSubmitClean,
          errors: audit.counts.errors,
          warnings: audit.counts.warnings,
          info: audit.counts.info,
          topIssueTitle: topIssue?.title || null,
        },
      };
    });

    const statsMap: Record<string, number> = {
      sent_to_coding: 0,
      under_review: 0,
      corrected: 0,
      returned_to_billing: 0,
      resubmitted: 0,
    };
    let statsTotal = 0;
    for (const s of statusBreakdown) {
      statsMap[s.status] = s.cnt;
      statsTotal += s.cnt;
    }

    return NextResponse.json({
      codingRequests: enriched,
      currentUserId: user.id,
      queueStats: {
        total: statsTotal,
        sent_to_coding: statsMap.sent_to_coding,
        under_review: statsMap.under_review,
        corrected: statsMap.corrected,
        returned_to_billing: statsMap.returned_to_billing,
        resubmitted: statsMap.resubmitted,
        assignedToMe: myCount,
      },
      assignableUsers: assignableRows.map((u) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        role: u.role,
      })),
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.max(1, Math.ceil(count / limit)),
      },
    });
  } catch (error) {
    console.error('Get coding requests error:', error);
    return NextResponse.json({ error: 'Failed to load coding queue' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const claimId = cleanUuid(body.claimId);
    const assignedTo = body.assignedTo === 'me' ? user.id : cleanUuid(body.assignedTo);
    const { denialReason, comments } = body;
    if (!claimId) return NextResponse.json({ error: 'Valid Claim ID required' }, { status: 400 });

    const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    if (!isSupervisorOrAbove(user.role)) {
      const authPractices = await getUserAuthorizedPracticeIds(user);
      const allowedByPractice =
        authPractices === 'all' ||
        (claim.practiceId ? authPractices.includes(claim.practiceId) : false);
      const allowedByAssignee = claim.assignedTo ? await canViewUser(user, claim.assignedTo) : false;
      if (!allowedByPractice && !allowedByAssignee) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    const [codingReq] = await db
      .insert(codingRequests)
      .values({
        claimId,
        denialReason: denialReason || claim.denialReason || null,
        comments: comments || null,
        sentBy: user.id,
        assignedTo,
      })
      .returning();

    await db
      .update(claims)
      .set({ status: 'sent_to_coding', updatedAt: new Date() })
      .where(eq(claims.id, claimId));
    await db.insert(claimStatusHistory).values({
      claimId,
      previousStatus: claim.status,
      newStatus: 'sent_to_coding',
      changedBy: user.id,
      reason: 'Sent to coding team',
    });

    const claimDocs = await db
      .select()
      .from(claimDocuments)
      .where(eq(claimDocuments.claimId, claimId));
    for (const doc of claimDocs) {
      await db.insert(codingDocuments).values({
        codingRequestId: codingReq.id,
        documentType: doc.documentType,
        fileName: doc.fileName,
        fileData: doc.fileData,
        mimeType: doc.mimeType,
        uploadedBy: user.id,
      });
    }

    if (assignedTo && assignedTo !== user.id) {
      await createNotification({
        userId: assignedTo,
        type: 'task_assigned',
        title: 'Coding Request Assigned',
        message: `Claim ${claim.claimNumber} has been assigned to you for coding review.`,
        relatedClaimId: claimId,
      });
    }

    await createAuditLog({
      userId: user.id,
      action: 'sent_to_coding',
      entityType: 'codingRequest',
      entityId: codingReq.id,
      newValue: { claimId, claimNumber: claim.claimNumber, assignedTo },
    });

    return NextResponse.json({ codingRequest: codingReq });
  } catch (error) {
    console.error('Create coding request error:', error);
    return NextResponse.json({ error: 'Failed to create coding request' }, { status: 500 });
  }
}
