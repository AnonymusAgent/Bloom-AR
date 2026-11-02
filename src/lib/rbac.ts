import { db } from '@/db';
import {
  organizationMembers,
  userPracticeAssignments,
  claims,
  billingTasks,
  practices,
  patients,
} from '@/db/schema';
import { eq, inArray, and, isNotNull } from 'drizzle-orm';
import type { User } from '@/db/schema';

/**
 * Organization-scoped practice authorization.
 * Even `'all'` strictly means ALL practices belonging to `organizationId` — NEVER global!
 */
export async function getUserAuthorizedPracticeIds(
  user: User,
  organizationId: string
): Promise<string[] | 'all'> {
  if (['administrator', 'supervisor', 'manager'].includes(user.role)) {
    return 'all';
  }

  if (['senior_lead', 'team_lead'].includes(user.role)) {
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
    const allUserIds = [user.id, ...teamMembers.map((m) => m.userId)];

    const assignments = await db
      .select({ practiceId: userPracticeAssignments.practiceId })
      .from(userPracticeAssignments)
      .innerJoin(practices, eq(userPracticeAssignments.practiceId, practices.id))
      .where(
        and(
          inArray(userPracticeAssignments.userId, allUserIds),
          eq(practices.organizationId, organizationId)
        )
      );

    const claimPractices = await db
      .selectDistinct({ practiceId: claims.practiceId })
      .from(claims)
      .where(
        and(
          eq(claims.organizationId, organizationId),
          inArray(claims.assignedTo, allUserIds),
          isNotNull(claims.practiceId)
        )
      );

    return [
      ...new Set([
        ...assignments.map((a) => a.practiceId),
        ...claimPractices.map((c) => c.practiceId).filter((id): id is string => Boolean(id)),
      ]),
    ];
  }

  const assignments = await db
    .select({ practiceId: userPracticeAssignments.practiceId })
    .from(userPracticeAssignments)
    .innerJoin(practices, eq(userPracticeAssignments.practiceId, practices.id))
    .where(
      and(
        eq(userPracticeAssignments.userId, user.id),
        eq(practices.organizationId, organizationId)
      )
    );

  const claimPractices = await db
    .selectDistinct({ practiceId: claims.practiceId })
    .from(claims)
    .where(
      and(
        eq(claims.organizationId, organizationId),
        eq(claims.assignedTo, user.id),
        isNotNull(claims.practiceId)
      )
    );

  return [
    ...new Set([
      ...assignments.map((a) => a.practiceId),
      ...claimPractices.map((c) => c.practiceId).filter((id): id is string => Boolean(id)),
    ]),
  ];
}

/**
 * Organization-scoped user visibility.
 * `'all'` strictly means all active members of `organizationId` — NEVER cross-tenant!
 */
export async function getUserAuthorizedUserIds(
  user: User,
  organizationId: string
): Promise<string[]> {
  if (['administrator', 'supervisor', 'manager'].includes(user.role)) {
    const members = await db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.isActive, true)
        )
      );
    return [...new Set([user.id, ...members.map((m) => m.userId)])];
  }

  if (['senior_lead', 'team_lead'].includes(user.role)) {
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
    return [...new Set([user.id, ...teamMembers.map((m) => m.userId)])];
  }

  return [user.id];
}

export async function canViewUser(
  currentUser: User,
  targetUserId: string,
  organizationId: string
): Promise<boolean> {
  const authorized = await getUserAuthorizedUserIds(currentUser, organizationId);
  return authorized.includes(targetUserId);
}

export async function canAccessPractice(
  currentUser: User,
  practiceId: string,
  organizationId: string
): Promise<boolean> {
  const inOrg = await verifyPracticeInOrg(practiceId, organizationId);
  if (!inOrg) return false;
  const authorized = await getUserAuthorizedPracticeIds(currentUser, organizationId);
  if (authorized === 'all') return true;
  return authorized.includes(practiceId);
}

export async function verifyPracticeInOrg(
  practiceId: string | null | undefined,
  organizationId: string
): Promise<boolean> {
  if (!practiceId) return true;
  const [row] = await db
    .select({ id: practices.id })
    .from(practices)
    .where(and(eq(practices.id, practiceId), eq(practices.organizationId, organizationId)))
    .limit(1);
  return Boolean(row);
}

export async function verifyPatientInOrg(
  patientId: string | null | undefined,
  organizationId: string
): Promise<boolean> {
  if (!patientId) return true;
  const [row] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.organizationId, organizationId)))
    .limit(1);
  return Boolean(row);
}

export async function verifyUserInOrg(
  userId: string | null | undefined,
  organizationId: string
): Promise<boolean> {
  if (!userId) return true;
  const [row] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.isActive, true)
      )
    )
    .limit(1);
  return Boolean(row);
}

export async function verifyClaimInOrg(
  claimId: string | null | undefined,
  organizationId: string
): Promise<boolean> {
  if (!claimId) return true;
  const [row] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(and(eq(claims.id, claimId), eq(claims.organizationId, organizationId)))
    .limit(1);
  return Boolean(row);
}

export async function canAccessClaim(
  currentUser: User,
  claimId: string,
  organizationId: string
): Promise<boolean> {
  const [claim] = await db
    .select({
      id: claims.id,
      practiceId: claims.practiceId,
      assignedTo: claims.assignedTo,
      assignedBy: claims.assignedBy,
    })
    .from(claims)
    .where(and(eq(claims.id, claimId), eq(claims.organizationId, organizationId)))
    .limit(1);
  if (!claim) return false;
  if (['administrator', 'supervisor', 'manager'].includes(currentUser.role)) return true;
  if (claim.assignedTo === currentUser.id || claim.assignedBy === currentUser.id) return true;
  if (claim.assignedTo && (await canViewUser(currentUser, claim.assignedTo, organizationId))) {
    return true;
  }
  const authPractices = await getUserAuthorizedPracticeIds(currentUser, organizationId);
  if (authPractices === 'all') return true;
  if (claim.practiceId && authPractices.includes(claim.practiceId)) return true;
  return false;
}

export async function verifyTaskInOrg(
  taskId: string | null | undefined,
  organizationId: string
): Promise<boolean> {
  if (!taskId) return true;
  const [row] = await db
    .select({ id: billingTasks.id })
    .from(billingTasks)
    .where(and(eq(billingTasks.id, taskId), eq(billingTasks.organizationId, organizationId)))
    .limit(1);
  return Boolean(row);
}
