import { db } from '@/db';
import { auditLogs } from '@/db/schema';

const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'keyHash',
  'totpSecret',
  'fileData',
  'signatureData',
  'ssn',
  'socialSecurityNumber',
]);

/**
 * Redacts credentials, binary payloads, and high-risk identifiers before audit persistence
 * so audit records remain tamper-evident without leaking secrets or excessive PHI.
 */
export function sanitizeAuditPayload(
  payload?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (REDACTED_KEYS.has(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (typeof val === 'string') {
      // Mask SSN patterns if accidentally passed in free-text fields
      out[key] = val.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '***-**-****').slice(0, 1000);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = sanitizeAuditPayload(val as Record<string, unknown>);
    } else {
      out[key] = val;
    }
  }
  return out;
}

export async function createAuditLog({
  organizationId,
  userId,
  actorRole,
  action,
  entityType,
  entityId,
  previousValue,
  newValue,
  ipAddress,
  userAgent,
}: {
  organizationId?: string | null;
  userId?: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId?: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}) {
  await db.insert(auditLogs).values({
    organizationId: organizationId || null,
    userId,
    actorRole: actorRole || null,
    action,
    entityType,
    entityId,
    previousValue: sanitizeAuditPayload(previousValue),
    newValue: sanitizeAuditPayload(newValue),
    ipAddress,
    userAgent,
  });
}

export const AUDIT_ACTIONS = {
  // User & auth actions
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  USER_DEACTIVATED: 'user_deactivated',
  MFA_ENABLED: 'mfa_enabled',
  MFA_DISABLED: 'mfa_disabled',
  ORG_SWITCHED: 'organization_switched',
  ORG_SWITCH_DENIED: 'unauthorized_org_switch_attempt',

  // Claim actions
  CLAIM_CREATED: 'claim_created',
  CLAIM_UPDATED: 'claim_updated',
  CLAIM_ASSIGNED: 'claim_assigned',
  CLAIM_STATUS_CHANGED: 'claim_status_changed',
  CLAIM_NOTE_ADDED: 'claim_note_added',
  CLAIM_SUBMITTED_FOR_REVIEW: 'claim_submitted_for_review',
  CLAIM_APPROVED: 'claim_approved',
  CLAIM_REJECTED: 'claim_rejected',
  CLAIM_REWORK_REQUESTED: 'claim_rework_requested',

  // Document actions
  DOCUMENT_UPLOADED: 'document_uploaded',
  DOCUMENT_DOWNLOADED: 'document_downloaded',
  EOB_UPLOADED: 'eob_uploaded',
  DENIAL_DOCUMENT_UPLOADED: 'denial_document_uploaded',

  // File actions
  FILE_UPLOADED: 'file_uploaded',
  FILE_PROCESSED: 'file_processed',

  // System actions
  DENIAL_CODE_ADDED: 'denial_code_added',
  DENIAL_CODE_UPDATED: 'denial_code_updated',
} as const;
