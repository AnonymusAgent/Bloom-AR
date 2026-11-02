import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, practices, userPracticeAssignments } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import {
  getCurrentUser,
  UserRole,
  ROLE_PERMISSIONS,
  canUploadFiles,
  canAssignClaims,
  canAssignTasks,
  canAssignPractices,
  canReviewClaims,
  canReviewSignoffs,
  canManageUsers,
  canViewReports,
  isSupervisorOrAbove,
} from '@/lib/auth';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { resolveTenantContext } from '@/lib/tenant-context';
import {
  resolveSessionSecurity,
  resolveInactivityTimeout,
  resolveWarnBeforeLock,
} from '@/lib/session-security';

const PERMISSION_DESCRIPTIONS: Record<
  string,
  { label: string; description: string; category: string }
> = {
  upload_files: {
    label: 'Upload AR Batches',
    description: 'Upload and parse AR Excel spreadsheets, CSVs, and remittance files',
    category: 'AR & Data Ingestion',
  },
  assign_claims: {
    label: 'Assign Claims',
    description: 'Assign and distribute claims to AR executives and billing specialists',
    category: 'Workforce Management',
  },
  assign_practices: {
    label: 'Assign Practices',
    description: 'Allocate provider practices to billing personnel',
    category: 'Workforce Management',
  },
  assign_tasks: {
    label: 'Assign Billing Tasks',
    description: 'Delegate prior authorizations, verification, and payment tasks',
    category: 'Workforce Management',
  },
  view_all_claims: {
    label: 'View All Organization Claims',
    description: 'Full visibility across all practice claims and aging balances',
    category: 'Claims Access',
  },
  view_team_claims: {
    label: 'View Team Claims',
    description: 'Access claims assigned across your designated team members',
    category: 'Claims Access',
  },
  view_assigned_claims: {
    label: 'View Assigned Claims',
    description: 'Access and manage claims in your personal work queue',
    category: 'Claims Access',
  },
  work_claims: {
    label: 'Work & Update Claims',
    description: 'Record follow-up actions, apply denial codes, and update statuses',
    category: 'Claims Processing',
  },
  submit_for_review: {
    label: 'Submit for Audit Review',
    description: 'Forward completed claims to team leads or supervisors for sign-off',
    category: 'Claims Processing',
  },
  review_claims: {
    label: 'Review & Approve Claims',
    description: 'Audit worked claims and either approve or request rework',
    category: 'Quality & Audit',
  },
  review_signoffs: {
    label: 'Review Sign-Off Requests',
    description: 'Approve or reject financial adjustments, write-offs, and appeals',
    category: 'Quality & Audit',
  },
  submit_signoff: {
    label: 'Request Sign-Off',
    description: 'Request formal supervisor approval for write-offs or adjustments',
    category: 'Quality & Audit',
  },
  upload_documents: {
    label: 'Upload Claim Documents',
    description: 'Attach EOBs, denial notices, and clinical records to claims',
    category: 'Documents',
  },
  manage_users: {
    label: 'Manage User Accounts',
    description: 'Create, update, activate, and deactivate team accounts and roles',
    category: 'Administration',
  },
  manage_denial_codes: {
    label: 'Manage Denial Codes',
    description: 'Configure and update CARC/RARC denial resolution playbooks',
    category: 'Administration',
  },
  view_audit_logs: {
    label: 'View Audit Logs',
    description: 'Review compliance audit trails, file uploads, and system activity',
    category: 'Compliance',
  },
  view_all_dashboards: {
    label: 'Executive Dashboards',
    description: 'Full visibility into organizational KPI dashboards and aging',
    category: 'Analytics',
  },
  view_team_dashboards: {
    label: 'Team Dashboards',
    description: 'Review team productivity, collections, and work queues',
    category: 'Analytics',
  },
  view_reports: {
    label: 'Financial & AR Reports',
    description: 'Run comprehensive AR aging, payer yield, and denial trend reports',
    category: 'Analytics',
  },
  export_data: {
    label: 'Export Data',
    description: 'Export claims, reports, and audit logs to Excel and CSV',
    category: 'Analytics',
  },
};

