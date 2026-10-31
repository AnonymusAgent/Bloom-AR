import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanUuid, cleanDate, cleanPage, cleanLimit, parseEndOfDay } from '../src/lib/sanitize.ts';
import { parseEraFile } from '../src/lib/era-parser.ts';
import { isEmailConfigured, sendEmail } from '../src/lib/email.ts';
import { SIDEBAR_NAV_ITEMS, filterSidebarItems } from '../src/lib/sidebar-nav.ts';

const ROOT = process.cwd();

test('Payer Portals module is completely removed across UI, API, schema, migrations, and navigation', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'src/app/payer-portals')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/app/api/payer-portals')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'drizzle/0005_drop_payer_portals.sql')), true);

  const schemaSrc = fs.readFileSync(path.join(ROOT, 'src/db/schema.ts'), 'utf8');
  assert.equal(/payerPortals|portalInteractions|payer_portals|portal_interactions/.test(schemaSrc), false);

  const adminUser = { role: 'administrator', isPlatformAdmin: true };
  assert.equal(SIDEBAR_NAV_ITEMS.some((i) => i.href.includes('payer-portal')), false);
  const searchResults = filterSidebarItems(adminUser, 'payer portal');
  assert.equal(searchResults.some((i) => i.href.includes('payer-portal')), false);
});

test('sanitize helpers prevent PostgreSQL UUID, date, pagination, and midnight cutoff bugs', () => {
  assert.equal(cleanUuid(''), null);
  assert.equal(cleanUuid('   '), null);
  assert.equal(cleanUuid('unassigned'), null);
  assert.equal(cleanUuid('not-a-uuid'), null);
  assert.equal(
    cleanUuid('550e8400-e29b-41d4-a716-446655440000'),
    '550e8400-e29b-41d4-a716-446655440000'
  );

  assert.equal(cleanDate(''), null);
  assert.equal(cleanDate('invalid-date'), null);
  assert.equal(cleanDate('2026-10-31'), '2026-10-31');
  assert.equal(cleanDate('10/5/2026'), '2026-10-05');
  assert.equal(cleanDate('20261015'), '2026-10-15');

  assert.equal(cleanPage(null), 1);
  assert.equal(cleanPage('-5'), 1);
  assert.equal(cleanPage('abc'), 1);
  assert.equal(cleanPage('3'), 3);

  assert.equal(cleanLimit(null, 20, 100), 20);
  assert.equal(cleanLimit('9999', 20, 100), 100);
  assert.equal(cleanLimit('0', 20, 100), 20);

  const eod = parseEndOfDay('2026-10-31');
  assert.equal(eod.getUTCHours(), 23);
  assert.equal(eod.getUTCMinutes(), 59);
  assert.equal(eod.getUTCSeconds(), 59);
  assert.equal(eod.getUTCMilliseconds(), 999);
});

test('ERA 835 parser preserves CLP claim totals across multiple SVC lines and parses multi-triplet CAS + DTM D8', () => {
  const x12 = [
    'ISA*00*          *00*          *ZZ*PAYER          *ZZ*PROV           *261030*1200*^*00501*000000001*0*P*:~',
    'ST*835*0001~',
    'BPR*I*420.00*C*ACH*CCP*01*111000025*DA*123*1512345678**01*111000025*DA*987*20261030~',
    'TRN*1*CHK-9001*1512345678~',
    'N1*PR*AETNA~',
    'CLP*CLM-1001*1*600.00*420.00*60.00*12*CTRL1~',
    'NM1*QC*1*DOE*JANE~',
    'DTM*472*D8*20261015~',
    'SVC*HC:99214*400.00*280.00~',
    'CAS*CO*45*80.00**253*40.00~',
    'SVC*HC:93000*200.00*140.00~',
    'CAS*PR*1*60.00~',
    'LQ*HE*N130~',
    'SE*13*0001~',
  ].join('');

  const parsed = parseEraFile(x12, 'test.835');
  assert.equal(parsed.payerName, 'AETNA');
  assert.equal(parsed.checkNumber, 'CHK-9001');
  assert.equal(parsed.paymentDate, '2026-10-30');
  assert.equal(parsed.totalPayment, 420);
  assert.equal(parsed.transactions.length, 1);

  const tx = parsed.transactions[0];
  assert.equal(tx.claimNumber, 'CLM-1001');
  assert.equal(tx.patientName, 'DOE JANE');
  assert.equal(tx.dateOfService, '2026-10-15');
  assert.equal(tx.cptCode, '99214, 93000');
  assert.equal(tx.billedAmount, 600);
  assert.equal(tx.paidAmount, 420);
  assert.equal(tx.contractualAdjustment, 120);
  assert.equal(tx.patientResponsibility, 60);
  assert.equal(tx.carcCode, '45');
  assert.equal(tx.rarcCode, 'N130');

  const csv = 'Claim Number,Patient Name,DOS,CPT,Billed,Paid,Adjustment\nCLM-2,John Smith,10/18/2026,99213,250,200,50';
  const parsedCsv = parseEraFile(csv, 'remit.csv');
  assert.equal(parsedCsv.transactions[0].dateOfService, '2026-10-18');
  assert.equal(parsedCsv.totalPayment, 200);
});

test('email helper honestly reports unconfigured status when SMTP credentials are absent', async () => {
  const savedHost = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  try {
    assert.equal(isEmailConfigured(), false);
    const res = await sendEmail({ to: 'test@example.com', subject: 'Test', html: '<p>Test</p>' });
    assert.equal(res.configured, false);
    assert.equal(res.success, false);
  } finally {
    if (savedHost !== undefined) process.env.SMTP_HOST = savedHost;
  }
});

test('critical security, RBAC, download, and AppLayout invariants remain wired in source', () => {
  const authSrc = fs.readFileSync(path.join(ROOT, 'src/lib/auth.ts'), 'utf8');
  assert.ok(authSrc.includes('.setJti(randomUUID())'), 'JWT session tokens must include unique jti');
  assert.ok(authSrc.includes("user.accountStatus === 'suspended'"), 'verifySession must reject suspended users');

  const apiAuthSrc = fs.readFileSync(path.join(ROOT, 'src/lib/api-auth.ts'), 'utf8');
  assert.ok(apiAuthSrc.includes("user.accountStatus === 'suspended'"), 'getApiUser must reject suspended users');

  const inviteAcceptSrc = fs.readFileSync(path.join(ROOT, 'src/app/api/invitations/accept/route.ts'), 'utf8');
  assert.ok(inviteAcceptSrc.includes('verifyPassword'), 'Invitation accept must verify existing account ownership');

  const seedSrc = fs.readFileSync(path.join(ROOT, 'src/app/api/seed/route.ts'), 'utf8');
  assert.ok(seedSrc.includes('ALREADY_INITIALIZED'), 'Seed route must block unauthenticated re-seeding once users exist');

  assert.equal(fs.existsSync(path.join(ROOT, 'src/app/api/authorizations/[id]/documents/[docId]/route.ts')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/app/api/tasks/[id]/documents/[docId]/route.ts')), true);

  for (const uiPage of [
    'src/app/settings/account/page.tsx',
    'src/app/settings/organization/page.tsx',
    'src/app/settings/billing/page.tsx',
    'src/app/admin/platform/page.tsx',
  ]) {
    const content = fs.readFileSync(path.join(ROOT, uiPage), 'utf8');
    assert.ok(content.includes('<AppLayout'), `${uiPage} must render inside <AppLayout>`);
  }
});
