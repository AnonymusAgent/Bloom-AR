import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { payments, paymentAllocations, claims, claimStatusHistory } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { cleanUuid, cleanDate, cleanPage, cleanLimit } from '@/lib/sanitize';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const page = cleanPage(request.nextUrl.searchParams.get('page'));
    const limit = cleanLimit(request.nextUrl.searchParams.get('limit'), 20, 100);

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(payments);
    const rows = await db
      .select()
      .from(payments)
      .orderBy(desc(payments.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return NextResponse.json({
      payments: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    console.error('Get payments error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { paymentType, payerName, checkNumber, totalAmount, notes, allocations } = body;
    const paymentDate = cleanDate(body.paymentDate);
    const totalAmtNum = parseFloat(String(totalAmount));

    if (!paymentType || !paymentDate || !Number.isFinite(totalAmtNum)) {
      return NextResponse.json({ error: 'Payment type, valid date, and amount are required' }, { status: 400 });
    }
    if (totalAmtNum <= 0) {
      return NextResponse.json({ error: 'Payment amount must be positive' }, { status: 400 });
    }

    // Pre-validate allocations BEFORE inserting payment or mutating claims
    const parsedAllocs: Array<{
      claimId: string;
      insPayment: number;
      contractAdj: number;
      patResp: number;
      otherAdj: number;
      carcCode?: string;
      rarcCode?: string;
      remarks?: string;
    }> = [];

    let totalAllocated = 0;
    if (allocations && Array.isArray(allocations)) {
      for (const alloc of allocations) {
        const claimId = cleanUuid(alloc.claimId);
        if (!claimId) continue;
        const insPayment = parseFloat(alloc.insurancePayment || '0') || 0;
        const contractAdj = parseFloat(alloc.contractualAdjustment || '0') || 0;
        const patResp = parseFloat(alloc.patientResponsibility || '0') || 0;
        const otherAdj = parseFloat(alloc.otherAdjustment || '0') || 0;
        if (insPayment < 0 || contractAdj < 0 || patResp < 0 || otherAdj < 0) {
          return NextResponse.json({ error: 'Allocation amounts cannot be negative' }, { status: 400 });
        }
        totalAllocated += insPayment;
        parsedAllocs.push({
          claimId,
          insPayment,
          contractAdj,
          patResp,
          otherAdj,
          carcCode: alloc.carcCode || undefined,
          rarcCode: alloc.rarcCode || undefined,
          remarks: alloc.remarks || undefined,
        });
      }
      if (totalAllocated > totalAmtNum + 0.001) {
        return NextResponse.json(
          {
            error: `Allocated amount ($${totalAllocated.toFixed(2)}) exceeds payment amount ($${totalAmtNum.toFixed(2)})`,
          },
          { status: 400 }
        );
      }
    }

    const [createdPayment] = await db
      .insert(payments)
      .values({
        paymentType,
        payerName: payerName ? String(payerName).trim() : null,
        paymentDate,
        checkNumber: checkNumber ? String(checkNumber).trim() : null,
        totalAmount: totalAmtNum.toFixed(2),
        allocatedAmount: totalAllocated.toFixed(2),
        unallocatedAmount: Math.max(0, totalAmtNum - totalAllocated).toFixed(2),
        notes: notes ? String(notes) : null,
        status: totalAllocated > 0 ? 'posted' : 'pending',
        postedBy: user.id,
      })
      .returning();

    for (const alloc of parsedAllocs) {
      await db.insert(paymentAllocations).values({
        paymentId: createdPayment.id,
        claimId: alloc.claimId,
        insurancePayment: alloc.insPayment.toFixed(2),
        contractualAdjustment: alloc.contractAdj.toFixed(2),
        patientResponsibility: alloc.patResp.toFixed(2),
        otherAdjustment: alloc.otherAdj.toFixed(2),
        carcCode: alloc.carcCode,
        rarcCode: alloc.rarcCode,
        remarks: alloc.remarks,
        postedBy: user.id,
      });

      const [claim] = await db.select().from(claims).where(eq(claims.id, alloc.claimId)).limit(1);
      if (claim) {
        const currentPaid = parseFloat(String(claim.paidAmount || '0')) || 0;
        const newPaid = currentPaid + alloc.insPayment;
        const baseBalance =
          claim.balance !== null && claim.balance !== undefined
            ? parseFloat(String(claim.balance)) || 0
            : Math.max(0, (parseFloat(String(claim.billedAmount || '0')) || 0) - currentPaid);
        const newBalance = Math.max(0, baseBalance - alloc.insPayment - alloc.contractAdj - alloc.otherAdj);
        const paidInFull = newBalance <= 0.005;
        const newStatus = paidInFull ? 'paid' : claim.status;

        await db
          .update(claims)
          .set({
            paidAmount: newPaid.toFixed(2),
            balance: newBalance.toFixed(2),
            status: newStatus as typeof claim.status,
            ...(paidInFull ? { claimInsuranceStatus: 'processed', workflowStatus: 'approved' } : {}),
            updatedAt: new Date(),
          })
          .where(eq(claims.id, alloc.claimId));

        await db.insert(claimStatusHistory).values({
          claimId: alloc.claimId,
          previousStatus: claim.status,
          newStatus: newStatus as typeof claim.status,
          changedBy: user.id,
          reason: `Payment posted: $${alloc.insPayment.toFixed(2)} (Check: ${checkNumber || 'N/A'})`,
        });
      }
    }

    await createAuditLog({
      userId: user.id,
      action: 'payment_created',
      entityType: 'payment',
      entityId: createdPayment.id,
      newValue: { paymentType, totalAmount: totalAmtNum, allocations: parsedAllocs.length },
    });

    return NextResponse.json({ payment: createdPayment });
  } catch (error) {
    console.error('Create payment error:', error);
    return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
  }
}
