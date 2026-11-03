import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateTotpSecret,
  computeTotpCode,
  verifyTotpCode,
  encryptMfaSecret,
  decryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
} from '../src/lib/mfa.ts';
import {
  DRIZZLE_MIGRATIONS,
  makeStatementIdempotent,
  splitMigrationStatements,
} from '../src/db/migrations-sql.ts';

const ROOT = process.cwd();

test('zero hardcoded demo users, passwords, or synthetic test-claim UI remain in source', () => {
  const loginSrc = fs.readFileSync(path.join(ROOT, 'src/app/login/page.tsx'), 'utf8');
  assert.equal(/Seed Database|handleSeed|medicalbilling\.com/.test(loginSrc), false);
  assert.equal(loginSrc.includes('mfaRequired'), true, 'Login page must support 2-step MFA challenge');

  const claimsPageSrc = fs.readFileSync(path.join(ROOT, 'src/app/claims/page.tsx'), 'utf8');
  assert.equal(/Load 50 test claims|\/api\/claims\/test-data/.test(claimsPageSrc), false);

  const seedRouteSrc = fs.readFileSync(path.join(ROOT, 'src/app/api/seed/route.ts'), 'utf8');
  assert.equal(/SEED_USERS|medicalbilling\.com/.test(seedRouteSrc), false);

  const testDataRouteSrc = fs.readFileSync(
    path.join(ROOT, 'src/app/api/claims/test-data/route.ts'),
    'utf8'
  );
  assert.equal(testDataRouteSrc.includes('status: 410'), true);
});

test('all operational API routes enforce requireTenantContext and explicit organizationId scoping', () => {
  const operationalRoutes = [
    'src/app/api/dashboard/route.ts',
    'src/app/api/supervisor/dashboard/route.ts',
    'src/app/api/claims/route.ts',
    'src/app/api/claims/counts/route.ts',
    'src/app/api/claims/productivity/route.ts',
    'src/app/api/claims/bulk-assign/route.ts',
    'src/app/api/claims/[id]/route.ts',
    'src/app/api/claims/[id]/assign/route.ts',
    'src/app/api/claims/[id]/documents/route.ts',
    'src/app/api/claims/[id]/documents/[docId]/route.ts',
    'src/app/api/claims/[id]/notes/route.ts',
    'src/app/api/claims/[id]/review/route.ts',
    'src/app/api/claims/[id]/scrub/route.ts',
    'src/app/api/claims/[id]/submit/route.ts',
    'src/app/api/claims/[id]/workflow/route.ts',
    'src/app/api/upload/route.ts',
    'src/app/api/practices/route.ts',
    'src/app/api/practices/my/route.ts',
    'src/app/api/practices/[id]/assign/route.ts',
    'src/app/api/patients/route.ts',
    'src/app/api/users/route.ts',
    'src/app/api/users/[id]/route.ts',
    'src/app/api/payments/route.ts',
    'src/app/api/era/route.ts',
    'src/app/api/ai-analysis/route.ts',
    'src/app/api/tasks/route.ts',
    'src/app/api/tasks/[id]/route.ts',
    'src/app/api/tasks/[id]/notes/route.ts',
    'src/app/api/tasks/[id]/documents/route.ts',
    'src/app/api/tasks/[id]/documents/[docId]/route.ts',
    'src/app/api/signoffs/route.ts',
    'src/app/api/authorizations/route.ts',
    'src/app/api/authorizations/[id]/route.ts',
    'src/app/api/authorizations/[id]/documents/route.ts',
    'src/app/api/authorizations/[id]/documents/[docId]/route.ts',
    'src/app/api/coding/route.ts',
    'src/app/api/coding/[id]/route.ts',
    'src/app/api/chat/channels/route.ts',
    'src/app/api/chat/channels/[id]/messages/route.ts',
    'src/app/api/chat/files/[id]/route.ts',
    'src/app/api/chat/stream/[channelId]/route.ts',
    'src/app/api/ocr/route.ts',
    'src/app/api/signatures/route.ts',
    'src/app/api/productivity/route.ts',
    'src/app/api/reports/route.ts',
    'src/app/api/export/route.ts',
    'src/app/api/audit-logs/route.ts',
    'src/app/api/notifications/route.ts',
    'src/app/api/notifications/mark-read/route.ts',
    'src/app/api/denial-codes/route.ts',
    'src/app/api/email/digest/route.ts',
  ];

  for (const relPath of operationalRoutes) {
    const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    assert.ok(
      src.includes('requireTenantContext') || src.includes('resolveTenantContext'),
      `${relPath} must guard access via requireTenantContext or resolveTenantContext`
    );
    assert.ok(
      /\.organizationId|\borganizationId\b[^=]*=\s*(?:\w+\.)?ctx/.test(src),
      `${relPath} must scope queries by ctx.organizationId`
    );
  }
});

