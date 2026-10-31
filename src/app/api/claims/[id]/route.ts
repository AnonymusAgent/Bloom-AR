import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  claims,
  users,
  practices,
  claimNotes,
  claimStatusHistory,
  claimDocuments,
  denialCodes,
} from '@/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { ensureSaaSColumns, safeErrorDetail } from '@/lib/db-schema';
import { cleanUuid, cleanDate } from '@/lib/sanitize';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid claim ID' }, { status: 400 });
    }
    await ensureSaaSColumns();

    const [claim] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, id))
      .limit(1);

    if (!claim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    // Check access for frontline specialists
    if (['ar_executive', 'billing_user'].includes(user.role) && claim.assignedTo !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Fault-isolated helper: a broken related lookup must never block opening the claim
    const safe = async <T,>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        console.error(`Get claim: ${label} failed:`, e);
        return fallback;
      }
    };

    // Resolve Practice details via claim.practiceId
    let practice: {
      id: string;
      name: string;
      code: string;
      specialty: string | null;
      npi: string | null;
    } | null = null;

    if (claim.practiceId) {
      const pId: string = claim.practiceId;
      const practiceRows = await safe(
        () =>
          db
            .select({
              id: practices.id,
              name: practices.name,
              code: practices.code,
              specialty: practices.specialty,
              npi: practices.npi,
            })
            .from(practices)
            .where(eq(practices.id, pId))
            .limit(1),
        [],
        'practice'
      );
      practice = practiceRows[0] ?? null;
    }

    // Batch-resolve related users (assignee, worker, approver, reviewer, assigner)
    const initialUserIds = Array.from(
      new Set(
        [claim.assignedTo, claim.workedBy, claim.approvedBy, claim.reviewedBy, claim.assignedBy].filter(
          (uid): uid is string => Boolean(uid)
        )
      )
    );

    const userRows =
      initialUserIds.length > 0
        ? await safe(
            () =>
              db
                .select({
                  id: users.id,
                  firstName: users.firstName,
                  lastName: users.lastName,
                  email: users.email,
                  role: users.role,
                  teamLeadId: users.teamLeadId,
                })
                .from(users)
                .where(inArray(users.id, initialUserIds)),
            [],
            'related users'
          )
        : [];

    const userMap = new Map(userRows.map((u) => [u.id, u]));

    const toPublicUser = (uid: string | null) => {
      if (!uid) return null;
      const u = userMap.get(uid);
      return u ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email } : null;
    };

    const assigneeFull = claim.assignedTo ? userMap.get(claim.assignedTo) ?? null : null;
    const assignee = toPublicUser(claim.assignedTo);
    const worker = toPublicUser(claim.workedBy);
    const approver = toPublicUser(claim.approvedBy);
    const reviewer = toPublicUser(claim.reviewedBy);

    // Resolve team lead from assignee.teamLeadId (or fallback to assigner if supervisor/lead)
    let teamLead: { id: string; firstName: string; lastName: string; email: string } | null = null;
    if (assigneeFull?.teamLeadId) {
      const tlId: string = assigneeFull.teamLeadId;
      if (userMap.has(tlId)) {
        teamLead = toPublicUser(tlId);
      } else {
        const tlRows = await safe(
          () =>
            db
              .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
              })
              .from(users)
              .where(eq(users.id, tlId))
              .limit(1),
          [],
          'team lead'
        );
        teamLead = tlRows[0] ?? null;
      }
    } else if (claim.assignedBy) {
      const assigner = userMap.get(claim.assignedBy);
      if (
        assigner &&
        ['team_lead', 'senior_lead', 'supervisor', 'manager', 'administrator'].includes(assigner.role)
      ) {
        teamLead = {
          id: assigner.id,
          firstName: assigner.firstName,
          lastName: assigner.lastName,
          email: assigner.email,
        };
      }
    }

    // Get notes
    const notes = await safe(
      () =>
        db
          .select({
            id: claimNotes.id,
            note: claimNotes.note,
            actionPerformed: claimNotes.actionPerformed,
            createdAt: claimNotes.createdAt,
            userId: claimNotes.userId,
            userName: users.firstName,
            userLastName: users.lastName,
          })
          .from(claimNotes)
          .leftJoin(users, eq(claimNotes.userId, users.id))
          .where(eq(claimNotes.claimId, id))
          .orderBy(desc(claimNotes.createdAt)),
      [],
      'notes'
    );

    // Get status history
    const statusHistory = await safe(
      () =>
        db
          .select({
            id: claimStatusHistory.id,
            previousStatus: claimStatusHistory.previousStatus,
            newStatus: claimStatusHistory.newStatus,
            reason: claimStatusHistory.reason,
            createdAt: claimStatusHistory.createdAt,
            changedBy: claimStatusHistory.changedBy,
            userName: users.firstName,
            userLastName: users.lastName,
          })
          .from(claimStatusHistory)
          .leftJoin(users, eq(claimStatusHistory.changedBy, users.id))
          .where(eq(claimStatusHistory.claimId, id))
          .orderBy(desc(claimStatusHistory.createdAt)),
      [],
      'status history'
    );

    // Get documents
    const documents = await safe(
      () =>
        db
          .select({
            id: claimDocuments.id,
            documentType: claimDocuments.documentType,
            fileName: claimDocuments.fileName,
            mimeType: claimDocuments.mimeType,
            createdAt: claimDocuments.createdAt,
            uploadedBy: claimDocuments.uploadedBy,
          })
          .from(claimDocuments)
          .where(eq(claimDocuments.claimId, id))
          .orderBy(desc(claimDocuments.createdAt)),
      [],
      'documents'
    );

    // Get denial code if present
    let denialCode = null;
    if (claim.denialCodeId) {
      const codeId: number = claim.denialCodeId;
      const rows = await safe(
        () => db.select().from(denialCodes).where(eq(denialCodes.id, codeId)).limit(1),
        [] as Array<typeof denialCodes.$inferSelect>,
        'denial code'
      );
      denialCode = rows[0] ?? null;
    }

    return NextResponse.json({
      claim: {
        ...claim,
        practice,
        assignee,
        worker,
        approver,
        reviewer,
        teamLead,
        denialCode,
      },
      notes: notes.map((n) => ({
        ...n,
        userName: n.userName && n.userLastName ? `${n.userName} ${n.userLastName}` : 'Unknown',
      })),
      statusHistory: statusHistory.map((h) => ({
        ...h,
        userName: h.userName && h.userLastName ? `${h.userName} ${h.userLastName}` : 'Unknown',
      })),
      documents,
    });
  } catch (error) {
    console.error('Get claim error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch claim',
        detail: safeErrorDetail(error),
        hint: 'Check /api/health for database/schema status.',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid claim ID' }, { status: 400 });
    }
    await ensureSaaSColumns();

    const body = await request.json();

    const [existingClaim] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, id))
      .limit(1);

    if (!existingClaim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    // Check access for frontline specialists
    if (['ar_executive', 'billing_user'].includes(user.role) && existingClaim.assignedTo !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const updateData: Partial<typeof claims.$inferInsert> = {};

    // Practice association update
    if (body.practiceId !== undefined) {
      const nextPracticeId = body.practiceId ? String(body.practiceId).trim() : null;
      if (nextPracticeId) {
        if (!UUID_RE.test(nextPracticeId)) {
          return NextResponse.json({ error: 'Invalid practice ID' }, { status: 400 });
        }
        const [practiceExists] = await db
          .select({ id: practices.id })
          .from(practices)
          .where(eq(practices.id, nextPracticeId))
          .limit(1);
        if (!practiceExists) {
          return NextResponse.json({ error: 'Selected practice not found' }, { status: 400 });
        }
      }
      updateData.practiceId = nextPracticeId;
    }

    // Update allowed fields
    if (body.patientName !== undefined) updateData.patientName = body.patientName || null;
    if (body.accountNumber !== undefined) updateData.accountNumber = body.accountNumber || null;
    if (body.dateOfService !== undefined) updateData.dateOfService = cleanDate(body.dateOfService);
    if (body.cptCodes !== undefined) updateData.cptCodes = body.cptCodes || null;
    if (body.diagnosisCode !== undefined) updateData.diagnosisCode = body.diagnosisCode || null;
    if (body.location !== undefined) updateData.location = body.location || null;
    if (body.provider !== undefined) updateData.provider = body.provider || null;
    if (body.insurance !== undefined) updateData.insurance = body.insurance || null;
    if (body.payer !== undefined) updateData.payer = body.payer || null;
    if (body.billedAmount !== undefined) updateData.billedAmount = body.billedAmount !== '' && body.billedAmount !== null ? String(body.billedAmount) : null;
    if (body.paidAmount !== undefined) updateData.paidAmount = body.paidAmount !== '' && body.paidAmount !== null ? String(body.paidAmount) : '0';
    if (body.balance !== undefined) updateData.balance = body.balance !== '' && body.balance !== null ? String(body.balance) : null;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.subStatus !== undefined) updateData.subStatus = body.subStatus || null;
    if (body.claimInsuranceStatus !== undefined) updateData.claimInsuranceStatus = body.claimInsuranceStatus || null;
    if (body.followUpDate !== undefined) updateData.followUpDate = cleanDate(body.followUpDate);
    if (body.denialCodeId !== undefined) {
      const parsed = Number(body.denialCodeId);
      updateData.denialCodeId =
        body.denialCodeId !== '' && body.denialCodeId !== null && Number.isInteger(parsed) && parsed > 0
          ? parsed
          : null;
    }
    if (body.denialReason !== undefined) updateData.denialReason = body.denialReason || null;

    // Status change + workflowStatus synchronization
    if (body.status && body.status !== existingClaim.status) {
      updateData.status = body.status;
      if (body.status === 'in_progress' && existingClaim.workflowStatus === 'unworked') {
        updateData.workflowStatus = 'working';
        updateData.workedBy = existingClaim.workedBy || user.id;
        updateData.workedDate = existingClaim.workedDate || new Date();
      } else if (body.status === 'submitted_for_review') {
        updateData.workflowStatus = 'pending_approval';
        updateData.submittedForApprovalAt = new Date();
      } else if (body.status === 'rework_required') {
        updateData.workflowStatus = 'rework';
      } else if (body.status === 'approved') {
        updateData.workflowStatus = 'approved';
        updateData.approvedBy = user.id;
        updateData.approvedAt = new Date();
      }

      await db.insert(claimStatusHistory).values({
        claimId: id,
        previousStatus: existingClaim.status,
        newStatus: body.status,
        changedBy: user.id,
        reason: body.statusChangeReason || undefined,
      });

      await createAuditLog({
        userId: user.id,
        action: AUDIT_ACTIONS.CLAIM_STATUS_CHANGED,
        entityType: 'claim',
        entityId: id,
        previousValue: { status: existingClaim.status },
        newValue: { status: body.status },
        ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
        userAgent: request.headers.get('user-agent') || undefined,
      });
    }

    updateData.updatedAt = new Date();

    const [updatedClaim] = await db
      .update(claims)
      .set(updateData)
      .where(eq(claims.id, id))
      .returning();

    let practice = null;
    if (updatedClaim.practiceId) {
      const pId: string = updatedClaim.practiceId;
      const [p] = await db
        .select({
          id: practices.id,
          name: practices.name,
          code: practices.code,
          specialty: practices.specialty,
          npi: practices.npi,
        })
        .from(practices)
        .where(eq(practices.id, pId))
        .limit(1);
      practice = p ?? null;
    }

    await createAuditLog({
      userId: user.id,
      action: AUDIT_ACTIONS.CLAIM_UPDATED,
      entityType: 'claim',
      entityId: id,
      previousValue: { practiceId: existingClaim.practiceId, status: existingClaim.status },
      newValue: { practiceId: updatedClaim.practiceId, status: updatedClaim.status },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ claim: { ...updatedClaim, practice } });
  } catch (error) {
    console.error('Update claim error:', error);
    return NextResponse.json({ error: 'Failed to update claim' }, { status: 500 });
  }
}
