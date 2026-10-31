import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { getUserAuthorizedPracticeIds, canViewUser } from '@/lib/rbac';

interface ScrubResult { ruleId: string; ruleName: string; category: string; severity: 'error' | 'warning'; field: string; message: string; }

function scrubClaim(claim: Record<string, unknown>): ScrubResult[] {
  const results: ScrubResult[] = [];
  const add = (id: string, name: string, cat: string, sev: 'error' | 'warning', field: string, msg: string) => {
    results.push({ ruleId: id, ruleName: name, category: cat, severity: sev, field, message: msg });
  };

  // === PATIENT RULES ===
  if (!claim.patientName) add('PAT-001', 'Missing Patient Name', 'Patient', 'error', 'patientName', 'Patient name is required for claim submission');
  if (!claim.patientId && !claim.patientName) add('PAT-002', 'No Patient Record', 'Patient', 'warning', 'patientId', 'Claim is not linked to a patient record. Consider creating a patient record.');

  // === INSURANCE RULES ===
  if (!claim.insurance && !claim.payer) add('INS-001', 'Missing Insurance/Payer', 'Insurance', 'error', 'insurance', 'Insurance or payer information is required');

  // === CLAIM RULES ===
  if (!claim.dateOfService) add('CLM-001', 'Missing Date of Service', 'Claim', 'error', 'dateOfService', 'Date of service is required');
  if (claim.dateOfService) {
    const dos = new Date(String(claim.dateOfService));
    const now = new Date();
    if (dos > now) add('CLM-002', 'Future Date of Service', 'Claim', 'error', 'dateOfService', 'Date of service cannot be in the future');
    const oneYear = new Date(); oneYear.setFullYear(oneYear.getFullYear() - 1);
    if (dos < oneYear) add('CLM-003', 'Old Date of Service', 'Claim', 'warning', 'dateOfService', 'Date of service is more than 1 year ago. Check timely filing requirements.');
  }
  if (!claim.provider) add('CLM-004', 'Missing Provider', 'Claim', 'warning', 'provider', 'Provider/rendering provider information is missing');
  if (!claim.claimNumber) add('CLM-005', 'Missing Claim Number', 'Claim', 'error', 'claimNumber', 'Claim number/identifier is required');

  // === CODING RULES ===
  if (!claim.cptCodes) add('COD-001', 'Missing CPT/HCPCS Code', 'Coding', 'error', 'cptCodes', 'At least one procedure code is required');
  if (!claim.billedAmount || parseFloat(String(claim.billedAmount)) <= 0) add('COD-002', 'Invalid Charge Amount', 'Coding', 'error', 'billedAmount', 'Billed amount must be greater than zero');
  if (claim.billedAmount && parseFloat(String(claim.billedAmount)) > 100000) add('COD-003', 'Unusually High Charge', 'Coding', 'warning', 'billedAmount', 'Billed amount is unusually high. Please verify.');

  // === CONSISTENCY RULES ===
  if (claim.paidAmount && claim.billedAmount && parseFloat(String(claim.paidAmount)) > parseFloat(String(claim.billedAmount))) {
    add('CON-001', 'Overpayment Detected', 'Consistency', 'warning', 'paidAmount', 'Paid amount exceeds billed amount');
  }

  return results;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    if (!isSupervisorOrAbove(user.role)) {
      const authPractices = await getUserAuthorizedPracticeIds(user);
      const allowedByPractice =
        authPractices === 'all' || (claim.practiceId ? authPractices.includes(claim.practiceId) : false);
      const allowedByAssignee = claim.assignedTo ? await canViewUser(user, claim.assignedTo) : false;
      if (!allowedByPractice && !allowedByAssignee) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    const results = scrubClaim(claim as Record<string, unknown>);
    const errors = results.filter(r => r.severity === 'error');
    const warnings = results.filter(r => r.severity === 'warning');
    const passed = 12 - results.length; // Total rules minus issues

    return NextResponse.json({
      claimId: id, claimNumber: claim.claimNumber,
      totalRules: 12, passed: Math.max(0, passed),
      errors: errors.length, warnings: warnings.length,
      canSubmit: errors.length === 0,
      results,
    });
  } catch (error) {
    console.error('Scrub error:', error);
    return NextResponse.json({ error: 'Failed to scrub claim' }, { status: 500 });
  }
}
