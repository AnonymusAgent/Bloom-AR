import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { billingTasks, users, practices, taskNotes, taskDocuments, taskStatusHistory, signoffs } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { canViewUser } from '@/lib/rbac';
import { createAuditLog } from '@/lib/audit';
import { cleanDate } from '@/lib/sanitize';

async function canAccessTask(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  task: typeof billingTasks.$inferSelect
): Promise<boolean> {
  if (isSupervisorOrAbove(user.role)) return true;
  if (task.assignedBy === user.id) return true;
  if (!task.assignedTo) return false;
  return canViewUser(user, task.assignedTo);
}

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

    const [task] = await db
      .select()
      .from(billingTasks)
      .where(eq(billingTasks.id, id))
      .limit(1);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Check access
    if (!(await canAccessTask(user, task))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Get assignee details
    let assignee = null;
    if (task.assignedTo) {
      const [assigneeData] = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
        .from(users)
        .where(eq(users.id, task.assignedTo))
        .limit(1);
      assignee = assigneeData;
    }

    // Get practice details
    let practice = null;
    if (task.practiceId) {
      const [practiceData] = await db
        .select({ id: practices.id, name: practices.name, code: practices.code })
        .from(practices)
        .where(eq(practices.id, task.practiceId))
        .limit(1);
      practice = practiceData;
    }

    // Get notes
    const notes = await db
      .select({
        id: taskNotes.id,
        note: taskNotes.note,
        isSupervisorComment: taskNotes.isSupervisorComment,
        createdAt: taskNotes.createdAt,
        userId: taskNotes.userId,
        userName: users.firstName,
        userLastName: users.lastName,
      })
      .from(taskNotes)
      .leftJoin(users, eq(taskNotes.userId, users.id))
      .where(eq(taskNotes.taskId, id))
      .orderBy(desc(taskNotes.createdAt));

    // Get documents
    const documents = await db
      .select({
        id: taskDocuments.id,
        documentType: taskDocuments.documentType,
        fileName: taskDocuments.fileName,
        mimeType: taskDocuments.mimeType,
        status: taskDocuments.status,
        createdAt: taskDocuments.createdAt,
        reviewComments: taskDocuments.reviewComments,
      })
      .from(taskDocuments)
      .where(eq(taskDocuments.taskId, id))
      .orderBy(desc(taskDocuments.createdAt));

    // Get status history
    const statusHistory = await db
      .select({
        id: taskStatusHistory.id,
        previousStatus: taskStatusHistory.previousStatus,
        newStatus: taskStatusHistory.newStatus,
        reason: taskStatusHistory.reason,
        createdAt: taskStatusHistory.createdAt,
        userName: users.firstName,
        userLastName: users.lastName,
      })
      .from(taskStatusHistory)
      .leftJoin(users, eq(taskStatusHistory.changedBy, users.id))
      .where(eq(taskStatusHistory.taskId, id))
      .orderBy(desc(taskStatusHistory.createdAt));

    // Get signoffs
    const taskSignoffs = await db
      .select()
      .from(signoffs)
      .where(eq(signoffs.taskId, id))
      .orderBy(desc(signoffs.createdAt));

    return NextResponse.json({
      task: {
        ...task,
        assignee,
        practice,
      },
      notes: notes.map(n => ({
        ...n,
        userName: n.userName && n.userLastName ? `${n.userName} ${n.userLastName}` : 'Unknown',
      })),
      documents,
      statusHistory: statusHistory.map(h => ({
        ...h,
        userName: h.userName && h.userLastName ? `${h.userName} ${h.userLastName}` : 'Unknown',
      })),
      signoffs: taskSignoffs,
    });
  } catch (error) {
    console.error('Get task error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch task' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const [existingTask] = await db
      .select()
      .from(billingTasks)
      .where(eq(billingTasks.id, id))
      .limit(1);

    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Check access
    if (!(await canAccessTask(user, existingTask))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const updateData: Partial<typeof billingTasks.$inferInsert> = {};

    // Update allowed fields
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.patientName !== undefined) updateData.patientName = body.patientName;
    if (body.insuranceName !== undefined) updateData.insuranceName = body.insuranceName;
    if (body.authNumber !== undefined) updateData.authNumber = body.authNumber;
    if (body.referralNumber !== undefined) updateData.referralNumber = body.referralNumber;
    if (body.serviceDate !== undefined) updateData.serviceDate = cleanDate(body.serviceDate);
    if (body.expirationDate !== undefined) updateData.expirationDate = cleanDate(body.expirationDate);
    if (body.dueDate !== undefined) updateData.dueDate = cleanDate(body.dueDate);
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.result !== undefined) updateData.result = body.result;
    if (body.priority !== undefined) updateData.priority = body.priority;

    // Status change
    if (body.status && body.status !== existingTask.status) {
      updateData.status = body.status;

      if (body.status === 'completed') {
        updateData.completedAt = new Date();
        updateData.completedBy = user.id;
      }

      // Create status history entry
      await db.insert(taskStatusHistory).values({
        taskId: id,
        previousStatus: existingTask.status,
        newStatus: body.status,
        changedBy: user.id,
        reason: body.statusChangeReason || undefined,
      });
    }

    updateData.updatedAt = new Date();

    const [updatedTask] = await db
      .update(billingTasks)
      .set(updateData)
      .where(eq(billingTasks.id, id))
      .returning();

    await createAuditLog({
      userId: user.id,
      action: 'task_updated',
      entityType: 'billingTask',
      entityId: id,
      previousValue: existingTask,
      newValue: updatedTask,
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ task: updatedTask });
  } catch (error) {
    console.error('Update task error:', error);
    return NextResponse.json(
      { error: 'Failed to update task' },
      { status: 500 }
    );
  }
}
