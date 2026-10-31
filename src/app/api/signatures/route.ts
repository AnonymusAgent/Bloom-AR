import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { eSignatures } from '@/db/schema';
import { desc, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { cleanUuid, cleanPage, cleanLimit } from '@/lib/sanitize';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = request.nextUrl.searchParams;
    const page = cleanPage(sp.get('page'));
    const limit = cleanLimit(sp.get('limit'), 20, 100);

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(eSignatures);

    const rows = await db
      .select({
        id: eSignatures.id,
        documentType: eSignatures.documentType,
        documentTitle: eSignatures.documentTitle,
        signerName: eSignatures.signerName,
        signerRole: eSignatures.signerRole,
        signedAt: eSignatures.signedAt,
        relatedClaimId: eSignatures.relatedClaimId,
        relatedEntityType: eSignatures.relatedEntityType,
      })
      .from(eSignatures)
      .orderBy(desc(eSignatures.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return NextResponse.json({
      signatures: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    console.error('Get signatures error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const {
      documentType,
      documentTitle,
      documentContent,
      signatureData,
      signerName,
      signerRole,
      relatedEntityType,
    } = body;

    if (!signatureData || !signerName || !documentTitle) {
      return NextResponse.json(
        { error: 'Signature data, signer name, and document title are required' },
        { status: 400 }
      );
    }

    const [sig] = await db
      .insert(eSignatures)
      .values({
        documentType: documentType || 'general',
        documentTitle: String(documentTitle).trim(),
        documentContent: documentContent || null,
        signatureData,
        signerName: String(signerName).trim(),
        signerRole: signerRole || user.role,
        signerEmail: user.email,
        ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
        userAgent: request.headers.get('user-agent') || undefined,
        relatedClaimId: cleanUuid(body.relatedClaimId),
        relatedEntityType: relatedEntityType || null,
        relatedEntityId: cleanUuid(body.relatedEntityId),
        signedBy: user.id,
      })
      .returning();

    await createAuditLog({
      userId: user.id,
      action: 'document_signed',
      entityType: 'eSignature',
      entityId: sig.id,
      newValue: { documentTitle, signerName, documentType },
    });

    return NextResponse.json({ signature: sig });
  } catch (error) {
    console.error('Create signature error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
