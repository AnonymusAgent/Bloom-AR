import { NextRequest } from 'next/server';
import { db } from '@/db';
import { organizationMembers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { resolveTenantContext } from '@/lib/tenant-context';

/** Deny-by-default membership check. Never infer membership from email domain or client-supplied org id alone. */
export async function requireMembership(userId: string, organizationId: string, roles?: string[]) {
  const [m] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.isActive, true)
      )
    )
    .limit(1);
  if (!m) return null;
  if (roles && !roles.includes(m.orgRole)) return null;
  return m;
}

export async function userOrgIds(userId: string) {
  const rows = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.isActive, true)));
  return rows.map((r) => r.organizationId);
}

export async function resolveActiveTenant(request?: NextRequest) {
  const res = await resolveTenantContext(request, Boolean(request));
  if (res.status !== 'ok') return null;
  return {
    organizationId: res.ctx.organizationId,
    organizationName: res.ctx.organization.name,
    orgRole: res.ctx.orgRole,
    effectiveRole: res.ctx.effectiveRole,
    isReadOnly: res.ctx.isReadOnly,
    canMutate: res.ctx.canMutate,
  };
}
