import { db } from '@/db';
import { users, userPracticeAssignments, claims } from '@/db/schema';
import { eq, inArray, and, isNotNull } from 'drizzle-orm';
import type { User } from '@/db/schema';

/**
 * Get the list of practice IDs a user is authorized to access.
 * Admins/Supervisors/Managers get all practices.
 * Team leads get practices assigned to them/their team + practices of claims assigned to them/their team.
 * Regular users get their assigned practices + practices of claims assigned directly to them.
 */
export async function getUserAuthorizedPracticeIds(user: User): Promise<string[] | 'all'> {
  if (['administrator', 'supervisor', 'manager'].includes(user.role)) {
    return 'all';
  }

  if (['senior_lead', 'team_lead'].includes(user.role)) {
    const teamMembers = await db.select({ id: users.id }).from(users).where(eq(users.teamLeadId, user.id));
    const allUserIds = [user.id, ...teamMembers.map((m) => m.id)];

    const [assignments, claimPractices] = await Promise.all([
      db
        .select({ practiceId: userPracticeAssignments.practiceId })
        .from(userPracticeAssignments)
        .where(inArray(userPracticeAssignments.userId, allUserIds)),
      db
        .selectDistinct({ practiceId: claims.practiceId })
        .from(claims)
        .where(and(inArray(claims.assignedTo, allUserIds), isNotNull(claims.practiceId))),
    ]);

    return [
      ...new Set([
        ...assignments.map((a) => a.practiceId),
        ...claimPractices.map((c) => c.practiceId).filter((id): id is string => Boolean(id)),
      ]),
    ];
  }

  // Regular user — explicit practice assignments + practices from claims assigned to them
  const [assignments, claimPractices] = await Promise.all([
    db
      .select({ practiceId: userPracticeAssignments.practiceId })
      .from(userPracticeAssignments)
      .where(eq(userPracticeAssignments.userId, user.id)),
    db
      .selectDistinct({ practiceId: claims.practiceId })
      .from(claims)
      .where(and(eq(claims.assignedTo, user.id), isNotNull(claims.practiceId))),
  ]);

  return [
    ...new Set([
      ...assignments.map((a) => a.practiceId),
      ...claimPractices.map((c) => c.practiceId).filter((id): id is string => Boolean(id)),
    ]),
  ];
}

/**
 * Get the list of user IDs whose data the current user can see.
 * Admins/Supervisors/Managers can see all.
 * Team leads can see their team.
 * Regular users can only see themselves.
 */
export async function getUserAuthorizedUserIds(user: User): Promise<string[] | 'all'> {
  if (['administrator', 'supervisor', 'manager'].includes(user.role)) {
    return 'all';
  }

  if (['senior_lead', 'team_lead'].includes(user.role)) {
    const teamMembers = await db.select({ id: users.id }).from(users).where(eq(users.teamLeadId, user.id));
    return [user.id, ...teamMembers.map((m) => m.id)];
  }

  // Regular user — only themselves
  return [user.id];
}

/**
 * Check if a user can view another user's data.
 */
export async function canViewUser(currentUser: User, targetUserId: string): Promise<boolean> {
  const authorized = await getUserAuthorizedUserIds(currentUser);
  if (authorized === 'all') return true;
  return authorized.includes(targetUserId);
}

/**
 * Check if a user can access a specific practice.
 */
export async function canAccessPractice(currentUser: User, practiceId: string): Promise<boolean> {
  const authorized = await getUserAuthorizedPracticeIds(currentUser);
  if (authorized === 'all') return true;
  return authorized.includes(practiceId);
}
