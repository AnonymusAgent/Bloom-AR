import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { billingTasks, users, taskStatusHistory } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { canAssignTasks } from '@/lib/auth';
import { verifyUserInOrg } from '@/lib/rbac';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { requireTenantContext } from '@/lib/tenant-context';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    if (!canAssignTasks(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id } = await params;
    const { assigneeId } = await request.json();

    if (!assigneeId) {
      return NextResponse.json({ error: 'Assignee ID is required' }, { status: 400 });
    }

    const [task] = await db
      .select()
      .from(billingTasks)
      .where(and(eq(billingTasks.id, id), eq(billingTasks.organizationId, organizationId)))
      .limit(1);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!(await verifyUserInOrg(assigneeId, organizationId))) {
      return NextResponse.json(
        { error: 'Assignee not found in your organization' },
        { status: 404 }
      );
    }

    const [assignee] = await db
      .select()
      .from(users)
      .where(eq(users.id, assigneeId))
      .limit(1);

    if (!assignee) {
      return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
    }

    const previousAssignee = task.assignedTo;

    const [updatedTask] = await db
      .update(billingTasks)
      .set({
        assignedTo: assigneeId,
        assignedBy: user.id,
        assignedAt: new Date(),
        status: 'assigned',
        updatedAt: new Date(),
      })
      .where(and(eq(billingTasks.id, id), eq(billingTasks.organizationId, organizationId)))
      .returning();

    if (task.status !== 'assigned') {
      await db.insert(taskStatusHistory).values({
        organizationId,
        taskId: id,
        previousStatus: task.status,
        newStatus: 'assigned',
        changedBy: user.id,
        reason: `Assigned to ${assignee.firstName} ${assignee.lastName}`,
      });
    }

    await createNotification({
      organizationId,
      userId: assigneeId,
      type: 'task_assigned',
      title: 'New Task Assigned',
      message: `You have been assigned: ${task.title}`,
    });

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: 'task_assigned',
      entityType: 'billingTask',
      entityId: id,
      previousValue: { assignedTo: previousAssignee },
      newValue: { assignedTo: assigneeId },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ task: updatedTask });
  } catch (error) {
    console.error('Assign task error:', error);
    return NextResponse.json({ error: 'Failed to assign task' }, { status: 500 });
  }
}
