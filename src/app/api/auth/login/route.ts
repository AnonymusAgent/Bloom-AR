import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, userMfa, organizationMembers, organizations } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { verifyPassword, createSession } from '@/lib/auth';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { getSessionCookieOptions } from '@/lib/cookie-config';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { ensureSaaSColumns, schemaHint, safeErrorDetail } from '@/lib/db-schema';
import { decryptMfaSecret, verifyTotpCode, hashRecoveryCode } from '@/lib/mfa';
import { mapOrgRoleToOperationalRole } from '@/lib/tenant-context';

export async function POST(request: NextRequest) {
  try {
    const schema = await ensureSaaSColumns();
    if (!schema.ok) {
      return NextResponse.json(
        { error: schemaHint(schema.missingTables), code: 'SCHEMA_NOT_READY' },
        { status: 503 }
      );
    }
    if (schema.tenantBootstrap?.configured && !schema.tenantBootstrap.ok) {
      return NextResponse.json(
        {
          error: 'Workspace initialization encountered an error. Please retry in a moment.',
          detail: schema.tenantBootstrap.error,
          code: 'BOOTSTRAP_ERROR',
        },
        { status: 503 }
      );
    }

    const clientIp = getClientIp(request);
    const rateCheck = await checkRateLimit(clientIp, 'login');
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    const { email, password, mfaCode } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, String(email).toLowerCase().trim()))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    if (user.accountStatus === 'pending_verification') {
      return NextResponse.json(
        {
          error:
            'Please verify your email before signing in. Check your inbox or request a new verification link.',
          code: 'email_not_verified',
        },
        { status: 403 }
      );
    }
    if (user.accountStatus === 'suspended') {
      return NextResponse.json(
        { error: 'This account is suspended. Contact support.' },
        { status: 403 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: 'Your account has been deactivated' },
        { status: 401 }
      );
    }

    const rawPassword = String(password);
    let isValidPassword = await verifyPassword(rawPassword, user.passwordHash);
    if (!isValidPassword && rawPassword.trim() !== rawPassword) {
      isValidPassword = await verifyPassword(rawPassword.trim(), user.passwordHash);
    }
    if (!isValidPassword) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // MFA verification if enabled on this account
    let mfaVerifiedAt: Date | null = null;
    const [mfa] = await db
      .select()
      .from(userMfa)
      .where(eq(userMfa.userId, user.id))
      .limit(1);

    if (mfa?.isEnabled) {
      if (!mfaCode || !String(mfaCode).trim()) {
        return NextResponse.json(
          {
            requiresMfa: true,
            mfaRequired: true,
            message: 'Enter the 6-digit code from your authenticator app or a recovery code.',
          },
          { status: 200 }
        );
      }

      const secret = decryptMfaSecret(mfa.totpSecret);
      const totpOk = verifyTotpCode(secret, String(mfaCode));
      let recoveryOk = false;

      if (!totpOk) {
        const candidateHash = hashRecoveryCode(String(mfaCode));
        const storedHashes = Array.isArray(mfa.backupCodeHashes)
          ? (mfa.backupCodeHashes as string[])
          : [];
        if (storedHashes.includes(candidateHash)) {
          recoveryOk = true;
          const remaining = storedHashes.filter((h) => h !== candidateHash);
          await db
            .update(userMfa)
            .set({ backupCodeHashes: remaining, updatedAt: new Date() })
            .where(eq(userMfa.userId, user.id));
        }
      }

      if (!totpOk && !recoveryOk) {
        return NextResponse.json(
          {
            error: 'Invalid two-factor authentication code',
            requiresMfa: true,
            mfaRequired: true,
          },
          { status: 401 }
        );
      }
      mfaVerifiedAt = new Date();
    }

    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    const memberships = await db
      .select({ member: organizationMembers, org: organizations })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
      .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.isActive, true)));

    const activeMembership =
      memberships.find((m) => m.org.status === 'active') || memberships[0] || null;

    if (
      memberships.length > 0 &&
      memberships.every((m) => m.org.status === 'suspended')
    ) {
      return NextResponse.json(
        {
          error: 'Your organization workspace is currently suspended. Contact platform support.',
          code: 'ORGANIZATION_SUSPENDED',
        },
        { status: 403 }
      );
    }

    const ipAddr = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientIp;
    const ua = request.headers.get('user-agent') || undefined;

    const token = await createSession(user.id, {
      activeOrganizationId: activeMembership?.org.id || null,
      ipAddress: ipAddr,
      userAgent: ua || null,
      mfaVerifiedAt,
    });

    const effectiveRole = activeMembership
      ? mapOrgRoleToOperationalRole(
          activeMembership.member.orgRole,
          activeMembership.member.operationalRole
        )
      : user.role;

    await createAuditLog({
      organizationId: activeMembership?.org.id || null,
      userId: user.id,
      actorRole: activeMembership?.member.orgRole || user.role,
      action: AUDIT_ACTIONS.USER_LOGIN,
      entityType: 'user',
      entityId: user.id,
      ipAddress: ipAddr,
      userAgent: ua,
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: effectiveRole,
        orgRole: activeMembership?.member.orgRole || null,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      activeOrganization: activeMembership
        ? {
            id: activeMembership.org.id,
            name: activeMembership.org.name,
            slug: activeMembership.org.slug,
            orgRole: activeMembership.member.orgRole,
          }
        : null,
    });

    response.cookies.set('session', token, getSessionCookieOptions());

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      {
        error: 'An error occurred during login',
        detail: safeErrorDetail(error),
        hint: 'If this persists, check /api/health for database/schema status.',
      },
      { status: 500 }
    );
  }
}
