import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { billingTasks, taskDocuments } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { isSupervisorOrAbove } from '@/lib/auth';
import { canViewUser } from '@/lib/rbac';
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

    const [task] = await db
      .select()
      .from(billingTasks)
      .where(and(eq(billingTasks.id, id), eq(billingTasks.organizationId, organizationId)))
      .limit(1);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    if (
      !ctx.isReadOnly &&
      !isSupervisorOrAbove(user.role) &&
      task.assignedBy !== user.id &&
      (!task.assignedTo || !(await canViewUser(user, task.assignedTo, organizationId)))
    ) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [doc] = await db
      .select()
      .from(taskDocuments)
      .where(
        and(
          eq(taskDocuments.id, docId),
          eq(taskDocuments.taskId, id),
          eq(taskDocuments.organizationId, organizationId)
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
    console.error('Download task document error:', error);
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 });
  }
}
