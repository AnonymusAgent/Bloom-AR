import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  codingRequests,
  codingDocuments,
  claims,
  claimNotes,
  claimStatusHistory,
  denialCodes,
  practices,
  users,
} from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { canViewUser, getUserAuthorizedPracticeIds } from '@/lib/rbac';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { cleanUuid } from '@/lib/sanitize';
import { analyzeClaimCoding, splitDiagnosisInput } from '@/lib/coding/coding-checker';
import { formatICD10Code } from '@/lib/coding/icd10-service';
import { parseProcedureTokens } from '@/lib/coding/cpt-hcpcs-reference';

const VALID_STATUSES = new Set([
  'sent_to_coding',
  'under_review',
  'corrected',
  'returned_to_billing',
  'resubmitted',
]);

async function checkCodingRequestAccess(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  codingReq: typeof codingRequests.$inferSelect,
  claim: typeof claims.$inferSelect | undefined
): Promise<boolean> {
  if (isSupervisorOrAbove(user.role)) return true;
  if (codingReq.sentBy === user.id || codingReq.assignedTo === user.id) return true;
  if (!claim) return false;
  const authPractices = await getUserAuthorizedPracticeIds(user);
  if (authPractices === 'all') return true;
  if (claim.practiceId && authPractices.includes(claim.practiceId)) return true;
  if (claim.assignedTo && (await canViewUser(user, claim.assignedTo))) return true;
  return false;
}

function normalizeDiagnosisListForStorage(raw: string): {
  columnValue: string;
  fullList: string[];
} {
  const formattedList = splitDiagnosisInput(raw).map((tok) => formatICD10Code(tok) || tok.trim());
  const fullJoined = formattedList.join(', ');
  if (fullJoined.length <= 100) {
    return { columnValue: fullJoined, fullList: formattedList };
  }
  const fitted: string[] = [];
  for (const c of formattedList) {
    const candidate = [...fitted, c].join(', ');
    if (candidate.length <= 100) fitted.push(c);
    else break;
  }
  return {
    columnValue: fitted.join(', ') || fullJoined.slice(0, 100),
    fullList: formattedList,
  };
}

