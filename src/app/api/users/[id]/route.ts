import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, organizationMembers, sessions } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { hashPassword, canManageUsers, type UserRole } from '@/lib/auth';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { cleanUuid } from '@/lib/sanitize';
import {
  requireTenantContext,
  mapOrgRoleToOperationalRole,
  mapOperationalRoleToDefaultOrgRole,
} from '@/lib/tenant-context';
import { verifyUserInOrg } from '@/lib/rbac';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const { id } = await params;

    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
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
      .where(
        and(
          eq(organizationMembers.organizationId, ctx.organizationId),
          eq(organizationMembers.userId, id)
        )
      )
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: row.id,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        role: mapOrgRoleToOperationalRole(row.orgRole, row.operationalRole),
        orgRole: row.orgRole,
        isActive: row.memberIsActive && row.userIsActive,
        teamLeadId: row.teamLeadId,
        createdAt: row.createdAt,
        lastLoginAt: row.lastLoginAt,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    if (!canManageUsers(ctx.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const [memberRow] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, ctx.organizationId),
          eq(organizationMembers.userId, id)
        )
      )
      .limit(1);

    if (!memberRow) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (
      id === ctx.user.id &&
      (body.isActive === false || (body.role && body.role !== 'administrator'))
    ) {
      return NextResponse.json(
        { error: 'You cannot deactivate or demote your own administrator account.' },
        { status: 400 }
      );
    }

    if (body.teamLeadId !== undefined) {
      const cleanedLead = cleanUuid(body.teamLeadId);
      if (cleanedLead) {
        const okLead = await verifyUserInOrg(cleanedLead, ctx.organizationId);
        if (!okLead) {
          return NextResponse.json(
            { error: 'Selected team lead does not belong to your organization' },
            { status: 400 }
          );
        }
      }
    }

    // Check how many organizations this user belongs to so global profile fields
    // are only mutated when exclusively owned by this workspace
    const allMemberships = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, id));

    const userUpdateData: Partial<typeof users.$inferInsert> = {};
    if (allMemberships.length <= 1) {
      if (body.firstName) userUpdateData.firstName = body.firstName;
      if (body.lastName) userUpdateData.lastName = body.lastName;
      if (body.password) {
        userUpdateData.passwordHash = await hashPassword(body.password);
      }
      if (Object.keys(userUpdateData).length > 0) {
        userUpdateData.updatedAt = new Date();
        await db.update(users).set(userUpdateData).where(eq(users.id, id));
      }
    }

    const memberUpdate: Partial<typeof organizationMembers.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.role) {
      const opRole = body.role as UserRole;
      memberUpdate.operationalRole = opRole;
      if (memberRow.orgRole !== 'owner') {
        memberUpdate.orgRole = body.orgRole || mapOperationalRoleToDefaultOrgRole(opRole);
      }
    }
    if (body.orgRole && memberRow.orgRole !== 'owner') {
      memberUpdate.orgRole = body.orgRole;
    }
    if (body.teamLeadId !== undefined) {
      memberUpdate.teamLeadId = cleanUuid(body.teamLeadId);
    }
    if (body.isActive !== undefined) {
      memberUpdate.isActive = Boolean(body.isActive);
    }

    const [updatedMember] = await db
      .update(organizationMembers)
      .set(memberUpdate)
      .where(eq(organizationMembers.id, memberRow.id))
      .returning();

    if (body.isActive === false) {
      await db
        .update(sessions)
        .set({ activeOrganizationId: null })
        .where(
          and(
            eq(sessions.userId, id),
            eq(sessions.activeOrganizationId, ctx.organizationId)
          )
        );
    }

    const [refreshedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    const effectiveRole = mapOrgRoleToOperationalRole(
      updatedMember.orgRole,
      updatedMember.operationalRole
    );

    await createAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      actorRole: ctx.orgRole,
      action:
        body.isActive === false
          ? AUDIT_ACTIONS.USER_DEACTIVATED
          : AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'user',
      entityId: id,
      previousValue: {
        role: memberRow.operationalRole,
        orgRole: memberRow.orgRole,
        isActive: memberRow.isActive,
      },
      newValue: {
        role: effectiveRole,
        orgRole: updatedMember.orgRole,
        isActive: updatedMember.isActive,
      },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      user: {
        id: refreshedUser.id,
        email: refreshedUser.email,
        firstName: refreshedUser.firstName,
        lastName: refreshedUser.lastName,
        role: effectiveRole,
        orgRole: updatedMember.orgRole,
        isActive: updatedMember.isActive && refreshedUser.isActive,
      },
    });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
