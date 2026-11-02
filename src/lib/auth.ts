import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { users, sessions, organizationMembers, organizations } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { ensureSaaSColumns } from '@/lib/db-schema';
import type { User, Session } from '@/db/schema';

function resolveJwtSecretBytes(): Uint8Array {
  const configured = process.env.JWT_SECRET;
  if (configured && configured.length >= 16) {
    return new TextEncoder().encode(configured);
  }
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    throw new Error('JWT_SECRET (>=16 characters) is required in production');
  }
  return new TextEncoder().encode(
    configured || 'dev-only-jwt-secret-bloomar-local-testing-32b'
  );
}

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days absolute
const MAX_SERVER_IDLE_MS = 8 * 60 * 60 * 1000; // 8 hours server-side idle window

export interface SessionWithUser {
  session: Session;
  user: User;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(
  userId: string,
  options?: {
    activeOrganizationId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    mfaVerifiedAt?: Date | null;
  }
): Promise<string> {
  await ensureSaaSColumns();

  let activeOrgId = options?.activeOrganizationId ?? null;
  if (!activeOrgId) {
    const memberships = await db
      .select({
        organizationId: organizationMembers.organizationId,
        orgStatus: organizations.status,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
      .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.isActive, true)));

    const preferred =
      memberships.find((m) => m.orgStatus === 'active') || memberships[0] || null;
    activeOrgId = preferred?.organizationId ?? null;
  }

  const token = await new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(resolveJwtSecretBytes());

  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.insert(sessions).values({
    userId,
    activeOrganizationId: activeOrgId,
    token,
    lastActiveAt: new Date(),
    ipAddress: options?.ipAddress || null,
    userAgent: options?.userAgent || null,
    mfaVerifiedAt: options?.mfaVerifiedAt || null,
    expiresAt,
  });

  return token;
}

export async function verifySessionWithDetails(token: string): Promise<SessionWithUser | null> {
  try {
    await jwtVerify(token, resolveJwtSecretBytes());
    await ensureSaaSColumns();

    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
      .limit(1);

    if (!session) {
      return null;
    }

    const now = Date.now();
    const lastActiveMs = session.lastActiveAt ? new Date(session.lastActiveAt).getTime() : now;
    if (now - lastActiveMs > MAX_SERVER_IDLE_MS) {
      await db.delete(sessions).where(eq(sessions.id, session.id));
      return null;
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user || !user.isActive || user.accountStatus === 'suspended') {
      return null;
    }

    if (now - lastActiveMs > 60_000) {
      await db
        .update(sessions)
        .set({ lastActiveAt: new Date() })
        .where(eq(sessions.id, session.id))
        .catch(() => {});
    }

    return { session, user };
  } catch {
    return null;
  }
}

export async function verifySession(token: string) {
  const details = await verifySessionWithDetails(token);
  return details ? details.user : null;
}

export async function getCurrentSessionWithUser(): Promise<SessionWithUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  if (!token) return null;
  return verifySessionWithDetails(token);
}

export async function getCurrentUser() {
  const details = await getCurrentSessionWithUser();
  if (!details) return null;

  // Bind user.role in-memory to the verified active organization's operational role
  // so legacy role checks never leak global privileges across tenants.
  if (details.session.activeOrganizationId) {
    const [m] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, details.session.activeOrganizationId),
          eq(organizationMembers.userId, details.user.id),
          eq(organizationMembers.isActive, true)
        )
      )
      .limit(1);
    if (m) {
      const effectiveRole =
        m.orgRole === 'owner' || m.orgRole === 'admin'
          ? ('administrator' as const)
          : m.orgRole === 'billing_manager' || m.orgRole === 'manager'
          ? ('manager' as const)
          : m.operationalRole;
      return {
        ...details.user,
        role: effectiveRole,
        teamLeadId: m.teamLeadId || details.user.teamLeadId,
      };
    }
  }

  return details.user;
}

export async function switchSessionOrganization(
  sessionId: string,
  organizationId: string
): Promise<void> {
  await db
    .update(sessions)
    .set({
      activeOrganizationId: organizationId,
      lastActiveAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));
}

export async function logout(token: string) {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export type UserRole =
  | 'administrator'
  | 'supervisor'
  | 'manager'
  | 'senior_lead'
  | 'team_lead'
  | 'ar_executive'
  | 'billing_user';

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  administrator: [
    'manage_users',
    'upload_files',
    'assign_claims',
    'assign_practices',
    'assign_tasks',
    'view_all_claims',
    'view_all_tasks',
    'review_claims',
    'review_signoffs',
    'manage_denial_codes',
    'view_audit_logs',
    'view_all_dashboards',
    'view_reports',
    'export_data',
  ],
  supervisor: [
    'upload_files',
    'assign_claims',
    'assign_practices',
    'assign_tasks',
    'view_all_claims',
    'view_all_tasks',
    'review_claims',
    'review_signoffs',
    'view_audit_logs',
    'view_all_dashboards',
    'view_reports',
    'export_data',
  ],
  manager: [
    'upload_files',
    'assign_claims',
    'assign_practices',
    'assign_tasks',
    'view_all_claims',
    'view_all_tasks',
    'review_claims',
    'review_signoffs',
    'view_audit_logs',
    'view_all_dashboards',
    'view_reports',
    'export_data',
  ],
  senior_lead: [
    'upload_files',
    'assign_claims',
    'assign_tasks',
    'view_team_claims',
    'view_team_tasks',
    'review_claims',
    'review_signoffs',
    'view_team_dashboards',
    'export_data',
  ],
  team_lead: [
    'assign_claims',
    'assign_tasks',
    'view_team_claims',
    'view_team_tasks',
    'review_claims',
    'review_signoffs',
    'view_team_dashboards',
  ],
  ar_executive: [
    'view_assigned_claims',
    'work_claims',
    'submit_for_review',
    'upload_documents',
    'submit_signoff',
  ],
  billing_user: [
    'view_assigned_claims',
    'view_assigned_tasks',
    'work_claims',
    'work_tasks',
    'submit_for_review',
    'upload_documents',
    'submit_signoff',
  ],
};

export function hasPermission(role: UserRole, permission: string): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAssignClaims(role: UserRole): boolean {
  return ['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead'].includes(role);
}

export function canAssignTasks(role: UserRole): boolean {
  return ['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead'].includes(role);
}

export function canAssignPractices(role: UserRole): boolean {
  return ['administrator', 'supervisor', 'manager'].includes(role);
}

export function canReviewClaims(role: UserRole): boolean {
  return ['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead'].includes(role);
}

export function canReviewSignoffs(role: UserRole): boolean {
  return ['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead'].includes(role);
}

export function canUploadFiles(role: UserRole): boolean {
  return ['administrator', 'supervisor', 'manager', 'senior_lead'].includes(role);
}

export function canManageUsers(role: UserRole): boolean {
  return role === 'administrator';
}

export function canViewReports(role: UserRole): boolean {
  return ['administrator', 'supervisor', 'manager'].includes(role);
}

export function isSupervisorOrAbove(role: UserRole): boolean {
  return ['administrator', 'supervisor', 'manager'].includes(role);
}
