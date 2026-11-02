import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  organizationInvitations,
  organizations,
  organizationMembers,
  sessions,
  users,
} from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { requireMembership } from '@/lib/tenant';
import { getEntitlements, makeToken, hashToken, appUrl } from '@/lib/saas';
import { sendInviteEmail } from '@/lib/auth-emails';
import { mapOrgRoleToOperationalRole, VALID_ORG_ROLES } from '@/lib/tenant-context';
import { createAuditLog } from '@/lib/audit';
import { cleanUuid } from '@/lib/sanitize';

export async function GET(_r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await requireMembership(user.id, id, ['owner', 'admin', 'billing_manager', 'manager']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const members = await db
    .select({
      id: organizationMembers.id,
      userId: organizationMembers.userId,
      orgRole: organizationMembers.orgRole,
      operationalRole: organizationMembers.operationalRole,
      isActive: organizationMembers.isActive,
      createdAt: organizationMembers.createdAt,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(organizationMembers)
    .leftJoin(users, eq(organizationMembers.userId, users.id))
    .where(and(eq(organizationMembers.organizationId, id), eq(organizationMembers.isActive, true)));

  const invites = await db
    .select()
    .from(organizationInvitations)
    .where(eq(organizationInvitations.organizationId, id));

  return NextResponse.json({ members, invitations: invites });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const m = await requireMembership(user.id, id, ['owner', 'admin', 'billing_manager', 'manager']);
  if (!m) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { email, orgRole } = await req.json();
  const role = (VALID_ORG_ROLES as readonly string[]).includes(orgRole) ? orgRole : 'ar_specialist';
  if (role === 'owner' && m.orgRole !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can invite another owner' }, { status: 403 });
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  const ent = await getEntitlements(id);
  if (ent && !ent.canAddSeat) {
    return NextResponse.json(
      {
        error: `Seat limit reached for your plan (${ent.usage.seatsLimit}). Upgrade to invite more members.`,
        code: 'SEAT_LIMIT_REACHED',
      },
      { status: 402 }
    );
  }

  const operationalRole = mapOrgRoleToOperationalRole(role);
  const token = makeToken();
  await db.insert(organizationInvitations).values({
    organizationId: id,
    email: String(email).toLowerCase().trim(),
    orgRole: role,
    operationalRole,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 7 * 864e5),
    invitedBy: user.id,
  });

  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  const sent = await sendInviteEmail(
    String(email).toLowerCase().trim(),
    org?.name || 'your organization',
    token
  );
  const emailDelivery = !sent.configured
    ? 'not_configured'
    : sent.success
    ? 'accepted_by_provider'
    : 'failed';

  await createAuditLog({
    organizationId: id,
    userId: user.id,
    actorRole: m.orgRole,
    action: 'member_invited',
    entityType: 'organization_invitation',
    newValue: { email: String(email).toLowerCase().trim(), orgRole: role },
  });

  return NextResponse.json(
    {
      success: true,
      emailDelivery,
      ...(emailDelivery !== 'accepted_by_provider'
        ? { inviteUrl: `${appUrl()}/accept-invite?token=${token}` }
        : {}),
    },
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const actor = await requireMembership(user.id, id, ['owner', 'admin']);
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const memberId = cleanUuid(body.memberId);
  const newRole = String(body.orgRole || '');
  if (!memberId || !(VALID_ORG_ROLES as readonly string[]).includes(newRole)) {
    return NextResponse.json({ error: 'Valid memberId and orgRole required' }, { status: 400 });
  }
  if (newRole === 'owner' && actor.orgRole !== 'owner') {
    return NextResponse.json({ error: 'Only an owner can grant owner role' }, { status: 403 });
  }

  const [target] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.id, memberId), eq(organizationMembers.organizationId, id)))
    .limit(1);
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

  if (target.orgRole === 'owner' && newRole !== 'owner') {
    const [{ ownerCount }] = await db
      .select({ ownerCount: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, id),
          eq(organizationMembers.orgRole, 'owner'),
          eq(organizationMembers.isActive, true)
        )
      );
    if (ownerCount <= 1) {
      return NextResponse.json(
        { error: 'Cannot demote the last active owner of the organization' },
        { status: 400 }
      );
    }
  }

  const operationalRole = mapOrgRoleToOperationalRole(newRole);
  await db
    .update(organizationMembers)
    .set({ orgRole: newRole, operationalRole, updatedAt: new Date() })
    .where(eq(organizationMembers.id, memberId));

  await createAuditLog({
    organizationId: id,
    userId: user.id,
    actorRole: actor.orgRole,
    action: 'member_role_updated',
    entityType: 'organization_member',
    entityId: memberId,
    previousValue: { orgRole: target.orgRole },
    newValue: { orgRole: newRole },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const actor = await requireMembership(user.id, id, ['owner', 'admin']);
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const memberId = cleanUuid(req.nextUrl.searchParams.get('memberId') || body.memberId);
  const invitationId = cleanUuid(req.nextUrl.searchParams.get('invitationId') || body.invitationId);

  if (invitationId) {
    await db
      .update(organizationInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(organizationInvitations.id, invitationId),
          eq(organizationInvitations.organizationId, id)
        )
      );
    return NextResponse.json({ success: true });
  }

  if (!memberId) return NextResponse.json({ error: 'memberId or invitationId required' }, { status: 400 });

  const [target] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.id, memberId), eq(organizationMembers.organizationId, id)))
    .limit(1);
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

  if (target.orgRole === 'owner') {
    const [{ ownerCount }] = await db
      .select({ ownerCount: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, id),
          eq(organizationMembers.orgRole, 'owner'),
          eq(organizationMembers.isActive, true)
        )
      );
    if (ownerCount <= 1) {
      return NextResponse.json({ error: 'Cannot remove the last owner of the organization' }, { status: 400 });
    }
  }

  await db
    .update(organizationMembers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(organizationMembers.id, memberId));

  // Immediately detach any live sessions of the removed user from this organization
  await db
    .update(sessions)
    .set({ activeOrganizationId: null })
    .where(and(eq(sessions.userId, target.userId), eq(sessions.activeOrganizationId, id)));

  await createAuditLog({
    organizationId: id,
    userId: user.id,
    actorRole: actor.orgRole,
    action: 'member_removed',
    entityType: 'organization_member',
    entityId: memberId,
    previousValue: { userId: target.userId, orgRole: target.orgRole },
  });

  return NextResponse.json({ success: true });
}
