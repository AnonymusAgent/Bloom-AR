import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { authDocuments, authorizations } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { canViewUser } from '@/lib/rbac';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const authRes = await requireTenantContext();
    if (!authRes.ok) return authRes.response;
    const { ctx } = authRes;
    const { user, organizationId } = ctx;
    const { id, docId } = await params;

    const [auth] = await db
      .select()
      .from(authorizations)
      .where(and(eq(authorizations.id, id), eq(authorizations.organizationId, organizationId)))
      .limit(1);
    if (!auth) return NextResponse.json({ error: 'Authorization not found' }, { status: 404 });

    if (
      !ctx.isReadOnly &&
      !['administrator', 'supervisor', 'manager'].includes(user.role) &&
      auth.assignedBy !== user.id &&
      (!auth.assignedTo || !(await canViewUser(user, auth.assignedTo, organizationId)))
    ) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [doc] = await db
      .select()
      .from(authDocuments)
      .where(
        and(
          eq(authDocuments.id, docId),
          eq(authDocuments.authId, id),
          eq(authDocuments.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const buffer = Buffer.from(doc.fileData, 'base64');
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${doc.fileName.replace(/"/g, '')}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error) {
    console.error('Download auth document error:', error);
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 });
  }
}
