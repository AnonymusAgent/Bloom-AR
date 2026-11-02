import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, claimDocuments, users } from '@/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { canAccessClaim } from '@/lib/rbac';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    const { id } = await params;
    if (!ctx.isReadOnly && !(await canAccessClaim(user, id, organizationId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [claim] = await db
      .select({ id: claims.id })
      .from(claims)
      .where(and(eq(claims.id, id), eq(claims.organizationId, organizationId)))
      .limit(1);
    if (!claim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    const documents = await db
      .select({
        id: claimDocuments.id,
        documentType: claimDocuments.documentType,
        fileName: claimDocuments.fileName,
        mimeType: claimDocuments.mimeType,
        createdAt: claimDocuments.createdAt,
        uploadedBy: claimDocuments.uploadedBy,
        uploaderName: users.firstName,
        uploaderLastName: users.lastName,
      })
      .from(claimDocuments)
      .leftJoin(users, eq(claimDocuments.uploadedBy, users.id))
      .where(
        and(eq(claimDocuments.claimId, id), eq(claimDocuments.organizationId, organizationId))
      )
      .orderBy(desc(claimDocuments.createdAt));

    return NextResponse.json({
      documents: documents.map((d) => ({
        ...d,
        uploaderName:
          d.uploaderName && d.uploaderLastName
            ? `${d.uploaderName} ${d.uploaderLastName}`
            : 'Unknown',
      })),
    });
  } catch (error) {
    console.error('Get documents error:', error);
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    const { id } = await params;

    const [claim] = await db
      .select()
      .from(claims)
      .where(and(eq(claims.id, id), eq(claims.organizationId, organizationId)))
      .limit(1);

    if (!claim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    if (!(await canAccessClaim(user, id, organizationId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const documentType = formData.get('documentType') as string;

    if (!file || !documentType) {
      return NextResponse.json(
        { error: 'File and document type are required' },
        { status: 400 }
      );
    }

    if (!['eob', 'denial', 'appeal', 'other'].includes(documentType)) {
      return NextResponse.json({ error: 'Invalid document type' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileData = buffer.toString('base64');

    const [document] = await db
      .insert(claimDocuments)
      .values({
        organizationId,
        claimId: id,
        documentType,
        fileName: file.name,
        fileData,
        mimeType: file.type || 'application/octet-stream',
        uploadedBy: user.id,
      })
      .returning();

    const auditAction =
      documentType === 'eob'
        ? AUDIT_ACTIONS.EOB_UPLOADED
        : documentType === 'denial'
        ? AUDIT_ACTIONS.DENIAL_DOCUMENT_UPLOADED
        : AUDIT_ACTIONS.DOCUMENT_UPLOADED;

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: auditAction,
      entityType: 'claimDocument',
      entityId: document.id,
      newValue: { claimId: id, documentType, fileName: file.name },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      document: {
        id: document.id,
        documentType: document.documentType,
        fileName: document.fileName,
        mimeType: document.mimeType,
        createdAt: document.createdAt,
      },
    });
  } catch (error) {
    console.error('Upload document error:', error);
    return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 });
  }
}
