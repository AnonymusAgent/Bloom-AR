import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { canViewUser, getUserAuthorizedPracticeIds } from '@/lib/rbac';
import { cleanUuid } from '@/lib/sanitize';
import { analyzeClaimCoding } from '@/lib/coding/coding-checker';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const claimId = cleanUuid(body.claimId);

    let diagnosisCodes = body.diagnosisCodes;
    let cptCodes = body.cptCodes;
    let denialReason = body.denialReason;
    let billedAmount = body.billedAmount;
    let dateOfService = body.dateOfService;

    if (claimId) {
      const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      if (!claim) {
        return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
      }
      if (!isSupervisorOrAbove(user.role)) {
        const authPractices = await getUserAuthorizedPracticeIds(user);
        const allowedByPractice =
          authPractices === 'all' ||
          (claim.practiceId ? authPractices.includes(claim.practiceId) : false);
        const allowedByAssignee = claim.assignedTo
          ? await canViewUser(user, claim.assignedTo)
          : false;
        if (!allowedByPractice && !allowedByAssignee) {
          return NextResponse.json({ error: 'Access denied' }, { status: 403 });
        }
      }

      if (diagnosisCodes === undefined) diagnosisCodes = claim.diagnosisCode;
      if (cptCodes === undefined) cptCodes = claim.cptCodes;
      if (denialReason === undefined) denialReason = claim.denialReason;
      if (billedAmount === undefined) billedAmount = claim.billedAmount;
      if (dateOfService === undefined) dateOfService = claim.dateOfService;
    }

    const report = analyzeClaimCoding({
      diagnosisCodes,
      cptCodes,
      denialReason,
      billedAmount,
      dateOfService,
    });

    return NextResponse.json({ report });
  } catch (error) {
    console.error('Coding error check failed:', error);
    return NextResponse.json({ error: 'Failed to analyze claim coding' }, { status: 500 });
  }
}
