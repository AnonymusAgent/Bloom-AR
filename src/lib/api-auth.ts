import { NextRequest } from 'next/server';
import { db } from '@/db';
import { apiKeys, users, organizationMembers } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

export async function authenticateApiKey(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const key = authHeader.substring(7);
  const prefix = key.substring(0, 8);

  // Find potential matching keys by prefix
  const candidates = await db.select().from(apiKeys).where(
    and(eq(apiKeys.keyPrefix, prefix), eq(apiKeys.isActive, true))
  );

  for (const candidate of candidates) {
    // Check expiration
    if (candidate.expiresAt && candidate.expiresAt < new Date()) continue;

    const match = await bcrypt.compare(key, candidate.keyHash);
    if (match) {
      // Update last used
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, candidate.id));

      // Get the user who created this key
      const [user] = await db.select().from(users).where(eq(users.id, candidate.createdBy)).limit(1);
      if (!user || !user.isActive || user.accountStatus === 'suspended') continue;
      return { apiKey: candidate, user };
    }
  }

  return null;
}
