import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { codingRequests, claims, claimStatusHistory } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const body = await request.json();

    const [existing] = await db.select().from(codingRequests).where(eq(codingRequests.id, id)).limit(1);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status) updateData.status = body.status;
    if (body.correctionNotes) updateData.correctionNotes = body.correctionNotes;
    if (body.status === 'corrected' || body.status === 'returned_to_billing') {
      updateData.resolvedBy = user.id;
      updateData.resolvedAt = new Date();
    }

    const [updated] = await db.update(codingRequests).set(updateData).where(eq(codingRequests.id, id)).returning();

    // Map coding status to claim status
    const claimStatusMap: Record<string, string> = {
      under_review: 'coding_review',
      corrected: 'coding_corrected',
      returned_to_billing: 'returned_to_billing',
      resubmitted: 'resubmitted',
    };

    if (body.status && claimStatusMap[body.status]) {
      const [claim] = await db.select().from(claims).where(eq(claims.id, existing.claimId)).limit(1);
      if (claim) {
        const claimUpdate: Record<string, unknown> = {
          status: claimStatusMap[body.status] as typeof claim.status,
          updatedAt: new Date(),
        };
        if (body.status === 'corrected' || body.status === 'returned_to_billing') {
          claimUpdate.workflowStatus = 'working';
        }
        await db.update(claims).set(claimUpdate).where(eq(claims.id, existing.claimId));
        await db.insert(claimStatusHistory).values({ claimId: existing.claimId, previousStatus: claim.status, newStatus: claimStatusMap[body.status] as typeof claim.status, changedBy: user.id, reason: `Coding: ${body.status}${body.correctionNotes ? ` — ${body.correctionNotes}` : ''}` });
      }
      // Notify sender
      if (existing.sentBy && existing.sentBy !== user.id) {
        await createNotification({ userId: existing.sentBy, type: 'system', title: 'Coding Update', message: `Coding request status: ${body.status.replace('_', ' ')}`, relatedClaimId: existing.claimId });
      }
    }

    await createAuditLog({ userId: user.id, action: 'coding_request_updated', entityType: 'codingRequest', entityId: id, previousValue: { status: existing.status }, newValue: { status: updated.status } });

    return NextResponse.json({ codingRequest: updated });
  } catch (error) {
    console.error('Update coding request error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
