import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/tenant-context';
import { createAuditLog } from '@/lib/audit';
import { cleanUuid } from '@/lib/sanitize';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

export async function GET() {
  try {
    const auth = await requireTenantContext({
      requiredOrgRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

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
      .where(eq(apiKeys.organizationId, ctx.organizationId))
      .orderBy(desc(apiKeys.createdAt));

    return NextResponse.json({ apiKeys: keys });
  } catch (error) {
    console.error('Get API keys error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantContext({
      allowMutation: true,
      requiredOrgRoles: ['owner', 'admin'],
      requiredPlanSlug: ['professional', 'enterprise'],
    });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const { name, permissions, expiresInDays } = await request.json();
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

    const rawKey = `armgr_${randomUUID().replace(/-/g, '')}`;
    const keyPrefix = rawKey.substring(0, 8);
    const keyHash = await bcrypt.hash(rawKey, 10);

    const expiresAt = expiresInDays
      ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000)
      : null;

    const [apiKey] = await db
      .insert(apiKeys)
      .values({
        name: String(name).trim(),
        keyHash,
        keyPrefix,
        permissions: permissions || ['read'],
        organizationId: ctx.organizationId,
        createdBy: ctx.user.id,
        expiresAt,
      })
      .returning();

    await createAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      actorRole: ctx.orgRole,
      action: 'api_key_created',
      entityType: 'apiKey',
      entityId: apiKey.id,
      newValue: { name, keyPrefix, organizationId: ctx.organizationId },
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
    const auth = await requireTenantContext({
      allowMutation: true,
      requiredOrgRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const body = await request.json().catch(() => ({} as Record<string, string>));
    const keyId = cleanUuid(request.nextUrl.searchParams.get('id') || body.id);
    if (!keyId) return NextResponse.json({ error: 'Valid API key ID required' }, { status: 400 });

    const [deleted] = await db
      .update(apiKeys)
      .set({ isActive: false })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.organizationId, ctx.organizationId)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'API key not found in your organization' }, { status: 404 });
    }

    await createAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      actorRole: ctx.orgRole,
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
