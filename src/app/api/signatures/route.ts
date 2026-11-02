import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { eSignatures } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { verifyClaimInOrg } from '@/lib/rbac';
import { createAuditLog } from '@/lib/audit';
import { cleanUuid, cleanPage, cleanLimit } from '@/lib/sanitize';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { organizationId } = auth.ctx;

    const sp = request.nextUrl.searchParams;
    const page = cleanPage(sp.get('page'));
    const limit = cleanLimit(sp.get('limit'), 20, 100);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(eSignatures)
      .where(eq(eSignatures.organizationId, organizationId));

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
      .where(eq(eSignatures.organizationId, organizationId))
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
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

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

    const relatedClaimId = cleanUuid(body.relatedClaimId);
    if (relatedClaimId && !(await verifyClaimInOrg(relatedClaimId, organizationId))) {
      return NextResponse.json(
        { error: 'Referenced claim not found in your organization' },
        { status: 403 }
      );
    }

    const [sig] = await db
      .insert(eSignatures)
      .values({
        organizationId,
        documentType: documentType || 'general',
        documentTitle: String(documentTitle).trim(),
        documentContent: documentContent || null,
        signatureData,
        signerName: String(signerName).trim(),
        signerRole: signerRole || user.role,
        signerEmail: user.email,
        ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
        userAgent: request.headers.get('user-agent') || undefined,
        relatedClaimId,
        relatedEntityType: relatedEntityType || null,
        relatedEntityId: cleanUuid(body.relatedEntityId),
        signedBy: user.id,
      })
      .returning();

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
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