test('RFC 6238 TOTP MFA encryption, code verification, and recovery codes work end-to-end', () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-jwt-secret-32-chars-minimum!!';
  const secret = generateTotpSecret();
  assert.ok(secret.length >= 24);

  const encrypted = encryptMfaSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptMfaSecret(encrypted), secret);

  const nowMs = 1_762_100_000_000;
  const validCode = computeTotpCode(secret, nowMs);
  assert.match(validCode, /^\d{6}$/);
  assert.equal(verifyTotpCode(secret, validCode, 1, nowMs), true);
  assert.equal(verifyTotpCode(secret, '000000', 1, nowMs) && validCode !== '000000', false);

  const { plain, hashes } = generateRecoveryCodes(8);
  assert.equal(plain.length, 8);
  assert.equal(hashes.length, 8);

  const targetHash = hashRecoveryCode(plain[2]);
  assert.equal(hashes.includes(targetHash), true);
  const remainingHashes = hashes.filter((h) => h !== targetHash);
  assert.equal(remainingHashes.length, 7);
  assert.equal(remainingHashes.includes(hashRecoveryCode(plain[2])), false);
});

test('PostgreSQL Row-Level Security (RLS) blocks cross-organization reads and writes at the DB kernel layer', async (t) => {
  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    t.skip('@electric-sql/pglite not installed in this environment');
    return;
  }

  const pg = new PGlite();
  try {
    for (const mig of DRIZZLE_MIGRATIONS) {
      const cleaned = mig.sql.replace(
        /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+"pgcrypto"\s*;/gi,
        ''
      );
      const stmts = cleaned
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of stmts) {
        await pg.exec(stmt);
      }
    }

    // Create a non-superuser role without BYPASSRLS so PostgreSQL enforces RLS policies
    await pg.exec(`
      CREATE ROLE app_tenant_user LOGIN NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO app_tenant_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant_user;
    `);

    const orgA = '11111111-1111-4111-8111-111111111111';
    const orgB = '22222222-2222-4222-8222-222222222222';

    await pg.exec(`
      INSERT INTO organizations (id, name, slug, status) VALUES
        ('${orgA}', 'Org A Cardiology', 'org-a-cardiology', 'active'),
        ('${orgB}', 'Org B Orthopedics', 'org-b-orthopedics', 'active');

      INSERT INTO practices (id, organization_id, name, code) VALUES
        ('aaaa1111-1111-4111-8111-111111111111', '${orgA}', 'Org A Clinic', 'CLN-01'),
        ('bbbb2222-2222-4222-8222-222222222222', '${orgB}', 'Org B Clinic', 'CLN-01');

      INSERT INTO claims (id, organization_id, claim_number, patient_name, date_of_service, billed_amount, balance, status) VALUES
        ('aaaa3333-3333-4333-8333-333333333333', '${orgA}', 'CLM-SHARED-001', 'Alice OrgA', '2026-10-01', 1200.00, 1200.00, 'new'),
        ('bbbb4444-4444-4444-8444-444444444444', '${orgB}', 'CLM-SHARED-001', 'Bob OrgB', '2026-10-01', 3400.00, 3400.00, 'denied');
    `);

    // Notice both Org A and Org B used practice code 'CLN-01' and claim number 'CLM-SHARED-001' cleanly
    // thanks to per-organization composite unique indexes!

    // Now switch to app_tenant_user with app.enforce_rls = 'on' and app.current_org_id = Org A
    const orgAResult = await pg.exec(`
      BEGIN;
      SET LOCAL ROLE app_tenant_user;
      SET LOCAL app.enforce_rls = 'on';
      SET LOCAL app.current_org_id = '${orgA}';
      SELECT id, organization_id, patient_name FROM claims;
      COMMIT;
    `);
    const orgARows = orgAResult.find((r) => Array.isArray(r.rows) && r.fields?.length === 3)?.rows || [];
    assert.equal(orgARows.length, 1);
    assert.equal(orgARows[0].organization_id, orgA);
    assert.equal(orgARows[0].patient_name, 'Alice OrgA');

    // Verify Org B sees ONLY Org B rows even with SELECT * FROM claims (no WHERE clause!)
    const orgBResult = await pg.exec(`
      BEGIN;
      SET LOCAL ROLE app_tenant_user;
      SET LOCAL app.enforce_rls = 'on';
      SET LOCAL app.current_org_id = '${orgB}';
      SELECT id, organization_id, patient_name FROM claims;
      COMMIT;
    `);
    const orgBRows = orgBResult.find((r) => Array.isArray(r.rows) && r.fields?.length === 3)?.rows || [];
    assert.equal(orgBRows.length, 1);
    assert.equal(orgBRows[0].organization_id, orgB);
    assert.equal(orgBRows[0].patient_name, 'Bob OrgB');

    // Verify cross-tenant INSERT into Org B while bound to Org A is rejected by RLS WITH CHECK
    await assert.rejects(
      async () => {
        await pg.exec(`
          BEGIN;
          SET LOCAL ROLE app_tenant_user;
          SET LOCAL app.enforce_rls = 'on';
          SET LOCAL app.current_org_id = '${orgA}';
          INSERT INTO claims (organization_id, claim_number, patient_name, date_of_service, billed_amount, balance, status)
          VALUES ('${orgB}', 'FORGED-999', 'Injected Patient', '2026-10-05', 500.00, 500.00, 'new');
          COMMIT;
        `);
      },
      /row-level security policy/i
    );
  } finally {
    await pg.close();
  }
});

