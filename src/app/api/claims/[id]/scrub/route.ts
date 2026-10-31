import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { getUserAuthorizedPracticeIds, canViewUser } from '@/lib/rbac';
import { cleanUuid } from '@/lib/sanitize';
import { analyzeClaimCoding } from '@/lib/coding/coding-checker';

interface ScrubResult {
  ruleId: string;
  ruleName: string;
  category: string;
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

function scrubClaim(claim: Record<string, unknown>): { totalRules: number; results: ScrubResult[] } {
  const results: ScrubResult[] = [];
  const add = (
    id: string,
    name: string,
    cat: string,
    sev: 'error' | 'warning',
    field: string,
    msg: string
  ) => {
    results.push({ ruleId: id, ruleName: name, category: cat, severity: sev, field, message: msg });
  };

  // === PATIENT RULES ===
  if (!claim.patientName)
    add('PAT-001', 'Missing Patient Name', 'Patient', 'error', 'patientName', 'Patient name is required for claim submission');
  if (!claim.patientId && !claim.patientName)
    add('PAT-002', 'No Patient Record', 'Patient', 'warning', 'patientId', 'Claim is not linked to a patient record. Consider creating a patient record.');

  // === INSURANCE RULES ===
  if (!claim.insurance && !claim.payer)
    add('INS-001', 'Missing Insurance/Payer', 'Insurance', 'error', 'insurance', 'Insurance or payer information is required');

  // === CLAIM RULES ===
  if (!claim.dateOfService)
    add('CLM-001', 'Missing Date of Service', 'Claim', 'error', 'dateOfService', 'Date of service is required');
  if (claim.dateOfService) {
    const dos = new Date(String(claim.dateOfService));
    const now = new Date();
    if (dos > now)
      add('CLM-002', 'Future Date of Service', 'Claim', 'error', 'dateOfService', 'Date of service cannot be in the future');
    const oneYear = new Date();
    oneYear.setFullYear(oneYear.getFullYear() - 1);
    if (dos < oneYear)
      add('CLM-003', 'Old Date of Service', 'Claim', 'warning', 'dateOfService', 'Date of service is more than 1 year ago. Check timely filing requirements.');
  }
  if (!claim.provider)
    add('CLM-004', 'Missing Provider', 'Claim', 'warning', 'provider', 'Provider/rendering provider information is missing');
  if (!claim.claimNumber)
    add('CLM-005', 'Missing Claim Number', 'Claim', 'error', 'claimNumber', 'Claim number/identifier is required');

  // === FINANCIAL & CHARGE RULES ===
  if (!claim.billedAmount || parseFloat(String(claim.billedAmount)) <= 0)
    add('COD-002', 'Invalid Charge Amount', 'Coding', 'error', 'billedAmount', 'Billed amount must be greater than zero');
  if (claim.billedAmount && parseFloat(String(claim.billedAmount)) > 100000)
    add('COD-003', 'Unusually High Charge', 'Coding', 'warning', 'billedAmount', 'Billed amount is unusually high. Please verify.');

  if (
    claim.paidAmount &&
    claim.billedAmount &&
    parseFloat(String(claim.paidAmount)) > parseFloat(String(claim.billedAmount))
  ) {
    add('CON-001', 'Overpayment Detected', 'Consistency', 'warning', 'paidAmount', 'Paid amount exceeds billed amount');
  }

  // === INTEGRATED FY2027 ICD-10-CM / CPT / NCCI / LATERALITY SCRUBBER ===
  const codingAudit = analyzeClaimCoding({
    diagnosisCodes: claim.diagnosisCode as string | null,
    cptCodes: claim.cptCodes as string | null,
    denialReason: claim.denialReason as string | null,
    billedAmount: claim.billedAmount as string | null,
    dateOfService: claim.dateOfService as string | null,
  });

  for (const iss of codingAudit.issues) {
    if (iss.severity === 'error' || iss.severity === 'warning') {
      add(
        iss.ruleId,
        iss.title,
        iss.category,
        iss.severity,
        iss.ruleId.startsWith('ICD') ? 'diagnosisCode' : 'cptCodes',
        iss.message
      );
    }
  }

  const totalRules = Math.max(18, 11 + codingAudit.issues.length);
  return { totalRules, results };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id: rawId } = await params;
    const id = cleanUuid(rawId);
    if (!id) return NextResponse.json({ error: 'Invalid claim ID' }, { status: 400 });

    const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    if (!isSupervisorOrAbove(user.role)) {
      const authPractices = await getUserAuthorizedPracticeIds(user);
      const allowedByPractice =
        authPractices === 'all' ||
        (claim.practiceId ? authPractices.includes(claim.practiceId) : false);
      const allowedByAssignee = claim.assignedTo ? await canViewUser(user, claim.assignedTo) : false;
      if (!allowedByPractice && !allowedByAssignee) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    const { totalRules, results } = scrubClaim(claim as Record<string, unknown>);
    const errors = results.filter((r) => r.severity === 'error');
    const warnings = results.filter((r) => r.severity === 'warning');
    const passed = Math.max(0, totalRules - results.length);

    return NextResponse.json({
      claimId: id,
      claimNumber: claim.claimNumber,
      totalRules,
      passed,
      errors: errors.length,
      warnings: warnings.length,
      canSubmit: errors.length === 0,
      results,
    });
  } catch (error) {
    console.error('Scrub error:', error);
    return NextResponse.json({ error: 'Failed to scrub claim' }, { status: 500 });
  }
}
