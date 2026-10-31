import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { users, sessions } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { ensureSaaSColumns } from '@/lib/db-schema';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
);

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<string> {
  const token = await new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(JWT_SECRET);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    userId,
    token,
    expiresAt,
  });

  return token;
}

export async function verifySession(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    
    const [session] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.token, token),
          gt(sessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) {
      return null;
    }

    await ensureSaaSColumns();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user || !user.isActive || user.accountStatus === 'suspended') {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;

  if (!token) {
    return null;
  }

  return verifySession(token);
}

export async function logout(token: string) {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export type UserRole = 'administrator' | 'supervisor' | 'manager' | 'senior_lead' | 'team_lead' | 'ar_executive' | 'billing_user';

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
