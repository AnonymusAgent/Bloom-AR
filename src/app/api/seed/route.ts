import { NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth';
import { sql } from 'drizzle-orm';
import { ensureSaaSColumns, schemaHint, safeErrorDetail } from '@/lib/db-schema';
import { ensureDefaultPlans } from '@/lib/saas';
import { ensureStandardDenialCodes } from '@/lib/standard-denial-codes';

/**
 * Reference-catalog initialization endpoint.
 * All hardcoded demo users and passwords have been permanently removed.
 * Initializes only global standard X12 CARC/RARC denial codes and SaaS plan tiers.
 */
export async function POST() {
  try {
    const schema = await ensureSaaSColumns();
    if (schema.missingTables.includes('users') || schema.missingTables.includes('denial_codes')) {
      return NextResponse.json(
        {
          error: 'Failed to initialize reference catalog',
          code: 'SCHEMA_NOT_READY',
          detail: schemaHint(schema.missingTables),
        },
        { status: 503 }
      );
    }

    const [{ totalUsers }] = await db
      .select({ totalUsers: sql<number>`count(*)::int` })
      .from(users);
    if (totalUsers > 0) {
      const caller = await getCurrentUser();
      if (!caller || caller.role !== 'administrator') {
        return NextResponse.json(
          {
            error: 'Database is already initialized. Sign in as an administrator to manage reference catalogs.',
            code: 'ALREADY_INITIALIZED',
          },
          { status: 403 }
        );
      }
    }

    const plansList = await ensureDefaultPlans();
    const { inserted, skipped } = await ensureStandardDenialCodes();

    return NextResponse.json({
      success: true,
      message: 'Standard CARC/RARC denial codes and subscription plans verified (demo user seeding disabled).',
      plansCount: plansList.length,
      denialCodesInserted: inserted,
      denialCodesSkipped: skipped,
    });
  } catch (error) {
    console.error('Catalog seed error:', error);
    return NextResponse.json(
      { error: 'Failed to initialize catalog', detail: safeErrorDetail(error) },
      { status: 500 }
    );
  }
}
