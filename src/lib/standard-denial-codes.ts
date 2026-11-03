import { db } from '@/db';
import { denialCodes } from '@/db/schema';
import { isNull, sql } from 'drizzle-orm';
import { ALL_DENIAL_CODES } from '@/lib/denial-codes-data';

export async function ensureStandardDenialCodes(): Promise<{ inserted: number; skipped: number }> {
  try {
    await db.execute(
      sql`SELECT setval(pg_get_serial_sequence('denial_codes', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM denial_codes), 0), 1), (SELECT COUNT(*) > 0 FROM denial_codes))`
    );
  } catch {
    // Sequence sync is best-effort
  }

  const existingGlobal = await db
    .select({ id: denialCodes.id, code: denialCodes.code })
    .from(denialCodes)
    .where(isNull(denialCodes.organizationId));

  const seen = new Set(existingGlobal.map((r) => r.code));
  const batch: Array<{
    organizationId: null;
    code: string;
    codeType: string;
    description: string;
    category: string | null;
    isActive: boolean;
  }> = [];

  let skipped = 0;
  for (const item of ALL_DENIAL_CODES) {
    if (seen.has(item.code)) {
      skipped++;
      continue;
    }
    seen.add(item.code);
    batch.push({
      organizationId: null,
      code: item.code,
      codeType: item.codeType,
      description: item.description,
      category: item.category || null,
      isActive: true,
    });
  }

  if (batch.length > 0) {
    await db.insert(denialCodes).values(batch).onConflictDoNothing();
  }

  return { inserted: batch.length, skipped };
}