function normalizeProcedureListForStorage(raw: string): string {
  const parsed = parseProcedureTokens(raw);
  if (parsed.length === 0) return raw.trim();
  return parsed
    .map((p) => (p.modifiers.length > 0 ? `${p.baseCode}-${p.modifiers.join('-')}` : p.baseCode))
    .join(', ');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id: rawId } = await params;
    const id = cleanUuid(rawId);
    if (!id) return NextResponse.json({ error: 'Invalid coding request ID' }, { status: 400 });

    const [existing] = await db
      .select()
      .from(codingRequests)
      .where(eq(codingRequests.id, id))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [claim] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, existing.claimId))
      .limit(1);

    if (!(await checkCodingRequestAccess(user, existing, claim))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const includeDocData = request.nextUrl.searchParams.get('includeDocData') === 'true';

    const docs = includeDocData
      ? await db.select().from(codingDocuments).where(eq(codingDocuments.codingRequestId, id))
      : await db
          .select({
            id: codingDocuments.id,
            documentType: codingDocuments.documentType,
            fileName: codingDocuments.fileName,
            mimeType: codingDocuments.mimeType,
            createdAt: codingDocuments.createdAt,
          })
          .from(codingDocuments)
          .where(eq(codingDocuments.codingRequestId, id));

    const practiceRow = claim?.practiceId
      ? await db
          .select({ id: practices.id, name: practices.name, code: practices.code })
          .from(practices)
          .where(eq(practices.id, claim.practiceId))
          .limit(1)
      : [];

    const denialRow = claim?.denialCodeId
      ? await db
          .select()
          .from(denialCodes)
          .where(eq(denialCodes.id, claim.denialCodeId))
          .limit(1)
      : [];

    const lookupUserIds = [existing.sentBy, existing.assignedTo, existing.resolvedBy].filter(
      (u): u is string => Boolean(u)
    );
    const userRows =
      lookupUserIds.length > 0
        ? await db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(inArray(users.id, lookupUserIds))
        : [];

    const uMap = new Map(userRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const effectiveDenial =
      existing.denialReason ||
      claim?.denialReason ||
      (denialRow[0] ? `${denialRow[0].code}: ${denialRow[0].description}` : null);

    const codingAudit = analyzeClaimCoding({
      diagnosisCodes: claim?.diagnosisCode,
      cptCodes: claim?.cptCodes,
      denialReason: effectiveDenial,
      billedAmount: claim?.billedAmount,
      dateOfService: claim?.dateOfService,
    });

    return NextResponse.json({
      codingRequest: {
        ...existing,
        senderName: uMap.get(existing.sentBy) || 'Unknown',
        assigneeName: existing.assignedTo ? uMap.get(existing.assignedTo) || null : null,
        resolverName: existing.resolvedBy ? uMap.get(existing.resolvedBy) || null : null,
      },
      claim: claim
        ? {
            ...claim,
            practiceName: practiceRow[0] ? `${practiceRow[0].code} — ${practiceRow[0].name}` : null,
            denialCode: denialRow[0] || null,
          }
        : null,
      documents: docs,
      codingAudit,
    });
  } catch (error) {
    console.error('Get coding request detail error:', error);
    return NextResponse.json({ error: 'Failed to load coding request' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id: rawId } = await params;
    const id = cleanUuid(rawId);
    if (!id) return NextResponse.json({ error: 'Invalid coding request ID' }, { status: 400 });

    const body = await request.json();

    const [existing] = await db
      .select()
      .from(codingRequests)
      .where(eq(codingRequests.id, id))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [claim] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, existing.claimId))
      .limit(1);

    if (!(await checkCodingRequestAccess(user, existing, claim))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (body.status !== undefined) {
      if (!VALID_STATUSES.has(String(body.status))) {
        return NextResponse.json({ error: 'Invalid coding status' }, { status: 400 });
      }
      updateData.status = body.status;
      if (body.status === 'corrected' || body.status === 'returned_to_billing') {
        updateData.resolvedBy = user.id;
        updateData.resolvedAt = new Date();
      }
    }

    if (body.correctionNotes !== undefined) {
      updateData.correctionNotes = body.correctionNotes;
    }
    if (body.comments !== undefined) {
      updateData.comments = body.comments;
    }

    let newlyAssignedUserId: string | null = null;
    if (body.assignedTo !== undefined) {
      if (body.assignedTo === 'me') {
        updateData.assignedTo = user.id;
      } else if (body.assignedTo === null || body.assignedTo === '') {
        updateData.assignedTo = null;
      } else {
        const cleanAssignee = cleanUuid(body.assignedTo);
        if (!cleanAssignee) {
          return NextResponse.json({ error: 'Invalid assignee ID' }, { status: 400 });
        }
        updateData.assignedTo = cleanAssignee;
        if (cleanAssignee !== existing.assignedTo && cleanAssignee !== user.id) {
          newlyAssignedUserId = cleanAssignee;
        }
      }
    }

    const [updated] = await db
      .update(codingRequests)
      .set(updateData)
      .where(eq(codingRequests.id, id))
      .returning();

    const claimStatusMap: Record<string, string> = {
      under_review: 'coding_review',
      corrected: 'coding_corrected',
      returned_to_billing: 'returned_to_billing',
      resubmitted: 'resubmitted',
    };

    let updatedClaim = claim || null;

    if (claim) {
      const claimPatch: Record<string, unknown> = {};
      const codeChangesSummary: string[] = [];

      if (typeof body.diagnosisCode === 'string') {
        const { columnValue, fullList } = normalizeDiagnosisListForStorage(body.diagnosisCode);
        if (columnValue !== (claim.diagnosisCode || '')) {
          claimPatch.diagnosisCode = columnValue || null;
          if (fullList.join(', ').length > 100) {
            claimPatch.additionalData = {
              ...(typeof claim.additionalData === 'object' && claim.additionalData !== null
                ? (claim.additionalData as Record<string, unknown>)
                : {}),
              allDiagnosisCodes: fullList,
            };
          }
          codeChangesSummary.push(
            `ICD-10-CM: "${claim.diagnosisCode || 'None'}" → "${columnValue || 'None'}"`
          );
        }
      }

      if (typeof body.cptCodes === 'string') {
        const cleanCpt = normalizeProcedureListForStorage(body.cptCodes);
        if (cleanCpt !== (claim.cptCodes || '')) {
          claimPatch.cptCodes = cleanCpt || null;
          codeChangesSummary.push(
            `CPT/HCPCS: "${claim.cptCodes || 'None'}" → "${cleanCpt || 'None'}"`
          );
        }
      }

      if (body.status && claimStatusMap[body.status]) {
        claimPatch.status = claimStatusMap[body.status] as typeof claim.status;
        if (body.status === 'corrected' || body.status === 'returned_to_billing') {
          claimPatch.workflowStatus = 'working';
        }
      }

      if (Object.keys(claimPatch).length > 0) {
        claimPatch.updatedAt = new Date();
        const [savedClaim] = await db
          .update(claims)
          .set(claimPatch)
          .where(eq(claims.id, claim.id))
          .returning();
        updatedClaim = savedClaim;

        if (body.status && claimStatusMap[body.status] && claimStatusMap[body.status] !== claim.status) {
          const reasonParts = [`Coding: ${body.status}`];
          if (codeChangesSummary.length > 0) reasonParts.push(codeChangesSummary.join('; '));
          if (body.correctionNotes) reasonParts.push(String(body.correctionNotes));
          await db.insert(claimStatusHistory).values({
            claimId: claim.id,
            previousStatus: claim.status,
            newStatus: claimStatusMap[body.status] as typeof claim.status,
            changedBy: user.id,
            reason: reasonParts.join(' — '),
          });
        }

        if (codeChangesSummary.length > 0 || body.correctionNotes) {
          const noteLines = [
            codeChangesSummary.length > 0
              ? `Code Updates Applied: ${codeChangesSummary.join(' | ')}`
              : null,
            body.correctionNotes ? `Coder Notes: ${body.correctionNotes}` : null,
          ]
            .filter(Boolean)
            .join('\n');

          if (noteLines) {
            await db.insert(claimNotes).values({
              claimId: claim.id,
              userId: user.id,
              note: noteLines,
              actionPerformed:
                codeChangesSummary.length > 0 ? 'coding_correction' : 'coding_review',
            });
          }
        }
      }

      if (body.status && existing.sentBy && existing.sentBy !== user.id) {
        await createNotification({
          userId: existing.sentBy,
          type: 'system',
          title: 'Coding Review Updated',
          message: `Claim ${claim.claimNumber} coding status: ${String(body.status).replace(/_/g, ' ')}${
            codeChangesSummary.length > 0 ? ` (${codeChangesSummary.join('; ')})` : ''
          }`,
          relatedClaimId: existing.claimId,
        });
      }

      if (newlyAssignedUserId) {
        await createNotification({
          userId: newlyAssignedUserId,
          type: 'task_assigned',
          title: 'Coding Request Assigned',
          message: `Claim ${claim.claimNumber} was assigned to you in the Coding Queue.`,
          relatedClaimId: existing.claimId,
        });
      }
    }

    await createAuditLog({
      userId: user.id,
      action: 'coding_request_updated',
      entityType: 'codingRequest',
      entityId: id,
      previousValue: {
        status: existing.status,
        assignedTo: existing.assignedTo,
        diagnosisCode: claim?.diagnosisCode ?? null,
        cptCodes: claim?.cptCodes ?? null,
      },
      newValue: {
        status: updated.status,
        assignedTo: updated.assignedTo,
        diagnosisCode: updatedClaim?.diagnosisCode ?? null,
        cptCodes: updatedClaim?.cptCodes ?? null,
      },
    });

    const codingAudit = analyzeClaimCoding({
      diagnosisCodes: updatedClaim?.diagnosisCode,
      cptCodes: updatedClaim?.cptCodes,
      denialReason: updated.denialReason || updatedClaim?.denialReason,
      billedAmount: updatedClaim?.billedAmount,
      dateOfService: updatedClaim?.dateOfService,
    });

    return NextResponse.json({
      codingRequest: updated,
      claim: updatedClaim,
      codingAudit,
    });
  } catch (error) {
    console.error('Update coding request error:', error);
    return NextResponse.json({ error: 'Failed to update coding request' }, { status: 500 });
  }
}
