import { NextResponse } from 'next/server';
import { db } from '@/db';
import { organizationMembers, organizations, userMfa } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { getCurrentSessionWithUser } from '@/lib/auth';
import { isPlatformAdminUser } from '@/lib/platform-admin';
import { resolveTenantContext, mapOrgRoleToOperationalRole } from '@/lib/tenant-context';

export async function GET() {
  try {
    const details = await getCurrentSessionWithUser();
    if (!details) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { user } = details;
    const tenant = await resolveTenantContext();

    const memberships = await db
      .select({ member: organizationMembers, org: organizations })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
      .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.isActive, true)));

    const [mfa] = await db
      .select({ isEnabled: userMfa.isEnabled })
      .from(userMfa)
      .where(eq(userMfa.userId, user.id))
      .limit(1);

    const activeCtx = tenant.status === 'ok' ? tenant.ctx : null;

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: activeCtx ? activeCtx.effectiveRole : user.role,
        orgRole: activeCtx ? activeCtx.orgRole : null,
        organizationId: activeCtx ? activeCtx.organizationId : null,
        organizationName: activeCtx ? activeCtx.organization.name : null,
        organizationStatus: activeCtx
          ? activeCtx.organization.status
          : tenant.status === 'org_suspended'
          ? 'suspended'
          : null,
        isReadOnly: activeCtx ? activeCtx.isReadOnly : false,
        mfaEnabled: Boolean(mfa?.isEnabled),
        isPlatformAdmin: isPlatformAdminUser(
          user as { id: string; email: string; isPlatformAdmin?: boolean }
        ),
        teamLeadId: activeCtx ? activeCtx.teamLeadId : user.teamLeadId,
      },
      activeOrganization: activeCtx
        ? {
            id: activeCtx.organizationId,
            name: activeCtx.organization.name,
            slug: activeCtx.organization.slug,
            orgRole: activeCtx.orgRole,
            effectiveRole: activeCtx.effectiveRole,
            isReadOnly: activeCtx.isReadOnly,
            canMutate: activeCtx.canMutate,
            subscriptionState: activeCtx.subscriptionState,
            readOnlyReason: activeCtx.readOnlyReason,
          }
        : null,
      organizations: memberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug,
        status: m.org.status,
        orgRole: m.member.orgRole,
        effectiveRole: mapOrgRoleToOperationalRole(
          m.member.orgRole,
          m.member.operationalRole
        ),
      })),
    });
  } catch (error) {
    console.error('Get current user error:', error);
    return NextResponse.json({ error: 'An error occurred' }, { status: 500 });
  }
}
