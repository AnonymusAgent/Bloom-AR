import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, organizationMembers } from '@/db/schema';
import { eq, and, ilike, or, desc } from 'drizzle-orm';
import { hashPassword, canManageUsers, type UserRole } from '@/lib/auth';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { cleanUuid } from '@/lib/sanitize';
import {
  requireTenantContext,
  mapOrgRoleToOperationalRole,
  mapOperationalRoleToDefaultOrgRole,
} from '@/lib/tenant-context';
import { getEntitlements } from '@/lib/saas';
import { verifyUserInOrg } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');
    const role = searchParams.get('role');
    const isActive = searchParams.get('isActive');

    const conditions = [eq(organizationMembers.organizationId, ctx.organizationId)];

    if (search) {
      conditions.push(
        or(
          ilike(users.firstName, `%${search}%`),
          ilike(users.lastName, `%${search}%`),
          ilike(users.email, `%${search}%`)
        )!
      );
    }

    if (isActive !== null && isActive !== undefined) {
      conditions.push(eq(organizationMembers.isActive, isActive === 'true'));
    } else {
      conditions.push(eq(organizationMembers.isActive, true));
    }

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        globalRole: users.role,
        orgRole: organizationMembers.orgRole,
        operationalRole: organizationMembers.operationalRole,
        memberIsActive: organizationMembers.isActive,
        userIsActive: users.isActive,
        teamLeadId: organizationMembers.teamLeadId,
        createdAt: organizationMembers.createdAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(organizationMembers.createdAt));

    let mapped = rows.map((r) => {
      const effectiveRole = mapOrgRoleToOperationalRole(r.orgRole, r.operationalRole);
      return {
        id: r.id,
        email: r.email,
        firstName: r.firstName,
        lastName: r.lastName,
        role: effectiveRole,
        orgRole: r.orgRole,
        isActive: r.memberIsActive && r.userIsActive,
        teamLeadId: r.teamLeadId,
        createdAt: r.createdAt,
        lastLoginAt: r.lastLoginAt,
      };
    });

    if (role) {
      mapped = mapped.filter((u) => u.role === role);
    }

    return NextResponse.json({ users: mapped });
  } catch (error) {
    console.error('Get users error:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    if (!canManageUsers(ctx.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const ent = await getEntitlements(ctx.organizationId);
    if (ent && !ent.canAddSeat) {
      return NextResponse.json(
        {
          error: `Seat limit reached for your plan (${ent.usage.seatsLimit} seats). Upgrade in Billing Settings to add more team members.`,
          code: 'SEAT_LIMIT_REACHED',
        },
        { status: 402 }
      );
    }

    const body = await request.json();
    const { email, password, firstName, lastName, role, orgRole, teamLeadId } = body;

    if (!email || !password || !firstName || !lastName || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const cleanedLeadId = cleanUuid(teamLeadId);
    if (cleanedLeadId) {
      const leadInOrg = await verifyUserInOrg(cleanedLeadId, ctx.organizationId);
      if (!leadInOrg) {
        return NextResponse.json(
          { error: 'Selected team lead does not belong to your organization' },
          { status: 400 }
        );
      }
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const opRole = role as UserRole;
    const resolvedOrgRole = orgRole || mapOperationalRoleToDefaultOrgRole(opRole);

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        {
          error:
            'An account with this email already exists. Use Organization Settings → Invite Member so they can confirm joining your workspace.',
        },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);

    const [newUser] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        passwordHash,
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        role: 'ar_executive',
        teamLeadId: cleanedLeadId,
        emailVerifiedAt: new Date(),
        accountStatus: 'active',
      })
      .returning();

    await db.insert(organizationMembers).values({
      organizationId: ctx.organizationId,
      userId: newUser.id,
      orgRole: resolvedOrgRole,
      operationalRole: opRole,
      teamLeadId: cleanedLeadId,
      isActive: true,
      invitedBy: ctx.user.id,
    });

    await createAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      actorRole: ctx.orgRole,
      action: AUDIT_ACTIONS.USER_CREATED,
      entityType: 'user',
      entityId: newUser.id,
      newValue: { email: newUser.email, role: opRole, orgRole: resolvedOrgRole },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: opRole,
        orgRole: resolvedOrgRole,
        isActive: true,
      },
    });
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
