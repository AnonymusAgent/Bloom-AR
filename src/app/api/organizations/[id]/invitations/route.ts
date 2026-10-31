import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { organizationInvitations, organizations, organizationMembers, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { requireMembership } from '@/lib/tenant';
import { getEntitlements, makeToken, hashToken, appUrl } from '@/lib/saas';
import { sendInviteEmail } from '@/lib/auth-emails';

export async function GET(_r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await requireMembership(user.id, id, ['owner', 'admin', 'super_admin']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const members = await db
    .select({
      id: organizationMembers.id,
      userId: organizationMembers.userId,
      orgRole: organizationMembers.orgRole,
      createdAt: organizationMembers.createdAt,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(organizationMembers)
    .leftJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, id));
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
  const m = await requireMembership(user.id, id, ['owner', 'admin', 'super_admin']);
  if (!m) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { email, orgRole } = await req.json();
  const role = ['owner', 'admin', 'manager', 'member', 'read_only'].includes(orgRole) ? orgRole : 'member';
  if (role === 'owner' && m.orgRole !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can invite another owner' }, { status: 403 });
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }
  const ent = await getEntitlements(id);
  const members = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, id));
  if (ent?.limits?.seats && members.length >= ent.limits.seats) {
    return NextResponse.json(
      { error: `Seat limit reached for your plan (${ent.limits.seats}). Upgrade to invite more members.` },
      { status: 402 }
    );
  }
  const token = makeToken();
  await db.insert(organizationInvitations).values({
    organizationId: id,
    email: String(email).toLowerCase(),
    orgRole: role,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 7 * 864e5),
    invitedBy: user.id,
  });
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  const sent = await sendInviteEmail(String(email).toLowerCase(), org?.name || 'your organization', token);
  const emailDelivery = !sent.configured ? 'not_configured' : sent.success ? 'accepted_by_provider' : 'failed';
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
