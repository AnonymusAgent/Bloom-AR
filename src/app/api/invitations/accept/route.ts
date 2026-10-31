import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { organizationInvitations, organizationMembers, users } from '@/db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { hashToken } from '@/lib/saas';
import { hashPassword, verifyPassword, createSession, getCurrentUser } from '@/lib/auth';
import { getSessionCookieOptions } from '@/lib/cookie-config';

export async function POST(req: NextRequest) {
  try {
    const { token, firstName, lastName, password, existingPassword } = await req.json();
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });

    const [inv] = await db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.tokenHash, hashToken(String(token))),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.revokedAt),
          gt(organizationInvitations.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!inv) {
      return NextResponse.json({ error: 'This invitation is invalid, expired, or already accepted.' }, { status: 400 });
    }

    let [user] = await db.select().from(users).where(eq(users.email, inv.email)).limit(1);
    if (!user) {
      if (!firstName || !password || String(password).length < 10) {
        return NextResponse.json(
          { error: 'Create your account: first name and a 10+ character password are required', needsAccount: true },
          { status: 400 }
        );
      }
      [user] = await db
        .insert(users)
        .values({
          email: inv.email,
          passwordHash: await hashPassword(String(password)),
          firstName: String(firstName).trim(),
          lastName: String(lastName || '').trim(),
          emailVerifiedAt: new Date(),
          accountStatus: 'active',
        })
        .returning();
    } else {
      if (!user.isActive || user.accountStatus === 'suspended') {
        return NextResponse.json({ error: 'This account is inactive or suspended.' }, { status: 403 });
      }
      // Prevent account takeover: existing users must either already be signed in as that account
      // or prove ownership by entering their current password.
      const currentUser = await getCurrentUser();
      if (!currentUser || currentUser.id !== user.id) {
        const candidatePw = String(existingPassword || password || '');
        if (!candidatePw) {
          return NextResponse.json(
            {
              error: 'An account with this email already exists. Enter your existing account password to accept this invitation.',
              existingAccount: true,
            },
            { status: 400 }
          );
        }
        const ok = await verifyPassword(candidatePw, user.passwordHash);
        if (!ok) {
          return NextResponse.json({ error: 'Incorrect password for existing account.' }, { status: 401 });
        }
      }
      if (!user.emailVerifiedAt || user.accountStatus === 'pending_verification') {
        await db
          .update(users)
          .set({ emailVerifiedAt: user.emailVerifiedAt || new Date(), accountStatus: 'active' })
          .where(eq(users.id, user.id));
      }
    }

    const [exists] = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, inv.organizationId), eq(organizationMembers.userId, user.id)))
      .limit(1);
    if (!exists) {
      await db.insert(organizationMembers).values({
        organizationId: inv.organizationId,
        userId: user.id,
        orgRole: inv.orgRole,
      });
    }

    await db
      .update(organizationInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(organizationInvitations.id, inv.id));

    const session = await createSession(user.id);
    const res = NextResponse.json({ success: true });
    res.cookies.set('session', session, getSessionCookieOptions());
    return res;
  } catch (error) {
    console.error('Accept invitation error:', error);
    return NextResponse.json({ error: 'Failed to accept invitation' }, { status: 500 });
  }
}
