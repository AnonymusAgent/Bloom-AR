import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, claimStatusHistory, claimNotes, users } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { ensureSaaSColumns } from '@/lib/db-schema';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSaaSColumns();
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const {
      action,
      claimInsuranceStatus,
      subStatus,
      remarks,
      reworkReason,
      followUpDate,
      denialCodeId,
      denialReason,
    } = await request.json();

    if (!action) return NextResponse.json({ error: 'Action is required' }, { status: 400 });

    const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    const canSupervise = isSupervisorOrAbove(user.role) || user.role === 'team_lead';
    const isAssignedOwner = claim.assignedTo === user.id;

    // Frontline roles can only perform worker actions on claims assigned to them
    if (
      ['start_working', 'save_progress', 'submit_for_approval', 'mark_dead'].includes(action) &&
      !canSupervise &&
      !isAssignedOwner
    ) {
      return NextResponse.json(
        { error: 'You do not have permission to work this claim' },
        { status: 403 }
      );
    }

    const now = new Date();
    const update: Record<string, unknown> = { updatedAt: now };
    let auditAction = '';
    let noteText = '';
    let notifyUserId: string | null = null;
    let notifyTitle = '';
    let notifyMessage = '';
    let shouldWriteStatusHistory = true;

    switch (action) {
      case 'start_working': {
        update.workflowStatus = 'working';
        update.workedBy = user.id;
        update.workedDate = now;
        update.status = 'in_progress';
        if (!claim.assignedTo) {
          update.assignedTo = user.id;
          update.assignedAt = now;
        }
        auditAction = 'claim_work_started';
        noteText = 'Started working on claim';
        break;
      }

      case 'save_progress': {
        if (claim.workflowStatus !== 'working' && claim.workflowStatus !== 'rework') {
          return NextResponse.json(
            { error: 'Claim must be in working or rework status to save progress' },
            { status: 400 }
          );
        }
        update.workedBy = claim.workedBy || user.id;
        update.workedDate = now;
        if (claimInsuranceStatus !== undefined) {
          update.claimInsuranceStatus = claimInsuranceStatus || null;
          if (claimInsuranceStatus === 'denied') update.status = 'denied';
          else if (claimInsuranceStatus === 'pending') update.status = 'pending';
          else if (claimInsuranceStatus === 'in_progress') update.status = 'in_progress';
        }
        if (subStatus !== undefined) update.subStatus = subStatus || null;
        if (followUpDate !== undefined) update.followUpDate = followUpDate || null;
        if (denialCodeId !== undefined) update.denialCodeId = denialCodeId || null;
        if (denialReason !== undefined) update.denialReason = denialReason || null;
        auditAction = 'claim_progress_saved';
        noteText = remarks?.trim() || 'Saved work progress on claim';
        shouldWriteStatusHistory = Boolean(update.status && update.status !== claim.status);
        break;
      }

      case 'submit_for_approval': {
        if (claim.workflowStatus !== 'working' && claim.workflowStatus !== 'rework') {
          return NextResponse.json(
            { error: 'Claim must be in working or rework status to submit' },
            { status: 400 }
          );
        }
        update.workflowStatus = 'pending_approval';
        update.submittedForApprovalAt = now;
        update.workedBy = claim.workedBy || user.id;
        update.workedDate = claim.workedDate || now;
        update.status = 'submitted_for_review';
        if (claimInsuranceStatus) update.claimInsuranceStatus = claimInsuranceStatus;
        if (subStatus !== undefined) update.subStatus = subStatus || claim.subStatus;
        if (followUpDate !== undefined) update.followUpDate = followUpDate || null;
        if (denialCodeId !== undefined) update.denialCodeId = denialCodeId || null;
        if (denialReason !== undefined) update.denialReason = denialReason || null;
        auditAction = 'claim_submitted_for_approval';
        noteText = remarks?.trim() || 'Submitted for supervisor approval';

        // Prefer worker's team lead if configured, otherwise first active supervisor/lead
        if (user.teamLeadId) {
          notifyUserId = user.teamLeadId;
        } else {
          const [lead] = await db
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.isActive, true),
                inArray(users.role, ['supervisor', 'team_lead', 'manager', 'administrator'])
              )
            )
            .limit(1);
          if (lead && lead.id !== user.id) {
            notifyUserId = lead.id;
          }
        }
        if (notifyUserId) {
          notifyTitle = 'Claim Submitted for Approval';
          notifyMessage = `${user.firstName} ${user.lastName} submitted claim ${claim.claimNumber} for review`;
        }
        break;
      }

      case 'approve': {
        if (!canSupervise) {
          return NextResponse.json({ error: 'Only supervisors can approve claims' }, { status: 403 });
        }
        if (claim.workflowStatus !== 'pending_approval' && claim.status !== 'submitted_for_review') {
          return NextResponse.json({ error: 'Claim must be pending approval' }, { status: 400 });
        }
        if (claim.workedBy === user.id) {
          return NextResponse.json({ error: 'You cannot approve your own work' }, { status: 403 });
        }
        const effectiveOutcome = claimInsuranceStatus || claim.claimInsuranceStatus;
        const resolvedStatus =
          effectiveOutcome === 'denied'
            ? 'denied'
            : effectiveOutcome === 'paid'
            ? 'paid'
            : effectiveOutcome === 'closed'
            ? 'closed'
            : 'approved';

        update.workflowStatus = 'approved';
        update.approvedBy = user.id;
        update.approvedAt = now;
        update.reviewedBy = user.id;
        update.reviewedAt = now;
        update.status = resolvedStatus;
        if (claimInsuranceStatus) update.claimInsuranceStatus = claimInsuranceStatus;
        auditAction = 'claim_approved_by_supervisor';
        noteText = remarks?.trim() || 'Claim approved by supervisor';

        if (claim.workedBy || claim.assignedTo) {
          notifyUserId = (claim.workedBy || claim.assignedTo) as string;
          notifyTitle = 'Claim Approved';
          notifyMessage = `Your work on claim ${claim.claimNumber} has been approved by ${user.firstName} ${user.lastName}`;
        }
        break;
      }

      case 'send_back_rework': {
        if (!canSupervise) {
          return NextResponse.json(
            { error: 'Only supervisors can send claims back' },
            { status: 403 }
          );
        }
        if (!reworkReason || reworkReason.trim().length === 0) {
          return NextResponse.json({ error: 'Rework reason is mandatory' }, { status: 400 });
        }
        if (claim.workflowStatus !== 'pending_approval' && claim.status !== 'submitted_for_review') {
          return NextResponse.json({ error: 'Claim must be pending approval' }, { status: 400 });
        }
        update.workflowStatus = 'rework';
        update.reworkReason = reworkReason.trim();
        update.reworkCount = ((claim.reworkCount as number) || 0) + 1;
        update.reviewedBy = user.id;
        update.reviewedAt = now;
        update.reviewComments = reworkReason.trim();
        update.status = 'rework_required';
        auditAction = 'claim_sent_back_for_rework';
        noteText = `Sent back for rework: ${reworkReason.trim()}`;

        if (claim.workedBy || claim.assignedTo) {
          notifyUserId = (claim.workedBy || claim.assignedTo) as string;
          notifyTitle = 'Claim Returned for Rework';
          notifyMessage = `Claim ${claim.claimNumber} was sent back by ${user.firstName} ${user.lastName}: ${reworkReason.trim()}`;
        }
        break;
      }

      case 'mark_dead': {
        update.workflowStatus = 'dead';
        update.status = 'closed';
        update.claimInsuranceStatus = 'unworkable';
        update.workedBy = claim.workedBy || user.id;
        update.workedDate = claim.workedDate || now;
        auditAction = 'claim_marked_dead';
        noteText = remarks?.trim() || 'Claim marked as dead/unworkable';
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const [updated] = await db.update(claims).set(update).where(eq(claims.id, id)).returning();

    if (shouldWriteStatusHistory) {
      await db.insert(claimStatusHistory).values({
        claimId: id,
        previousStatus: claim.status,
        newStatus: updated.status,
        changedBy: user.id,
        reason: noteText,
      });
    }

    if (noteText) {
      await db.insert(claimNotes).values({
        claimId: id,
        userId: user.id,
        note: noteText,
        actionPerformed: action.replace(/_/g, ' '),
      });
    }

    if (notifyUserId) {
      await createNotification({
        userId: notifyUserId,
        type:
          action === 'approve'
            ? 'claim_approved'
            : action === 'send_back_rework'
            ? 'rework_requested'
            : 'claim_submitted',
        title: notifyTitle,
        message: notifyMessage,
        relatedClaimId: id,
      });
    }

    await createAuditLog({
      userId: user.id,
      action: auditAction,
      entityType: 'claim',
      entityId: id,
      previousValue: { workflowStatus: claim.workflowStatus, status: claim.status },
      newValue: { workflowStatus: updated.workflowStatus, status: updated.status },
    });

    return NextResponse.json({ claim: updated });
  } catch (error) {
    console.error('Workflow error:', error);
    return NextResponse.json({ error: 'Failed to process workflow action' }, { status: 500 });
  }
}
