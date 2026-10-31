import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { apiKeys, organizationMembers } from '@/db/schema';
import { eq, desc, and, inArray, or } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { cleanUuid } from '@/lib/sanitize';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'administrator') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const memberships = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user.id));
    const orgIds = memberships.map((m) => m.organizationId);

    const scopeCond =
      orgIds.length > 0
        ? or(eq(apiKeys.createdBy, user.id), inArray(apiKeys.organizationId, orgIds))
        : eq(apiKeys.createdBy, user.id);

    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        permissions: apiKeys.permissions,
        organizationId: apiKeys.organizationId,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        isActive: apiKeys.isActive,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(scopeCond)
      .orderBy(desc(apiKeys.createdAt));

    return NextResponse.json({ apiKeys: keys });
  } catch (error) {
    console.error('Get API keys error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'administrator') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { name, permissions, expiresInDays, organizationId } = await request.json();
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

    const memberships = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user.id));
    const orgIds = memberships.map((m) => m.organizationId);

    const requestedOrgId = cleanUuid(organizationId);
    const resolvedOrgId =
      requestedOrgId && orgIds.includes(requestedOrgId)
        ? requestedOrgId
        : orgIds[0] || null;

    const rawKey = `armgr_${randomUUID().replace(/-/g, '')}`;
    const keyPrefix = rawKey.substring(0, 8);
    const keyHash = await bcrypt.hash(rawKey, 10);

    const expiresAt = expiresInDays ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000) : null;

    const [apiKey] = await db
      .insert(apiKeys)
      .values({
        name: String(name).trim(),
        keyHash,
        keyPrefix,
        permissions: permissions || ['read'],
        organizationId: resolvedOrgId,
        createdBy: user.id,
        expiresAt,
      })
      .returning();

    await createAuditLog({
      userId: user.id,
      action: 'api_key_created',
      entityType: 'apiKey',
      entityId: apiKey.id,
      newValue: { name, keyPrefix, organizationId: resolvedOrgId },
    });

    return NextResponse.json({
      apiKey: { id: apiKey.id, name: apiKey.name, key: rawKey, keyPrefix, expiresAt },
      warning: 'Save this key now. It cannot be retrieved again.',
    });
  } catch (error) {
    console.error('Create API key error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'administrator') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({} as Record<string, string>));
    const keyId = cleanUuid(request.nextUrl.searchParams.get('id') || body.id);
    if (!keyId) return NextResponse.json({ error: 'Valid API key ID required' }, { status: 400 });

    const [existing] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.createdBy, user.id)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'API key not found' }, { status: 404 });

    await db.update(apiKeys).set({ isActive: false }).where(eq(apiKeys.id, keyId));
    await createAuditLog({
      userId: user.id,
      action: 'api_key_revoked',
      entityType: 'apiKey',
      entityId: keyId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Revoke API key error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
