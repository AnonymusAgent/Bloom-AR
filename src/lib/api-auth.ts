import { NextRequest } from 'next/server';
import { db } from '@/db';
import { apiKeys, users, organizations, organizationMembers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

export async function authenticateApiKey(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const key = authHeader.substring(7).trim();
  if (!key) return null;
  const prefix = key.substring(0, 8);

  const candidates = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, prefix), eq(apiKeys.isActive, true)));

  for (const candidate of candidates) {
    if (candidate.expiresAt && candidate.expiresAt < new Date()) continue;
    if (!candidate.organizationId) continue;

    const match = await bcrypt.compare(key, candidate.keyHash);
    if (match) {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, candidate.organizationId))
        .limit(1);
      if (!org || org.status === 'suspended') continue;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, candidate.createdBy))
        .limit(1);
      if (!user || !user.isActive || user.accountStatus === 'suspended') continue;

      const [member] = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, org.id),
            eq(organizationMembers.userId, user.id),
            eq(organizationMembers.isActive, true)
          )
        )
        .limit(1);
      if (!member) continue;

      await db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, candidate.id))
        .catch(() => {});

      return { apiKey: candidate, user, organization: org, member };
    }
  }

  return null;
}
