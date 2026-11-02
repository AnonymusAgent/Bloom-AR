import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claimDocuments } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { canAccessClaim } from '@/lib/rbac';
import { cleanUuid } from '@/lib/sanitize';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    const { id, docId } = await params;
    const claimId = cleanUuid(id);
    const documentId = cleanUuid(docId);
    if (!claimId || !documentId) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const hasAccess = await canAccessClaim(user, claimId, organizationId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [doc] = await db
      .select()
      .from(claimDocuments)
      .where(
        and(
          eq(claimDocuments.id, documentId),
          eq(claimDocuments.claimId, claimId),
          eq(claimDocuments.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!doc || !doc.fileData) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const buffer = Buffer.from(doc.fileData, 'base64');
    const safeName = doc.fileName.replace(/["\r\n]/g, '_');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error) {
    console.error('Claim document download error:', error);
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    const { id, docId } = await params;
    const claimId = cleanUuid(id);
    const documentId = cleanUuid(docId);
    if (!claimId || !documentId) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const hasAccess = await canAccessClaim(user, claimId, organizationId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    await db
      .delete(claimDocuments)
      .where(
        and(
          eq(claimDocuments.id, documentId),
          eq(claimDocuments.claimId, claimId),
          eq(claimDocuments.organizationId, organizationId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Claim document delete error:', error);
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