const ALL_DEFINED_PERMISSIONS = Object.keys(PERMISSION_DESCRIPTIONS);

const AVATAR_COLOR_PRESETS = [
  'from-blue-600 to-indigo-600',
  'from-emerald-600 to-teal-700',
  'from-violet-600 to-purple-800',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-red-700',
  'from-cyan-600 to-blue-700',
];

const DATE_FORMATS = ['MM/DD/YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY'];

const TIMEZONES = [
  'America/New_York (EST)',
  'America/Chicago (CST)',
  'America/Denver (MST)',
  'America/Los_Angeles (PST)',
];

const PAGE_SIZES = [10, 25, 50, 100];

function pickOneOf<T>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function sanitizePreferences(
  incoming: unknown,
  existing: Record<string, unknown> | null
): Record<string, unknown> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const next =
    incoming && typeof incoming === 'object' && !Array.isArray(incoming)
      ? (incoming as Record<string, unknown>)
      : {};

  const existingNotifs =
    base.notifications &&
    typeof base.notifications === 'object' &&
    !Array.isArray(base.notifications)
      ? (base.notifications as Record<string, unknown>)
      : {};

  const incomingNotifs =
    next.notifications &&
    typeof next.notifications === 'object' &&
    !Array.isArray(next.notifications)
      ? (next.notifications as Record<string, unknown>)
      : {};

  const mergedNotifs = { ...existingNotifs, ...incomingNotifs };

  const existingSecurity =
    base.sessionSecurity &&
    typeof base.sessionSecurity === 'object' &&
    !Array.isArray(base.sessionSecurity)
      ? (base.sessionSecurity as Record<string, unknown>)
      : {};

  const incomingSecurity =
    next.sessionSecurity &&
    typeof next.sessionSecurity === 'object' &&
    !Array.isArray(next.sessionSecurity)
      ? (next.sessionSecurity as Record<string, unknown>)
      : {};

  const mergedSecurity = { ...existingSecurity, ...incomingSecurity };
  const sessionSecurity = resolveSessionSecurity(mergedSecurity);

  return {
    ...base,
    ...next,
    notifications: {
      email: Boolean(mergedNotifs.email ?? true),
      assignments: Boolean(mergedNotifs.assignments ?? true),
      signoffs: Boolean(mergedNotifs.signoffs ?? true),
      statusUpdates: Boolean(mergedNotifs.statusUpdates ?? true),
    },
    sessionSecurity: {
      inactivityTimeoutMinutes: resolveInactivityTimeout(
        mergedSecurity.inactivityTimeoutMinutes
      ),
      logoutOnClose: sessionSecurity.logoutOnClose,
      warnBeforeLockSeconds: resolveWarnBeforeLock(mergedSecurity.warnBeforeLockSeconds),
    },
    dateFormat: pickOneOf(next.dateFormat ?? base.dateFormat, DATE_FORMATS, 'MM/DD/YYYY'),
    timezone: pickOneOf(
      next.timezone ?? base.timezone,
      TIMEZONES,
      'America/New_York (EST)'
    ),
    pageSize: pickOneOf(Number(next.pageSize ?? base.pageSize), PAGE_SIZES, 25),
    avatarColor: pickOneOf(
      next.avatarColor ?? base.avatarColor,
      AVATAR_COLOR_PRESETS,
      AVATAR_COLOR_PRESETS[0]
    ),
  };
}

