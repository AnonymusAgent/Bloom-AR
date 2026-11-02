import { db } from '@/db';
import { notifications } from '@/db/schema';

type NotificationType =
  | 'new_assignment'
  | 'claim_submitted'
  | 'review_completed'
  | 'claim_approved'
  | 'claim_rejected'
  | 'rework_requested'
  | 'task_assigned'
  | 'practice_assigned'
  | 'document_approved'
  | 'document_rejected'
  | 'signoff_pending'
  | 'signoff_approved'
  | 'signoff_rejected'
  | 'supervisor_comment'
  | 'system';

export async function createNotification({
  organizationId,
  userId,
  type,
  title,
  message,
  relatedClaimId,
}: {
  organizationId?: string | null;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedClaimId?: string;
  relatedTaskId?: string;
}) {
  await db.insert(notifications).values({
    organizationId: organizationId || null,
    userId,
    type,
    title,
    message,
    relatedClaimId,
  });
}

export const NOTIFICATION_TEMPLATES = {
  newAssignment: (claimNumber: string) => ({
    type: 'new_assignment' as const,
    title: 'New Claim Assigned',
    message: `You have been assigned a new claim: ${claimNumber}`,
  }),

  claimSubmitted: (claimNumber: string, userName: string) => ({
    type: 'claim_submitted' as const,
    title: 'Claim Submitted for Review',
    message: `${userName} has submitted claim ${claimNumber} for review`,
  }),

  claimApproved: (claimNumber: string) => ({
    type: 'claim_approved' as const,
    title: 'Claim Approved',
    message: `Your work on claim ${claimNumber} has been approved`,
  }),

  claimRejected: (claimNumber: string, reason?: string) => ({
    type: 'claim_rejected' as const,
    title: 'Claim Rejected',
    message: `Claim ${claimNumber} has been rejected${reason ? `: ${reason}` : ''}`,
  }),

  reworkRequested: (claimNumber: string, comments?: string) => ({
    type: 'rework_requested' as const,
    title: 'Rework Requested',
    message: `Rework requested for claim ${claimNumber}${comments ? `: ${comments}` : ''}`,
  }),
};
