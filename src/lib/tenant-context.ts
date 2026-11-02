import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  organizations,
  organizationMembers,
  sessions,
  subscriptions,
  plans,
} from '@/db/schema';
import type { Organization, User } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getCurrentSessionWithUser, type UserRole } from '@/lib/auth';
import { authenticateApiKey } from '@/lib/api-auth';
import {
  evaluateSubscriptionState,
  type SubscriptionLifecycleState,
} from '@/lib/saas';

export const VALID_ORG_ROLES = [
  'owner',
  'admin',
  'billing_manager',
  'manager',
  'billing_specialist',
  'ar_specialist',
  'member',
  'read_only',
  'viewer',
] as const;

export type OrganizationRole = (typeof VALID_ORG_ROLES)[number];

export function mapOrgRoleToOperationalRole(
  orgRole: string,
  storedOperationalRole?: UserRole | null
): UserRole {
  switch (orgRole) {
    case 'owner':
    case 'admin':
      return 'administrator';
    case 'billing_manager':
    case 'manager':
      return storedOperationalRole && ['supervisor', 'manager', 'senior_lead', 'team_lead'].includes(storedOperationalRole)
        ? storedOperationalRole
        : 'manager';
    case 'billing_specialist':
      return 'billing_user';
    case 'ar_specialist':
      return 'ar_executive';
    case 'read_only':
    case 'viewer':
      return 'ar_executive';
    case 'member':
    default:
      return storedOperationalRole || 'ar_executive';
  }
}

export function mapOperationalRoleToDefaultOrgRole(role: UserRole): OrganizationRole {
  if (role === 'administrator') return 'admin';
  if (['supervisor', 'manager', 'senior_lead', 'team_lead'].includes(role)) return 'billing_manager';
  if (role === 'billing_user') return 'billing_specialist';
  return 'ar_specialist';
}

export function isReadOnlyOrgRole(orgRole: string): boolean {
  return orgRole === 'read_only' || orgRole === 'viewer';
}

export function isOrgAdmin(orgRole: string, effectiveRole: UserRole): boolean {
  if (isReadOnlyOrgRole(orgRole)) return false;
  return orgRole === 'owner' || orgRole === 'admin' || effectiveRole === 'administrator';
}

export function isOrgManager(orgRole: string, effectiveRole: UserRole): boolean {
  if (isReadOnlyOrgRole(orgRole)) return false;
  return (
    isOrgAdmin(orgRole, effectiveRole) ||
    orgRole === 'billing_manager' ||
    orgRole === 'manager' ||
    ['supervisor', 'manager', 'senior_lead', 'team_lead'].includes(effectiveRole)
  );
}

export interface TenantContext {
  user: User;
  sessionId: string | null;
  organizationId: string;
  organization: Organization;
  orgRole: string;
  effectiveRole: UserRole;
  isReadOnly: boolean;
  teamLeadId: string | null;
  canMutate: boolean;
  subscriptionState: SubscriptionLifecycleState;
  readOnlyReason: string | null;
  apiScopes?: string[] | null;
}

export type TenantGuardResult =
  | { ok: true; ctx: TenantContext }
  | { ok: false; response: NextResponse };

export interface RequireTenantOptions {
  request?: NextRequest;
  allowApiKey?: boolean;
  requiredApiScope?: string;
  allowMutation?: boolean;
  requiredRoles?: UserRole[];
  requiredOrgRoles?: string[];
  requiredPlanSlug?: ('professional' | 'enterprise')[];
}

export async function resolveTenantContext(
  request?: NextRequest,
  allowApiKey = false
): Promise<
  | { status: 'ok'; ctx: TenantContext }
  | { status: 'unauthenticated' }
  | { status: 'no_organization'; user: User }
  | { status: 'org_suspended'; organizationName: string }
