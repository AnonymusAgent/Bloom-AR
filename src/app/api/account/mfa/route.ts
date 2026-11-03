import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { userMfa, sessions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentSessionWithUser, verifyPassword } from '@/lib/auth';
import {
  generateTotpSecret,
  encryptMfaSecret,
  decryptMfaSecret,
  verifyTotpCode,
  generateRecoveryCodes,
  buildOtpAuthUri,
  formatSetupKey,
  generateMfaQrDataUrl,
} from '@/lib/mfa';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';

export async function GET() {
  const details = await getCurrentSessionWithUser();
  if (!details) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [mfa] = await db
    .select()
    .from(userMfa)
    .where(eq(userMfa.userId, details.user.id))
    .limit(1);

  const hashes = Array.isArray(mfa?.backupCodeHashes)
    ? (mfa.backupCodeHashes as string[])
    : [];

  return NextResponse.json({
    enabled: Boolean(mfa?.isEnabled),
    enabledAt: mfa?.enabledAt || null,
    remainingRecoveryCodes: hashes.length,
  });
}

export async function POST(req: NextRequest) {
  const details = await getCurrentSessionWithUser();
  if (!details) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { user, session } = details;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');

  if (action === 'setup') {
    const issuer = 'BloomAR Manager';
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret);
    const otpauthUri = buildOtpAuthUri(user.email, secret, issuer);
    const qrCodeDataUrl = await generateMfaQrDataUrl(otpauthUri);

    const [existing] = await db
      .select()
      .from(userMfa)
      .where(eq(userMfa.userId, user.id))
      .limit(1);

    if (existing?.isEnabled) {
      return NextResponse.json(
        { error: 'MFA is already enabled. Disable it first before enrolling a new device.' },
        { status: 400 }
      );
    }

    if (existing) {
      await db
        .update(userMfa)
        .set({ totpSecret: encrypted, isEnabled: false, updatedAt: new Date() })
        .where(eq(userMfa.userId, user.id));
    } else {
      await db.insert(userMfa).values({
        userId: user.id,
        totpSecret: encrypted,
        backupCodeHashes: [],
        isEnabled: false,
      });
    }

    return NextResponse.json({
      secret,
      formattedSecret: formatSetupKey(secret),
      issuer,
      accountName: user.email,
      otpauthUri,
      qrCodeDataUrl,
    });
  }

  if (action === 'regenerate_recovery_codes') {
    const password = String(body.password || '');
    if (!password) {
      return NextResponse.json(
        { error: 'Current account password is required to regenerate recovery codes.' },
        { status: 400 }
      );
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
    }
    const [mfa] = await db.select().from(userMfa).where(eq(userMfa.userId, user.id)).limit(1);
    if (!mfa?.isEnabled) {
      return NextResponse.json(
        { error: 'MFA must be enabled before regenerating recovery codes.' },
        { status: 400 }
      );
    }

    const recovery = generateRecoveryCodes(8);
    await db
      .update(userMfa)
      .set({
        backupCodeHashes: recovery.hashes,
        updatedAt: new Date(),
      })
      .where(eq(userMfa.userId, user.id));

    await createAuditLog({
      organizationId: session.activeOrganizationId || null,
      userId: user.id,
      action: AUDIT_ACTIONS.MFA_ENABLED,
      entityType: 'user_mfa',
      entityId: user.id,
      newValue: { event: 'recovery_codes_regenerated' },
    });

    return NextResponse.json({
      success: true,
      recoveryCodes: recovery.plain,
    });
  }

  if (action === 'enable' || action === 'verify') {
    const code = String(body.code || '').trim();
    const [mfa] = await db.select().from(userMfa).where(eq(userMfa.userId, user.id)).limit(1);
    if (!mfa) {
      return NextResponse.json(
        { error: 'Start MFA setup first before verifying a code.' },
        { status: 400 }
      );
    }

    const secret = decryptMfaSecret(mfa.totpSecret);
    if (!verifyTotpCode(secret, code)) {
      return NextResponse.json(
        { error: 'Invalid 6-digit authenticator code.' },
        { status: 400 }
      );
    }

    const recovery = generateRecoveryCodes(8);
    const now = new Date();

    await db
      .update(userMfa)
      .set({
        isEnabled: true,
        enabledAt: now,
        backupCodeHashes: recovery.hashes,
        updatedAt: now,
      })
      .where(eq(userMfa.userId, user.id));

    await db
      .update(sessions)
      .set({ mfaVerifiedAt: now })
      .where(eq(sessions.id, session.id));

    await createAuditLog({
      organizationId: session.activeOrganizationId || null,
      userId: user.id,
      action: AUDIT_ACTIONS.MFA_ENABLED,
      entityType: 'user_mfa',
      entityId: user.id,
    });

    return NextResponse.json({
      success: true,
      enabled: true,
      recoveryCodes: recovery.plain,
    });
  }

  if (action === 'disable') {
    const password = String(body.password || '');
    if (!password) {
      return NextResponse.json(
        { error: 'Current account password is required to disable MFA.' },
        { status: 400 }
      );
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
    }

    await db.delete(userMfa).where(eq(userMfa.userId, user.id));

    await createAuditLog({
      organizationId: session.activeOrganizationId || null,
      userId: user.id,
      action: AUDIT_ACTIONS.MFA_DISABLED,
      entityType: 'user_mfa',
      entityId: user.id,
    });

    return NextResponse.json({ success: true, enabled: false });
  }

  return NextResponse.json({ error: 'Invalid MFA action' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const details = await getCurrentSessionWithUser();
  if (!details) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { user, session } = details;
  const body = await req.json().catch(() => ({}));
  const password = String(body.password || '');
  if (!password) {
    return NextResponse.json(
      { error: 'Current account password is required to disable MFA.' },
      { status: 400 }
    );
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
  }

  await db.delete(userMfa).where(eq(userMfa.userId, user.id));

  await createAuditLog({
    organizationId: session.activeOrganizationId || undefined,
    userId: user.id,
    action: AUDIT_ACTIONS.MFA_DISABLED,
    entityType: 'user_mfa',
    entityId: user.id,
  });

  return NextResponse.json({ success: true, enabled: false });
}
