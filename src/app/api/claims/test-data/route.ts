import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, users, practices, denialCodes } from '@/db/schema';
import { sql, asc } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { ensureSaaSColumns, safeErrorDetail } from '@/lib/db-schema';
import { generateTestClaims } from '@/lib/test-claims';

/**
 * Replace ALL claims with the 50-claim synthetic test set (administrators only).
 * Destructive by design — the UI double-confirms and the API requires an exact
 * confirmation phrase. Related claim rows cascade/delete with their claim.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'administrator') return NextResponse.json({ error: 'Only administrators can replace claim data' }, { status: 403 });
    const body = await request.json().catch(() => null);
    if (body?.confirm !== 'REPLACE_ALL_CLAIMS') {
      return NextResponse.json({ error: 'Confirmation required: send { "confirm": "REPLACE_ALL_CLAIMS" }' }, { status: 400 });
    }
    await ensureSaaSColumns();

    const [{ count: before }] = await db.select({ count: sql<number>`count(*)::int` }).from(claims);

    // Remove existing claim data (children first where no cascade exists).
    await db.execute(sql`DELETE FROM denial_analyses WHERE claim_id IN (SELECT id FROM claims)`);
    await db.execute(sql`DELETE FROM coding_requests WHERE claim_id IN (SELECT id FROM claims)`);
    await db.execute(sql`DELETE FROM payment_allocations WHERE claim_id IN (SELECT id FROM claims)`);
    await db.execute(sql`DELETE FROM era_transactions WHERE claim_id IN (SELECT id FROM claims)`);
    await db.execute(sql`UPDATE billing_tasks SET claim_id = NULL WHERE claim_id IN (SELECT id FROM claims)`);
    await db.execute(sql`DELETE FROM claims`);

    // Assign test claims round-robin across active users (and active practices if any exist) so queues and practice filters are testable.
    const activeUsers = await db.select({ id: users.id }).from(users).where(sql`${users.isActive} = true`).orderBy(asc(users.createdAt));
    const assignees = activeUsers.length ? activeUsers : [{ id: user.id }];
    const activePractices = await db.select({ id: practices.id }).from(practices).where(sql`${practices.isActive} = true`).orderBy(asc(practices.createdAt));
    const deniedCodes = await db.select({ id: denialCodes.id }).from(denialCodes).limit(10);
    const rows = generateTestClaims(50).map((c, i) => ({
      ...c,
      status: c.status as typeof claims.status.enumValues[number],
      practiceId: activePractices.length ? activePractices[i % activePractices.length].id : null,
      assignedTo: ['new', 'closed'].includes(c.status) ? null : assignees[i % assignees.length].id,
      assignedBy: user.id,
      assignedAt: ['new', 'closed'].includes(c.status) ? null : new Date(),
      workedBy: ['working', 'pending_approval', 'approved', 'rework'].includes(c.workflowStatus) ? assignees[i % assignees.length].id : null,
      denialCodeId: c.denialReason && deniedCodes.length ? deniedCodes[i % deniedCodes.length].id : null,
    }));
    const inserted = await db.insert(claims).values(rows).returning({ id: claims.id, claimNumber: claims.claimNumber });

    await createAuditLog({ userId: user.id, action: 'claims_test_data_replaced', entityType: 'claim', entityId: 'bulk', previousValue: { deletedClaims: before }, newValue: { insertedClaims: inserted.length } });
    return NextResponse.json({ success: true, deleted: before, inserted: inserted.length, firstClaimId: inserted[0]?.id, message: `Replaced ${before} claim(s) with ${inserted.length} test claims (TEST-CLM-001 … TEST-CLM-050).` });
  } catch (error) {
    console.error('Replace test claims error:', error);
    return NextResponse.json({ error: 'Failed to replace claim data', detail: safeErrorDetail(error), hint: 'Check /api/health for database/schema status.' }, { status: 500 });
  }
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(claims);
  const [{ testCount }] = await db.select({ testCount: sql<number>`count(*)::int` }).from(claims).where(sql`${claims.claimNumber} LIKE 'TEST-CLM-%'`);
  return NextResponse.json({ totalClaims: count, testClaims: testCount });
}