const ROLE_INFO: Record<UserRole, { title: string; description: string; level: string }> = {
  administrator: {
    title: 'System Administrator',
    description:
      'Complete operational and administrative control across all practices, users, and billing workflows.',
    level: 'Tier 1 - Full System Access',
  },
  supervisor: {
    title: 'Operations Supervisor',
    description:
      'Supervises billing operations, audits claims, approves sign-offs, and manages AR batch imports.',
    level: 'Tier 2 - Operational Leadership',
  },
  manager: {
    title: 'Account Manager',
    description:
      'Oversees client practice accounts, monitors collection benchmarks, and leads billing team workflows.',
    level: 'Tier 2 - Operational Management',
  },
  senior_lead: {
    title: 'Senior Team Lead',
    description:
      'Assists with AR batch uploads, audits complex denials, and mentors AR executives and billing users.',
    level: 'Tier 3 - Senior Leadership',
  },
  team_lead: {
    title: 'Team Lead',
    description:
      'Coordinates daily team claim assignments, audits work queues, and reviews sign-off submissions.',
    level: 'Tier 3 - Team Leadership',
  },
  ar_executive: {
    title: 'AR Executive',
    description:
      'Focuses on working unpaid claims, resolving payer denials, contacting insurance reps, and filing appeals.',
    level: 'Tier 4 - AR Specialist',
  },
  billing_user: {
    title: 'Billing Specialist',
    description:
      'Handles charge entry, payment posting, verification of benefits, and prior authorization tasks.',
    level: 'Tier 4 - Billing Specialist',
  },
};

