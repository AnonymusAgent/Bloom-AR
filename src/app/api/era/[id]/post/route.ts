import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  eraFiles,
  eraTransactions,
  claims,
  payments,
  paymentAllocations,
  claimStatusHistory,
} from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { isSupervisorOrAbove } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { requireTenantContext } from '@/lib/tenant-context';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    if (!isSupervisorOrAbove(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const { id } = await params;

    const [eraFile] = await db
      .select()
      .from(eraFiles)
      .where(and(eq(eraFiles.id, id), eq(eraFiles.organizationId, organizationId)))
      .limit(1);
    if (!eraFile) return NextResponse.json({ error: 'ERA file not found' }, { status: 404 });
    if (eraFile.status === 'posted') {
      return NextResponse.json({ error: 'ERA already posted' }, { status: 400 });
    }

    const txns = await db
      .select()
      .from(eraTransactions)
      .where(
        and(
          eq(eraTransactions.organizationId, organizationId),
          eq(eraTransactions.eraFileId, id),
          eq(eraTransactions.matchStatus, 'matched'),
          eq(eraTransactions.postStatus, 'pending')
        )
      );

    if (txns.length === 0) {
      return NextResponse.json({ error: 'No matched pending transactions to post' }, { status: 400 });
    }

    const [payment] = await db
      .insert(payments)
      .values({
        organizationId,
        paymentType: 'era',
        payerName: eraFile.payerName,
        paymentDate: eraFile.paymentDate || new Date().toISOString().split('T')[0],
        checkNumber: eraFile.checkNumber,
        totalAmount: eraFile.totalPayment || '0',
        allocatedAmount: '0',
        eraFileId: eraFile.id,
        status: 'posted',
        postedBy: user.id,
      })
      .returning();

    let posted = 0;
    let failed = 0;
    let totalAllocated = 0;

    for (const tx of txns) {
      try {
        if (!tx.claimId) {
          failed++;
          await db
            .update(eraTransactions)
            .set({ postStatus: 'failed', errorMessage: 'No matched claim' })
            .where(eq(eraTransactions.id, tx.id));
          continue;
        }

        const [claim] = await db
          .select()
          .from(claims)
          .where(and(eq(claims.id, tx.claimId), eq(claims.organizationId, organizationId)))
          .limit(1);
        if (!claim) {
          failed++;
          await db
            .update(eraTransactions)
            .set({ postStatus: 'failed', errorMessage: 'Claim outside organization boundary' })
            .where(eq(eraTransactions.id, tx.id));
          continue;
        }

        const paidAmt = parseFloat(String(tx.paidAmount || '0'));
        const contractAdj = parseFloat(String(tx.contractualAdjustment || '0'));
        const patResp = parseFloat(String(tx.patientResponsibility || '0'));
        const otherAdj = parseFloat(String(tx.otherAdjustment || '0'));

        await db.insert(paymentAllocations).values({
          organizationId,
          paymentId: payment.id,
          claimId: tx.claimId,
          insurancePayment: String(paidAmt),
          contractualAdjustment: String(contractAdj),
          patientResponsibility: String(patResp),
          otherAdjustment: String(otherAdj),
          carcCode: tx.carcCode,
          rarcCode: tx.rarcCode,
          remarks: tx.remarkText,
          postedBy: user.id,
        });

        const currentPaid = parseFloat(String(claim.paidAmount || '0')) || 0;
        const newPaid = currentPaid + paidAmt;
        const baseBalance =
          claim.balance !== null && claim.balance !== undefined
            ? parseFloat(String(claim.balance)) || 0
            : Math.max(0, (parseFloat(String(claim.billedAmount || '0')) || 0) - currentPaid);
        const newBalance = Math.max(0, baseBalance - paidAmt - contractAdj - otherAdj);
        const paidInFull = newBalance <= 0.005;
        const newStatus = paidInFull ? 'paid' : paidAmt > 0 ? 'in_progress' : claim.status;

        await db
          .update(claims)
          .set({
            paidAmount: newPaid.toFixed(2),
            balance: newBalance.toFixed(2),
            status: newStatus as typeof claim.status,
            ...(paidInFull
              ? { claimInsuranceStatus: 'processed', workflowStatus: 'approved' }
              : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(claims.id, tx.claimId), eq(claims.organizationId, organizationId)));

        await db.insert(claimStatusHistory).values({
          organizationId,
          claimId: tx.claimId,
          previousStatus: claim.status,
          newStatus: newStatus as typeof claim.status,
          changedBy: user.id,
          reason: `ERA payment posted: $${paidAmt.toFixed(2)} (Check: ${eraFile.checkNumber || 'N/A'})`,
        });

        totalAllocated += paidAmt;
        posted++;
        await db
          .update(eraTransactions)
          .set({ postStatus: 'posted' })
          .where(eq(eraTransactions.id, tx.id));
      } catch (e) {
        failed++;
        await db
          .update(eraTransactions)
          .set({
            postStatus: 'failed',
            errorMessage: e instanceof Error ? e.message : 'Unknown error',
          })
          .where(eq(eraTransactions.id, tx.id));
      }
    }

    await db
      .update(payments)
      .set({
        allocatedAmount: String(totalAllocated),
        unallocatedAmount: String(
          parseFloat(String(eraFile.totalPayment || '0')) - totalAllocated
        ),
      })
      .where(and(eq(payments.id, payment.id), eq(payments.organizationId, organizationId)));

    await db
      .update(eraFiles)
      .set({
        postedClaims: posted,
        status: failed === 0 ? 'posted' : 'partial',
        processedAt: new Date(),
      })
      .where(and(eq(eraFiles.id, id), eq(eraFiles.organizationId, organizationId)));

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: 'era_posted',
      entityType: 'eraFile',
      entityId: id,
      newValue: { posted, failed, totalAllocated },
    });

    return NextResponse.json({
      success: true,
      posted,
      failed,
      totalAllocated,
      paymentId: payment.id,
    });
  } catch (error) {
    console.error('ERA post error:', error);
    return NextResponse.json({ error: 'Failed to post ERA' }, { status: 500 });
  }
}
