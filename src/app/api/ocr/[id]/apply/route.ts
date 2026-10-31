import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { ocrScans, claims } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { cleanUuid, cleanDate } from '@/lib/sanitize';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const body = await request.json();
    const claimId = cleanUuid(body.claimId);
    const { editedData } = body;

    const [scan] = await db.select().from(ocrScans).where(eq(ocrScans.id, id)).limit(1);
    if (!scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });

    const data = editedData || (scan.extractedData as Record<string, string | null>);

    if (claimId) {
      const [existingClaim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      if (!existingClaim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

      const updateFields: Record<string, unknown> = { updatedAt: new Date() };
      if (data.patientName) updateFields.patientName = data.patientName;
      if (data.claimNumber) updateFields.claimNumber = data.claimNumber;
      if (data.provider) updateFields.provider = data.provider;
      if (data.payerName) updateFields.insurance = data.payerName;
      if (data.dateOfService) {
        const dos = cleanDate(data.dateOfService);
        if (dos) updateFields.dateOfService = dos;
      }
      if (data.diagnosisCode) updateFields.diagnosisCode = data.diagnosisCode;
      if (data.procedureCode) updateFields.cptCodes = data.procedureCode;
      if (data.totalCharge) {
        const billed = parseFloat(String(data.totalCharge).replace(/,/g, ''));
        if (Number.isFinite(billed)) updateFields.billedAmount = billed.toFixed(2);
      }
      if (data.amountPaid) {
        const paid = parseFloat(String(data.amountPaid).replace(/,/g, ''));
        if (Number.isFinite(paid)) updateFields.paidAmount = paid.toFixed(2);
      }
      if (updateFields.billedAmount !== undefined || updateFields.paidAmount !== undefined) {
        const billed = parseFloat(String(updateFields.billedAmount ?? existingClaim.billedAmount ?? '0')) || 0;
        const paid = parseFloat(String(updateFields.paidAmount ?? existingClaim.paidAmount ?? '0')) || 0;
        updateFields.balance = Math.max(0, billed - paid).toFixed(2);
      }

      await db.update(claims).set(updateFields).where(eq(claims.id, claimId));
      await db
        .update(ocrScans)
        .set({ appliedToClaimId: claimId, reviewedBy: user.id, reviewedAt: new Date(), status: 'applied' })
        .where(eq(ocrScans.id, id));

      await createAuditLog({
        userId: user.id,
        action: 'ocr_data_applied',
        entityType: 'claim',
        entityId: claimId,
        newValue: updateFields,
      });
    } else {
      await db
        .update(ocrScans)
        .set({ extractedData: data, reviewedBy: user.id, reviewedAt: new Date(), status: 'reviewed' })
        .where(eq(ocrScans.id, id));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Apply OCR error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
