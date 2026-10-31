import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { billingTasks, taskDocuments, users } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const documents = await db
      .select({
        id: taskDocuments.id,
        documentType: taskDocuments.documentType,
        fileName: taskDocuments.fileName,
        mimeType: taskDocuments.mimeType,
        fileSize: taskDocuments.fileSize,
        status: taskDocuments.status,
        reviewComments: taskDocuments.reviewComments,
        createdAt: taskDocuments.createdAt,
        uploadedBy: taskDocuments.uploadedBy,
        uploaderName: users.firstName,
        uploaderLastName: users.lastName,
      })
      .from(taskDocuments)
      .leftJoin(users, eq(taskDocuments.uploadedBy, users.id))
      .where(eq(taskDocuments.taskId, id))
      .orderBy(desc(taskDocuments.createdAt));

    return NextResponse.json({
      documents: documents.map(d => ({
        ...d,
        uploaderName: d.uploaderName && d.uploaderLastName 
          ? `${d.uploaderName} ${d.uploaderLastName}` 
          : 'Unknown',
      })),
    });
  } catch (error) {
    console.error('Get task documents error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const [task] = await db
      .select()
      .from(billingTasks)
      .where(eq(billingTasks.id, id))
      .limit(1);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
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

    // Validate file type or extension
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const allowedExts = ['pdf', 'xlsx', 'xls', 'csv', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx'];
    if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: PDF, XLSX, XLS, CSV, TXT, PNG, JPG, DOC, DOCX' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileData = buffer.toString('base64');

    const [document] = await db
      .insert(taskDocuments)
      .values({
        taskId: id,
        documentType,
        fileName: file.name,
        fileData,
        mimeType: file.type,
        fileSize: file.size,
        uploadedBy: user.id,
        status: 'pending',
      })
      .returning();

    await createAuditLog({
      userId: user.id,
      action: 'task_document_uploaded',
      entityType: 'taskDocument',
      entityId: document.id,
      newValue: { taskId: id, documentType, fileName: file.name },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      document: {
        id: document.id,
        documentType: document.documentType,
        fileName: document.fileName,
        mimeType: document.mimeType,
        fileSize: document.fileSize,
        status: document.status,
        createdAt: document.createdAt,
      },
    });
  } catch (error) {
    console.error('Upload task document error:', error);
    return NextResponse.json(
      { error: 'Failed to upload document' },
      { status: 500 }
    );
  }
}
