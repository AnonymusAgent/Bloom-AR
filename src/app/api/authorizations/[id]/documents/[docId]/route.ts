import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { authDocuments, authorizations } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { canViewUser } from '@/lib/rbac';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id, docId } = await params;

    const [auth] = await db.select().from(authorizations).where(eq(authorizations.id, id)).limit(1);
    if (!auth) return NextResponse.json({ error: 'Authorization not found' }, { status: 404 });

    if (
      !['administrator', 'supervisor', 'manager'].includes(user.role) &&
      auth.assignedBy !== user.id &&
      (!auth.assignedTo || !(await canViewUser(user, auth.assignedTo)))
    ) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [doc] = await db
      .select()
      .from(authDocuments)
      .where(and(eq(authDocuments.id, docId), eq(authDocuments.authId, id)))
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
