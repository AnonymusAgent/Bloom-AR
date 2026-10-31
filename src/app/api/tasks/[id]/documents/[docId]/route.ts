import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { billingTasks, taskDocuments } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { canViewUser } from '@/lib/rbac';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id, docId } = await params;

    const [task] = await db.select().from(billingTasks).where(eq(billingTasks.id, id)).limit(1);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    if (
      !isSupervisorOrAbove(user.role) &&
      task.assignedBy !== user.id &&
      (!task.assignedTo || !(await canViewUser(user, task.assignedTo)))
    ) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [doc] = await db
      .select()
      .from(taskDocuments)
      .where(and(eq(taskDocuments.id, docId), eq(taskDocuments.taskId, id)))
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