test('Migration 0006 upgrades site_settings.updated_by FK to ON DELETE SET NULL for legacy purge safety', async (t) => {
  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    t.skip('@electric-sql/pglite not installed in environment');
    return;
  }

  const pg = new PGlite();
  try {
    // 1. Apply migrations 0000..0005 first (legacy production state before 0006)
    for (const migration of DRIZZLE_MIGRATIONS.slice(0, 6)) {
      const stmts = splitMigrationStatements(migration.sql).map(makeStatementIdempotent);
      for (const s of stmts) {
        if (/CREATE\s+EXTENSION/i.test(s)) continue;
        await pg.exec(s);
      }
    }

    await pg.exec(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, is_platform_admin)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'legacy-editor@example.invalid', 'hash', 'Legacy', 'Editor', 'administrator', true, false),
        ('22222222-2222-4222-8222-222222222222', 'platform-owner@example.invalid', 'hash', 'Platform', 'Owner', 'administrator', true, true);

      INSERT INTO site_settings (key, value, updated_by)
      VALUES ('cms_landing', '{"headline":"Welcome"}'::jsonb, '11111111-1111-4111-8111-111111111111');
    `);

    // 2. Apply migration 0006
    const mig0006 = DRIZZLE_MIGRATIONS[6];
    for (const s of splitMigrationStatements(mig0006.sql).map(makeStatementIdempotent)) {
      await pg.exec(s);
    }

    // 3. Deleting non-platform-admin users now succeeds cleanly and nulls site_settings.updated_by
    await pg.exec(`DELETE FROM users WHERE is_platform_admin = false;`);

    const remainingUsers = await pg.query(`SELECT email, is_platform_admin FROM users`);
    assert.equal(remainingUsers.rows.length, 1);
    assert.equal(remainingUsers.rows[0].email, 'platform-owner@example.invalid');

    const cmsRow = await pg.query(`SELECT key, updated_by FROM site_settings WHERE key = 'cms_landing'`);
    assert.equal(cmsRow.rows.length, 1);
    assert.equal(cmsRow.rows[0].updated_by, null);
  } finally {
    await pg.close();
  }
});

