import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, claimDocuments } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, docId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(docId)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const [claim] = await db.select().from(claims).where(eq(claims.id, id)).limit(1);
    if (!claim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    if (['ar_executive', 'billing_user'].includes(user.role) && claim.assignedTo !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [doc] = await db
      .select()
      .from(claimDocuments)
      .where(and(eq(claimDocuments.id, docId), eq(claimDocuments.claimId, id)))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const buffer = Buffer.from(doc.fileData, 'base64');
    const safeName = doc.fileName.replace(/["\r\n]/g, '_');
    const inline = request.nextUrl.searchParams.get('inline') === '1';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Download claim document error:', error);
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 });
  }
}
