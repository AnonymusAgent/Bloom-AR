import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {
  buildPgPoolConfig,
  normalizeDatabaseUrl,
  resolveDirectDatabaseUrl,
  resolveRuntimeDatabaseUrl,
} from '../src/db/pg-config.ts';
import {
  DRIZZLE_MIGRATIONS,
  makeStatementIdempotent,
  splitMigrationStatements,
} from '../src/db/migrations-sql.ts';

// 1. Embedded DRIZZLE_MIGRATIONS must stay byte-for-byte synced with drizzle/*.sql
const drizzleDir = path.join(process.cwd(), 'drizzle');
const diskFiles = fs.readdirSync(drizzleDir).filter((f) => f.endsWith('.sql')).sort();
assert.equal(DRIZZLE_MIGRATIONS.length, diskFiles.length, 'embedded migration count matches drizzle/*.sql');
for (let i = 0; i < diskFiles.length; i++) {
  const hash = path.basename(diskFiles[i], '.sql');
  const sql = fs.readFileSync(path.join(drizzleDir, diskFiles[i]), 'utf8');
  assert.equal(DRIZZLE_MIGRATIONS[i].hash, hash, `migration hash matches ${hash}`);
  assert.equal(DRIZZLE_MIGRATIONS[i].sql, sql, `migration SQL matches ${diskFiles[i]}`);
}

// 2. Idempotent SQL transformation checks across all migrations
let totalStatements = 0;
for (const m of DRIZZLE_MIGRATIONS) {
  const stmts = splitMigrationStatements(m.sql).map(makeStatementIdempotent);
  assert.ok(stmts.length > 0, `${m.hash} yields non-empty statements`);
  totalStatements += stmts.length;
  for (const s of stmts) {
    assert.ok(s.endsWith(';'), `statement ends with semicolon in ${m.hash}`);
    assert.ok(!/^CREATE\s+TYPE\s+/i.test(s), `CREATE TYPE wrapped in DO block in ${m.hash}`);
    assert.ok(!/^CREATE\s+TABLE\s+"/i.test(s), `CREATE TABLE uses IF NOT EXISTS in ${m.hash}`);
  }
}
assert.ok(totalStatements >= 160, `expected >= 160 migration statements, got ${totalStatements}`);

// 3. Env priority: DATABASE_URL_POOLED / DATABASE_URL override stale NEON_DATABASE_URL
const sampleEnv = {
  DATABASE_URL: 'postgresql://u:p@ep-new.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  DATABASE_URL_POOLED: 'postgresql://u:p@ep-new-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  NEON_DATABASE_URL: 'postgresql://u:p@ep-stale-old.us-east-1.aws.neon.tech/neondb?sslmode=require',
};
assert.equal(resolveRuntimeDatabaseUrl(sampleEnv), sampleEnv.DATABASE_URL_POOLED, 'runtime prefers DATABASE_URL_POOLED');
assert.equal(
  resolveRuntimeDatabaseUrl({ DATABASE_URL: sampleEnv.DATABASE_URL, NEON_DATABASE_URL: sampleEnv.NEON_DATABASE_URL }),
  sampleEnv.DATABASE_URL,
  'DATABASE_URL overrides stale NEON_DATABASE_URL'
);
assert.equal(resolveDirectDatabaseUrl(sampleEnv), sampleEnv.DATABASE_URL, 'direct prefers unpooled DATABASE_URL');

// 4. URL normalization handles copy-paste traps & direct hostname conversion safely
const messy = `DATABASE_URL="postgresql://u:[my-pooler-pass@ep-demo-pooler.c-1.us-east-1.aws.neon.tech](mailto:my-pooler-pass@ep-demo-pooler.c-1.us-east-1.aws.neon.tech)/neondb?sslmode=require&amp;channel_binding=require"`;
const cleanedDirect = normalizeDatabaseUrl(messy, { direct: true });
const parsedDirect = new URL(cleanedDirect);
assert.equal(parsedDirect.hostname, 'ep-demo.c-1.us-east-1.aws.neon.tech', 'strips -pooler from hostname');
assert.equal(parsedDirect.password, 'my-pooler-pass', 'does not alter password containing -pooler');
assert.equal(parsedDirect.searchParams.get('channel_binding'), 'require', 'decodes &amp;channel_binding=require');
assert.equal(parsedDirect.searchParams.get('uselibpqcompat'), 'true', 'sets uselibpqcompat=true for sslmode=require');

// 5. pg Client configuration enables SCRAM-SHA-256-PLUS channel binding without SSL warnings
let emittedSslWarning = false;
const onWarning = (w) => {
  if (String(w?.message || w).includes('SSL modes')) emittedSslWarning = true;
};
process.on('warning', onWarning);
const poolCfg = buildPgPoolConfig(sampleEnv.DATABASE_URL_POOLED);
const client = new pg.Client(poolCfg);
process.off('warning', onWarning);

assert.equal(client.enableChannelBinding, true, 'enables channel binding for channel_binding=require');
assert.equal(client.connectionParameters.ssl?.rejectUnauthorized, false, 'uses libpq sslmode=require TLS config');
assert.equal(emittedSslWarning, false, 'does not emit pg-connection-string SSL deprecation warning');

console.log(`db-migrations: all checks passed (${DRIZZLE_MIGRATIONS.length} migrations, ${totalStatements} idempotent statements, Neon TLS + channel_binding verified)`);
