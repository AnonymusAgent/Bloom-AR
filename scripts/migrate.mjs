import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

function normalizeUrl(raw, { direct = false } = {}) {
  let s = raw.trim();
  s = s.replace(/^(?:DATABASE_URL_POOLED|NEON_DATABASE_URL|DATABASE_URL)\s*=\s*/i, '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\[([^\]]+)\]\(mailto:[^)]+\)/gi, '$1').replace(/&amp;/gi, '&');
  try {
    const parsed = new URL(s);
    if (direct && parsed.hostname.includes('-pooler.')) {
      parsed.hostname = parsed.hostname.replace('-pooler.', '.');
    }
    const sslmode = parsed.searchParams.get('sslmode');
    if (
      (sslmode === 'require' || sslmode === 'prefer') &&
      !parsed.searchParams.has('uselibpqcompat') &&
      !parsed.searchParams.has('sslrootcert')
    ) {
      parsed.searchParams.set('uselibpqcompat', 'true');
    }
    return parsed.toString();
  } catch {
    return direct ? s.replace(/-pooler\./g, '.') : s;
  }
}

function buildPoolConfig(rawUrl, { direct = false } = {}) {
  const connectionString = normalizeUrl(rawUrl, { direct });
  let sslMode = null;
  let channelBinding = null;
  let isNeon = false;
  try {
    const u = new URL(connectionString);
    sslMode = u.searchParams.get('sslmode');
    channelBinding = u.searchParams.get('channel_binding');
    isNeon = u.hostname.endsWith('.neon.tech');
  } catch {
    if (connectionString.includes('sslmode=require')) sslMode = 'require';
    if (connectionString.includes('channel_binding=require')) channelBinding = 'require';
    isNeon = connectionString.includes('.neon.tech');
  }
  const needsSsl = sslMode !== 'disable' && (Boolean(sslMode) || isNeon);
  return {
    connectionString,
    connectionTimeoutMillis: 15_000,
    ...(needsSsl && sslMode !== 'verify-full' && sslMode !== 'verify-ca'
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
    ...(needsSsl && (channelBinding === 'require' || channelBinding === 'prefer')
      ? { enableChannelBinding: true }
      : {}),
  };
}

function splitStatements(sql) {
  if (sql.includes('--> statement-breakpoint')) {
    return sql
      .split('--> statement-breakpoint')
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean);
  }
  return sql
    .replace(/^\s*--.*$/gm, '')
    .trim()
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function makeIdempotent(rawStmt) {
  let s = rawStmt.trim().replace(/;+$/, '').trim();
  if (/^CREATE\s+TYPE\s+/i.test(s)) {
    return `DO $$ BEGIN ${s}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
  }
  if (/^CREATE\s+TABLE\s+"/i.test(s)) {
    return s.replace(/^CREATE\s+TABLE\s+"/i, 'CREATE TABLE IF NOT EXISTS "') + ';';
  }
  if (/ADD\s+COLUMN\s+"/i.test(s)) {
    return s.replace(/ADD\s+COLUMN\s+"/gi, 'ADD COLUMN IF NOT EXISTS "') + ';';
  }
  if (/ADD\s+CONSTRAINT\s+/i.test(s)) {
    return `DO $$ BEGIN ${s}; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;`;
  }
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i.test(s)) {
    return s.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, 'CREATE $1INDEX IF NOT EXISTS ') + ';';
  }
  return s + ';';
}

const rawUrl =
  process.env.DATABASE_URL ||
  process.env.DATABASE_URL_POOLED ||
  process.env.NEON_DATABASE_URL;

if (!rawUrl) {
  console.error('DATABASE_URL, DATABASE_URL_POOLED, or NEON_DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool(buildPoolConfig(rawUrl, { direct: true }));

const CORE_TABLES = [
  'users',
  'organizations',
  'claims',
  'denial_codes',
  'era_files',
  'plans',
  'site_settings',
];

async function main() {
  const client = await pool.connect();
  try {
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

    const existingTablesRes = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
      [CORE_TABLES]
    );
    const allCorePresent = existingTablesRes.rows.length === CORE_TABLES.length;

    const existingRes = await client.query(`SELECT hash FROM drizzle.__drizzle_migrations`);
    const appliedHashes = new Set(existingRes.rows.map((r) => r.hash));

    const drizzleDir = path.join(process.cwd(), 'drizzle');
    const files = fs
      .readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const hash = path.basename(file, '.sql');
      // Only skip a recorded migration when all core tables actually exist
      if (appliedHashes.has(hash) && allCorePresent) {
        console.log(`Migration already applied: ${file}`);
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      const sql = fs.readFileSync(path.join(drizzleDir, file), 'utf8');
      const statements = splitStatements(sql).map(makeIdempotent);

      for (let i = 0; i < statements.length; i++) {
        try {
          await client.query(statements[i]);
        } catch (err) {
          console.warn(`[${file}] statement ${i + 1} notice:`, err.message);
        }
      }

      await client.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2) ON CONFLICT (hash) DO NOTHING;`,
        [hash, Date.now()]
      );
      console.log(`Successfully applied ${file}`);
    }

    const verifyRes = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
      [CORE_TABLES]
    );
    const verified = new Set(verifyRes.rows.map((r) => r.table_name));
    const missing = CORE_TABLES.filter((t) => !verified.has(t));
    if (missing.length > 0) {
      throw new Error(`Schema verification failed — missing core tables: ${missing.join(', ')}`);
    }

    console.log('\nAll migrations completed and verified!');
  } catch (error) {
    console.error('Migration failed:', String(error?.message || error).replace(/postgres(ql)?:\/\/\S+/gi, '[database-url]'));
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