export async function GET() {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const tenant = await resolveTenantContext();
    const activeCtx = tenant.status === 'ok' ? tenant.ctx : null;

    const [fullUser] = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
        avatarUrl: users.avatarUrl,
        role: users.role,
        isActive: users.isActive,
        preferences: users.preferences,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        lastLoginAt: users.lastLoginAt,
        teamLeadId: users.teamLeadId,
      })
      .from(users)
      .where(eq(users.id, sessionUser.id))
      .limit(1);

    if (!fullUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const effectiveRole = activeCtx ? activeCtx.user.role : sessionUser.role;
    const effectiveTeamLeadId = sessionUser.teamLeadId || fullUser.teamLeadId;

    let teamLeadInfo = null;
    if (effectiveTeamLeadId) {
      const [lead] = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, effectiveTeamLeadId))
        .limit(1);
      teamLeadInfo = lead || null;
    }

    // Strict tenant isolation: only return practices in the user's active organization!
    let assignedPractices: Array<{
      id: string;
      name: string;
      code: string;
      specialty: string | null;
    }> = [];
    if (activeCtx) {
      const orgId = activeCtx.organizationId;
      if (['administrator', 'supervisor', 'manager'].includes(effectiveRole)) {
        assignedPractices = await db
          .select({
            id: practices.id,
            name: practices.name,
            code: practices.code,
            specialty: practices.specialty,
          })
          .from(practices)
          .where(and(eq(practices.organizationId, orgId), eq(practices.isActive, true)))
          .orderBy(practices.name);
      } else {
        const userAssignments = await db
          .select({ practiceId: userPracticeAssignments.practiceId })
          .from(userPracticeAssignments)
          .where(
            and(
              eq(userPracticeAssignments.organizationId, orgId),
              eq(userPracticeAssignments.userId, fullUser.id)
            )
          );

        const practiceIds = userAssignments.map((a) => a.practiceId);
        if (practiceIds.length > 0) {
          assignedPractices = await db
            .select({
              id: practices.id,
              name: practices.name,
              code: practices.code,
              specialty: practices.specialty,
            })
            .from(practices)
            .where(and(eq(practices.organizationId, orgId), inArray(practices.id, practiceIds)))
            .orderBy(practices.name);
        }
      }
    }

    const grantedKeys = ROLE_PERMISSIONS[effectiveRole] || [];
    const grantedPermissions = grantedKeys.map((key) => ({
      key,
      label: PERMISSION_DESCRIPTIONS[key]?.label || key,
      description: PERMISSION_DESCRIPTIONS[key]?.description || '',
      category: PERMISSION_DESCRIPTIONS[key]?.category || 'General',
      isGranted: true,
    }));

    const restrictedKeys = ALL_DEFINED_PERMISSIONS.filter((key) => !grantedKeys.includes(key));
    const restrictedPermissions = restrictedKeys.map((key) => ({
      key,
      label: PERMISSION_DESCRIPTIONS[key]?.label || key,
      description: PERMISSION_DESCRIPTIONS[key]?.description || '',
      category: PERMISSION_DESCRIPTIONS[key]?.category || 'General',
      isGranted: false,
    }));

    const isReadOnly = activeCtx?.isReadOnly ?? false;
    const capabilities = {
      canUploadFiles: !isReadOnly && canUploadFiles(effectiveRole),
      canAssignClaims: !isReadOnly && canAssignClaims(effectiveRole),
      canAssignTasks: !isReadOnly && canAssignTasks(effectiveRole),
      canAssignPractices: !isReadOnly && canAssignPractices(effectiveRole),
      canReviewClaims: !isReadOnly && canReviewClaims(effectiveRole),
      canReviewSignoffs: !isReadOnly && canReviewSignoffs(effectiveRole),
      canManageUsers: !isReadOnly && canManageUsers(effectiveRole),
      canViewReports: canViewReports(effectiveRole) || isReadOnly,
      isSupervisorOrAbove: isSupervisorOrAbove(effectiveRole),
    };

    return NextResponse.json({
      user: {
        ...fullUser,
        role: effectiveRole,
        orgRole: activeCtx?.orgRole ?? null,
        organizationName: activeCtx?.organization.name ?? null,
        preferences: sanitizePreferences(fullUser.preferences, null),
        roleInfo: ROLE_INFO[effectiveRole] || {
          title: effectiveRole,
          description: '',
          level: 'Standard User',
        },
      },
      teamLead: teamLeadInfo,
      assignedPractices,
      permissions: {
        granted: grantedPermissions,
        restricted: restrictedPermissions,
        capabilities,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return NextResponse.json({ error: 'Failed to retrieve profile' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const tenant = await resolveTenantContext();
    const activeCtx = tenant.status === 'ok' ? tenant.ctx : null;

    const body = await request.json();
    const updateData: Partial<typeof users.$inferInsert> = {};

    if (body.firstName !== undefined) {
      const trimmed = String(body.firstName).trim();
      if (!trimmed) return NextResponse.json({ error: 'First name is required' }, { status: 400 });
      updateData.firstName = trimmed;
    }

    if (body.lastName !== undefined) {
      const trimmed = String(body.lastName).trim();
      if (!trimmed) return NextResponse.json({ error: 'Last name is required' }, { status: 400 });
      updateData.lastName = trimmed;
    }

    if (body.phone !== undefined) {
      updateData.phone = body.phone ? String(body.phone).trim() : null;
    }

    if (body.avatarUrl !== undefined) {
      updateData.avatarUrl = body.avatarUrl ? String(body.avatarUrl).trim() : null;
    }

    const [existingUser] = await db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, sessionUser.id))
      .limit(1);

    if (body.preferences !== undefined) {
      updateData.preferences = sanitizePreferences(
        body.preferences,
        (existingUser?.preferences as Record<string, unknown> | null) ?? null
      );
    } else if (body.avatarColor !== undefined) {
      updateData.preferences = sanitizePreferences(
        { avatarColor: body.avatarColor },
        (existingUser?.preferences as Record<string, unknown> | null) ?? null
      );
    }

    updateData.updatedAt = new Date();

    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, sessionUser.id))
      .returning({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
        avatarUrl: users.avatarUrl,
        role: users.role,
        preferences: users.preferences,
        updatedAt: users.updatedAt,
      });

    await createAuditLog({
      organizationId: activeCtx?.organizationId,
      userId: sessionUser.id,
      actorRole: activeCtx?.orgRole,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'user_profile',
      entityId: sessionUser.id,
      newValue: {
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        phone: updatedUser.phone,
        avatarUrl: updatedUser.avatarUrl,
        preferences: updatedUser.preferences,
      },
      ipAddress: request.headers.get('x-forwarded-for') || '127.0.0.1',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
