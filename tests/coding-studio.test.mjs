import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatICD10Code,
  getICD10Chapters,
  getICD10Detail,
  getICD10ReleaseMetadata,
  getICD10SectionCategories,
  normalizeICD10,
  searchICD10,
} from '../src/lib/coding/icd10-service.ts';
import {
  getModifierInfo,
  getProcedureInfo,
  parseProcedureTokens,
  searchProceduresAndModifiers,
} from '../src/lib/coding/cpt-hcpcs-reference.ts';
import { analyzeClaimCoding } from '../src/lib/coding/coding-checker.ts';
import { filterSidebarItems } from '../src/lib/sidebar-nav.ts';

test('Official FY2027 CDC/NCHS ICD-10-CM dataset & tabular hierarchy load offline with zero missing chapters', () => {
  const meta = getICD10ReleaseMetadata();
  assert.equal(meta.fiscalYear, 2027);
  assert.equal(meta.effectiveDate, '2026-10-01');
  assert.ok(meta.billableCodeCount >= 74000);
  assert.ok(meta.headerCodeCount >= 20000);
  assert.equal(meta.chapterCount, 22);
  assert.ok(meta.sectionCount >= 290);

  assert.equal(normalizeICD10(' e11.65 '), 'E1165');
  assert.equal(formatICD10Code('E1165'), 'E11.65');
  assert.equal(formatICD10Code('I10'), 'I10');

  const chapters = getICD10Chapters();
  assert.equal(chapters.length, 22);
  const cats = getICD10SectionCategories('E08-E13');
  assert.ok(cats.some((c) => c.code === 'E11'));
});

test('ICD-10-CM dossier distinguishes non-billable headers, 7th-character stems, and billable FY2027 leaf codes', () => {
  const header = getICD10Detail('M54.5');
  assert.equal(header.exists, true);
  assert.equal(header.billable, false);
  assert.equal(header.description, 'Low back pain');
  assert.ok(header.billableDescendants.some((c) => c.code === 'M54.50'));
  assert.ok(header.billableDescendants.some((c) => c.code === 'M54.51'));

  const leaf = getICD10Detail('M54.50');
  assert.equal(leaf.exists, true);
  assert.equal(leaf.billable, true);
  assert.ok(leaf.ancestors.some((a) => a.code === 'M54'));
  assert.ok(leaf.ancestors.some((a) => a.code === 'M54.5'));

  const fractureStem = getICD10Detail('S72.001');
  assert.equal(fractureStem.exists, true);
  assert.equal(fractureStem.billable, false);
  assert.equal(fractureStem.clinicalAttributes.requires7thChar, true);
  assert.ok('A' in fractureStem.notes.sevenChrDef);
  assert.ok('D' in fractureStem.notes.sevenChrDef);
  assert.ok('S' in fractureStem.notes.sevenChrDef);
  assert.ok(fractureStem.billableDescendants.some((d) => d.code === 'S72.001A'));

  const searchHits = searchICD10('type 2 diabetes hyperglycemia', { billableOnly: true, limit: 10 });
  assert.ok(searchHits.some((h) => h.code === 'E11.65' && h.billable === true));
});

test('CPT / HCPCS & Modifiers reference parses tokens and searches procedures & modifiers accurately', () => {
  const parsed = parseProcedureTokens('99214-25, 20610-RT, J3301-JZ');
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].baseCode, '99214');
  assert.deepEqual(parsed[0].modifiers, ['25']);
  assert.equal(parsed[1].baseCode, '20610');
  assert.deepEqual(parsed[1].modifiers, ['RT']);
  assert.equal(parsed[2].codeSystem, 'HCPCS');

  assert.equal(getModifierInfo('-25')?.code, '25');
  assert.equal(getProcedureInfo('20610')?.requiresLaterality, true);

  const search = searchProceduresAndModifiers('arthrocentesis', 'cpt');
  assert.ok(search.procedures.some((p) => p.code === '20610'));
});

test('Automated Coding Error Checker catches non-billable headers, Excludes1 conflicts, NCCI bundles, missing -25, and laterality mismatches', () => {
  const badAudit = analyzeClaimCoding({
    diagnosisCodes: 'M54.5, E10.9, E11.65, M17.11',
    cptCodes: '99214, 20610-LT, 80053, 80048',
    denialReason: 'CO-4 Missing modifier',
  });

  assert.equal(badAudit.canSubmitClean, false);
  const ruleIds = new Set(badAudit.issues.map((i) => i.ruleId));
  assert.ok(ruleIds.has('ICD-003'), 'Expected ICD-003 non-billable header error on M54.5');
  assert.ok(ruleIds.has('ICD-005'), 'Expected ICD-005 Excludes1 conflict on E10.9 + E11.65');
  assert.ok(ruleIds.has('NCCI-001'), 'Expected NCCI-001 E/M + procedure missing modifier -25');
  assert.ok(ruleIds.has('NCCI-002'), 'Expected NCCI-002 PTP hard bundle on 80053 + 80048');
  assert.ok(ruleIds.has('LAT-001'), 'Expected LAT-001 laterality conflict (-LT vs right knee M17.11)');
  assert.ok(ruleIds.has('DEN-001'), 'Expected DEN-001 CO-4 remediation guidance');

  const cleanAudit = analyzeClaimCoding({
    diagnosisCodes: 'M17.11, E11.65, Z79.4',
    cptCodes: '99214-25, 20610-RT, J3301-JZ',
  });
  assert.equal(cleanAudit.canSubmitClean, true);
  assert.equal(cleanAudit.counts.errors, 0);
  assert.equal(cleanAudit.score, 100);
});

test('Sidebar search surfaces built-in ICD-10-CM Lookup and Coding Error Checker for all clinical/billing roles', () => {
  const billingUser = {
    id: 'u1',
    email: 'coder@example.com',
    firstName: 'Alex',
    lastName: 'Coder',
    role: 'billing_user',
  };
  const icdHits = filterSidebarItems(billingUser, 'icd10data');
  assert.ok(icdHits.some((i) => i.href === '/coding?tab=reference'));

  const ncciHits = filterSidebarItems(billingUser, 'excludes1');
  assert.ok(ncciHits.some((i) => i.href === '/coding?tab=checker'));
});