> {
  if (allowApiKey && request) {
    const apiMatch = await authenticateApiKey(request);
    if (apiMatch && apiMatch.organization && apiMatch.member) {
      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, apiMatch.organization.id))
        .limit(1);
      const subEval = evaluateSubscriptionState(sub || null, apiMatch.organization.status);
      const scopes = Array.isArray(apiMatch.apiKey.permissions)
        ? (apiMatch.apiKey.permissions as string[])
        : ['read'];
      const effectiveRole = mapOrgRoleToOperationalRole(
        apiMatch.member.orgRole,
        apiMatch.member.operationalRole
      );
      const readOnly =
        isReadOnlyOrgRole(apiMatch.member.orgRole) ||
        (!scopes.includes('write') && !scopes.includes('claims:write') && !scopes.includes('*'));

      const scopedUser: User = {
        ...apiMatch.user,
        role: effectiveRole,
        teamLeadId: apiMatch.member.teamLeadId || apiMatch.user.teamLeadId,
      };

      return {
        status: 'ok',
        ctx: {
          user: scopedUser,
          sessionId: null,
          organizationId: apiMatch.organization.id,
          organization: apiMatch.organization,
          orgRole: apiMatch.member.orgRole,
          effectiveRole,
          isReadOnly: readOnly,
          teamLeadId: scopedUser.teamLeadId,
          canMutate: !readOnly && subEval.canMutate,
          subscriptionState: subEval.lifecycleState,
          readOnlyReason: subEval.readOnlyReason,
          apiScopes: scopes,
        },
      };
    }
  }

  const sessionDetails = await getCurrentSessionWithUser();
  if (!sessionDetails) {
    return { status: 'unauthenticated' };
  }

  const { session, user } = sessionDetails;

  const memberships = await db
    .select({
      member: organizationMembers,
      org: organizations,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.isActive, true)));

  if (memberships.length === 0) {
    // Platform Super Admins without explicit tenant membership have NO access to customer PHI
    return { status: 'no_organization', user };
  }

  let selected = session.activeOrganizationId
    ? memberships.find((m) => m.org.id === session.activeOrganizationId)
    : undefined;

  if (!selected) {
    selected = memberships.find((m) => m.org.status === 'active') || memberships[0];
    await db
      .update(sessions)
      .set({ activeOrganizationId: selected.org.id })
      .where(eq(sessions.id, session.id))
      .catch(() => {});
  }

  if (selected.org.status === 'suspended') {
    return { status: 'org_suspended', organizationName: selected.org.name };
  }

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, selected.org.id))
    .limit(1);

  const subEval = evaluateSubscriptionState(sub || null, selected.org.status);
  const orgRole = selected.member.orgRole;
  const effectiveRole = mapOrgRoleToOperationalRole(orgRole, selected.member.operationalRole);
  const readOnly = isReadOnlyOrgRole(orgRole);
  const teamLeadId = selected.member.teamLeadId || user.teamLeadId || null;

  const scopedUser: User = {
    ...user,
    role: effectiveRole,
    teamLeadId,
  };

  return {
    status: 'ok',
    ctx: {
      user: scopedUser,
      sessionId: session.id,
      organizationId: selected.org.id,
      organization: selected.org,
      orgRole,
      effectiveRole,
      isReadOnly: readOnly,
      teamLeadId,
      canMutate: !readOnly && subEval.canMutate,
      subscriptionState: subEval.lifecycleState,
      readOnlyReason: subEval.readOnlyReason,
      apiScopes: null,
    },
  };
}

export async function requireTenantContext(
  options: RequireTenantOptions = {}
): Promise<TenantGuardResult> {
  const resolved = await resolveTenantContext(
    options.request,
    Boolean(options.allowApiKey)
  );

  if (resolved.status === 'unauthenticated') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (resolved.status === 'no_organization') {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: resolved.user.isPlatformAdmin
            ? 'Platform Super Admins do not have automatic access to customer PHI. Switch to an organization where you hold an explicit membership.'
            : 'No active organization workspace found. Complete onboarding or accept an organization invitation.',
          code: 'NO_ORGANIZATION_MEMBERSHIP',
        },
        { status: 403 }
      ),
    };
  }

  if (resolved.status === 'org_suspended') {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Workspace "${resolved.organizationName}" is currently suspended. Contact platform support or your organization owner.`,
          code: 'ORGANIZATION_SUSPENDED',
        },
        { status: 403 }
      ),
    };
  }

  const { ctx } = resolved;

  if (options.requiredApiScope && ctx.apiScopes) {
    const ok =
      ctx.apiScopes.includes(options.requiredApiScope) ||
      (options.requiredApiScope.endsWith(':read') && ctx.apiScopes.includes('read')) ||
      (options.requiredApiScope.endsWith(':write') && ctx.apiScopes.includes('write')) ||
      ctx.apiScopes.includes('*');
    if (!ok) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `Missing required API scope: ${options.requiredApiScope}`, code: 'MISSING_API_SCOPE' },
          { status: 403 }
        ),
      };
    }
  }

  if (options.allowMutation) {
    if (ctx.isReadOnly) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: 'Read-only workspace members cannot create, edit, or delete records.',
            code: 'READ_ONLY_ROLE',
          },
          { status: 403 }
        ),
      };
    }

    if (!ctx.canMutate) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error:
              ctx.readOnlyReason ||
              'Subscription is inactive. Workspace is in read-only mode.',
            code: 'SUBSCRIPTION_READ_ONLY',
          },
          { status: 402 }
        ),
      };
    }
  }

  if (options.requiredRoles && options.requiredRoles.length > 0) {
    if (!options.requiredRoles.includes(ctx.effectiveRole)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Insufficient permissions for this workspace action', code: 'FORBIDDEN' },
          { status: 403 }
        ),
      };
    }
  }

  if (options.requiredOrgRoles && options.requiredOrgRoles.length > 0) {
    if (!options.requiredOrgRoles.includes(ctx.orgRole)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Insufficient organization role permissions', code: 'FORBIDDEN' },
          { status: 403 }
        ),
      };
    }
  }

  if (options.requiredPlanSlug && options.requiredPlanSlug.length > 0) {
    const [subRow] = await db
      .select({ plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.organizationId, ctx.organizationId))
      .limit(1);
    if (subRow?.plan && !options.requiredPlanSlug.includes(subRow.plan.slug as 'professional' | 'enterprise')) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: `Your current plan (${subRow.plan.name}) does not include this feature. Upgrade to ${options.requiredPlanSlug.join(' or ')} in Billing Settings.`,
            code: 'FEATURE_NOT_ENTITLED',
          },
          { status: 402 }
        ),
      };
    }
  }

  return { ok: true, ctx };
}

/**
 * Executes a callback inside a PostgreSQL transaction with kernel-level Row-Level Security
 * strictly bound to `organizationId` (`app.enforce_rls = 'on'`, `app.current_org_id = <uuid>`).
 */
export async function withTenantRls<T>(
  organizationId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
    throw new Error('Invalid organizationId UUID for RLS context');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.enforce_rls', 'on', true)`);
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${organizationId}, true)`);
    return fn(tx);
  });
}
