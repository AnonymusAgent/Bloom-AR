import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  billingTasks,
  users,
  practices,
  taskNotes,
  taskDocuments,
  taskStatusHistory,
  signoffs,
} from '@/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { isSupervisorOrAbove } from '@/lib/auth';
import type { User } from '@/db/schema';
import { canViewUser } from '@/lib/rbac';
import { createAuditLog } from '@/lib/audit';
import { cleanDate } from '@/lib/sanitize';
import { requireTenantContext } from '@/lib/tenant-context';

async function canAccessTask(
  user: User,
  task: typeof billingTasks.$inferSelect,
  organizationId: string,
  isReadOnly: boolean
): Promise<boolean> {
  if (task.organizationId !== organizationId) return false;
  if (isReadOnly || isSupervisorOrAbove(user.role)) return true;
  if (task.assignedBy === user.id) return true;
  if (!task.assignedTo) return false;
  return canViewUser(user, task.assignedTo, organizationId);
}

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

    const [task] = await db
      .select()
      .from(billingTasks)
      .where(and(eq(billingTasks.id, id), eq(billingTasks.organizationId, organizationId)))
      .limit(1);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!(await canAccessTask(user, task, organizationId, ctx.isReadOnly))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    let assignee = null;
    if (task.assignedTo) {
      const [assigneeData] = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(users)
        .where(eq(users.id, task.assignedTo))
        .limit(1);
      assignee = assigneeData;
    }

    let practice = null;
    if (task.practiceId) {
      const [practiceData] = await db
        .select({ id: practices.id, name: practices.name, code: practices.code })
        .from(practices)
        .where(
          and(eq(practices.id, task.practiceId), eq(practices.organizationId, organizationId))
        )
        .limit(1);
      practice = practiceData;
    }

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

    const taskSignoffs = await db
      .select()
      .from(signoffs)
      .where(and(eq(signoffs.taskId, id), eq(signoffs.organizationId, organizationId)))
      .orderBy(desc(signoffs.createdAt));

    return NextResponse.json({
      task: {
        ...task,
        assignee,
        practice,
      },
      notes: notes.map((n) => ({
        ...n,
        userName: n.userName && n.userLastName ? `${n.userName} ${n.userLastName}` : 'Unknown',
      })),
      documents,
      statusHistory: statusHistory.map((h) => ({
        ...h,
        userName: h.userName && h.userLastName ? `${h.userName} ${h.userLastName}` : 'Unknown',
      })),
      signoffs: taskSignoffs,
    });
  } catch (error) {
    console.error('Get task error:', error);
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    const { id } = await params;
    const body = await request.json();

    const [existingTask] = await db
      .select()
      .from(billingTasks)
      .where(and(eq(billingTasks.id, id), eq(billingTasks.organizationId, organizationId)))
      .limit(1);

    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!(await canAccessTask(user, existingTask, organizationId, false))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const updateData: Partial<typeof billingTasks.$inferInsert> = {};

    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.patientName !== undefined) updateData.patientName = body.patientName;
    if (body.insuranceName !== undefined) updateData.insuranceName = body.insuranceName;
    if (body.authNumber !== undefined) updateData.authNumber = body.authNumber;
    if (body.referralNumber !== undefined) updateData.referralNumber = body.referralNumber;
    if (body.serviceDate !== undefined) updateData.serviceDate = cleanDate(body.serviceDate);
    if (body.expirationDate !== undefined) {
      updateData.expirationDate = cleanDate(body.expirationDate);
    }
    if (body.dueDate !== undefined) updateData.dueDate = cleanDate(body.dueDate);
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.result !== undefined) updateData.result = body.result;
    if (body.priority !== undefined) updateData.priority = body.priority;

    if (body.status && body.status !== existingTask.status) {
      updateData.status = body.status;

      if (body.status === 'completed') {
        updateData.completedAt = new Date();
        updateData.completedBy = user.id;
      }

      await db.insert(taskStatusHistory).values({
        organizationId,
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
      .where(and(eq(billingTasks.id, id), eq(billingTasks.organizationId, organizationId)))
      .returning();

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: 'task_updated',
      entityType: 'billingTask',
      entityId: id,
      previousValue: { status: existingTask.status },
      newValue: { status: updatedTask.status },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ task: updatedTask });
  } catch (error) {
    console.error('Update task error:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}
