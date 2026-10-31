import { Pool, type PoolClient } from 'pg';
import { db, pool as runtimePool } from '@/db';
import { sql } from 'drizzle-orm';
import { buildPgPoolConfig, resolveDirectDatabaseUrl } from '@/db/pg-config';
import {
  DRIZZLE_MIGRATIONS,
  makeStatementIdempotent,
  splitMigrationStatements,
} from '@/db/migrations-sql';

const CORE_TABLES = [
  'users',
  'organizations',
  'claims',
  'denial_codes',
  'era_files',
  'plans',
  'site_settings',
] as const;

/**
 * Self-healing additive schema guard + empty-DB auto-bootstrap.
 *
 * - If the connected database already has all core tables, runs the lightweight
 *   additive statements to guarantee migrations 0003/0004 columns exist.
 * - If core tables are missing (e.g. a brand-new Neon database connected in Vercel),
 *   automatically runs the full idempotent Drizzle migration suite (0000–0004)
 *   using a serialized PostgreSQL advisory lock so zero local CLI step is required.
 */
const STATEMENTS = [
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_platform_admin" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "account_status" varchar(20) NOT NULL DEFAULT 'active'`,
  `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "org_type" varchar(50)`,
  `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "country" varchar(100)`,
  `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "timezone" varchar(100)`,
  `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "owner_user_id" uuid`,
  `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'active'`,
  `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "onboarding_step" integer NOT NULL DEFAULT 0`,
  `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "onboarding_complete" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "organization_id" uuid`,
  `ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "organization_id" uuid`,
  `ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "organization_id" uuid`,
  `CREATE TABLE IF NOT EXISTS "site_settings" ("key" varchar(100) PRIMARY KEY, "value" jsonb NOT NULL, "updated_by" uuid, "updated_at" timestamp NOT NULL DEFAULT now())`,
  `DROP TABLE IF EXISTS "portal_interactions" CASCADE`,
  `DROP TABLE IF EXISTS "payer_portals" CASCADE`,
];

export interface SchemaStatus {
  ok: boolean;
  missingTables: string[];
  bootstrapped?: boolean;
}

async function queryMissingCoreTables(): Promise<string[]> {
  const rows = await db.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','organizations','claims','denial_codes','era_files','plans','site_settings')`
  );
  const present = new Set((rows.rows as { table_name: string }[]).map((r) => r.table_name));
  return CORE_TABLES.filter((t) => !present.has(t));
}

async function applyMigrationsWithClient(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS drizzle;
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
    DELETE FROM drizzle.__drizzle_migrations
    WHERE id NOT IN (
      SELECT min(id) FROM drizzle.__drizzle_migrations GROUP BY hash
    );
    CREATE UNIQUE INDEX IF NOT EXISTS drizzle_migrations_hash_idx ON drizzle.__drizzle_migrations (hash);
  `);

  for (const migration of DRIZZLE_MIGRATIONS) {
    const idempotentStatements = splitMigrationStatements(migration.sql).map(makeStatementIdempotent);
    if (idempotentStatements.length === 0) continue;

    // Fast path: execute entire migration file in a single round trip
    try {
      await client.query(idempotentStatements.join('\n'));
    } catch {
      // Fallback: statement-by-statement isolation so one notice/warning cannot block others
      for (const stmt of idempotentStatements) {
        try {
          await client.query(stmt);
        } catch (err) {
          console.warn(`[auto-migrate:${migration.hash}]`, safeErrorDetail(err));
        }
      }
    }

    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2) ON CONFLICT (hash) DO NOTHING`,
      [migration.hash, Date.now()]
    );
  }
}

async function bootstrapFullSchema(): Promise<void> {
  const directUrl = resolveDirectDatabaseUrl();
  let dedicatedPool: Pool | null = null;
  let client: PoolClient | null = null;
  let locked = false;

  try {
    if (directUrl) {
      try {
        dedicatedPool = new Pool(buildPgPoolConfig(directUrl, { direct: true, max: 1 }));
        client = await dedicatedPool.connect();
      } catch {
        if (dedicatedPool) {
          await dedicatedPool.end().catch(() => {});
          dedicatedPool = null;
        }
      }
    }

    if (!client) {
      client = await runtimePool.connect();
    }

    // Use session advisory lock on direct connections to prevent cold-start DDL races
    if (dedicatedPool) {
      try {
        await client.query('SELECT pg_advisory_lock(82437001)');
        locked = true;
      } catch {
        locked = false;
      }
    }

    await applyMigrationsWithClient(client);
  } finally {
    if (client) {
      if (locked) {
        await client.query('SELECT pg_advisory_unlock(82437001)').catch(() => {});
      }
      client.release();
    }
    if (dedicatedPool) {
      await dedicatedPool.end().catch(() => {});
    }
  }
}

let cached: Promise<SchemaStatus> | null = null;

export function ensureSaaSColumns(): Promise<SchemaStatus> {
  if (!cached) {
    cached = (async (): Promise<SchemaStatus> => {
      let missingTables: string[];
      try {
        missingTables = await queryMissingCoreTables();
      } catch {
        return { ok: false, missingTables: ['<database unreachable>'] };
      }

      let bootstrapped = false;
      if (missingTables.length > 0) {
        try {
          await bootstrapFullSchema();
          missingTables = await queryMissingCoreTables();
          bootstrapped = missingTables.length === 0;
        } catch (err) {
          console.error('Automatic schema bootstrap failed:', safeErrorDetail(err));
          try {
            missingTables = await queryMissingCoreTables();
          } catch {
            return { ok: false, missingTables: ['<database unreachable>'] };
          }
        }
      }

      if (missingTables.includes('users')) {
        return { ok: false, missingTables, bootstrapped: false };
      }

      for (const stmt of STATEMENTS) {
        try {
          await db.execute(sql.raw(stmt));
        } catch {
          /* table missing (reported above) or already up to date */
        }
      }

      return { ok: missingTables.length === 0, missingTables, bootstrapped };
    })();

    // Don't cache failures forever — allow retry after the operator updates env vars / DB.
    cached.then((r) => {
      if (!r.ok) {
        setTimeout(() => {
          cached = null;
        }, 15_000);
      }
    });
  }
  return cached;
}

export function schemaHint(missing: string[]) {
  return `Database schema is not ready (missing: ${missing.join(', ')}). Check /api/health or run "npm run db:migrate" with DATABASE_URL set — see docs/SAAS_SETUP.md.`;
}

/** Never leak connection strings or internals in an error shown to a client. */
export function safeErrorDetail(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.replace(/postgres(ql)?:\/\/\S+/gi, '[database-url]').slice(0, 300);
}
