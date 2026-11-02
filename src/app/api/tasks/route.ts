import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { billingTasks, users, practices, taskStatusHistory } from '@/db/schema';
import { eq, and, or, ilike, desc, inArray, sql } from 'drizzle-orm';
import { canAssignTasks } from '@/lib/auth';
import {
  getUserAuthorizedUserIds,
  verifyPracticeInOrg,
  verifyClaimInOrg,
  verifyUserInOrg,
} from '@/lib/rbac';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { cleanUuid, cleanDate, cleanPage, cleanLimit } from '@/lib/sanitize';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search')?.trim();
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const assignedTo = cleanUuid(searchParams.get('assignedTo'));
    const practiceId = cleanUuid(searchParams.get('practiceId'));
    const page = cleanPage(searchParams.get('page'));
    const limit = cleanLimit(searchParams.get('limit'), 20, 100);

    const conditions = [eq(billingTasks.organizationId, organizationId)];

    if (!ctx.isReadOnly && !['administrator', 'supervisor', 'manager'].includes(user.role)) {
      const authorizedUsers = await getUserAuthorizedUserIds(user, organizationId);
      if (authorizedUsers.length > 0) {
        conditions.push(inArray(billingTasks.assignedTo, authorizedUsers));
      } else {
        conditions.push(eq(billingTasks.assignedTo, user.id));
      }
    }

    if (search) {
      conditions.push(
        or(
          ilike(billingTasks.title, `%${search}%`),
          ilike(billingTasks.patientName, `%${search}%`),
          ilike(billingTasks.authNumber, `%${search}%`),
          ilike(billingTasks.referralNumber, `%${search}%`)
        )!
      );
    }

    if (category) {
      conditions.push(
        eq(
          billingTasks.category,
          category as
            | 'prior_authorization'
            | 'referral_management'
            | 'verification_of_benefits'
            | 'charge_entry'
            | 'payment_posting'
            | 'custom'
        )
      );
    }

    if (status) {
      const statuses = status.split(',') as Array<typeof billingTasks.status.enumValues[number]>;
      conditions.push(inArray(billingTasks.status, statuses));
    }

    if (assignedTo) {
      conditions.push(eq(billingTasks.assignedTo, assignedTo));
    }

    if (practiceId) {
      conditions.push(eq(billingTasks.practiceId, practiceId));
    }

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(billingTasks)
      .where(whereClause);

    const tasks = await db
      .select({
        id: billingTasks.id,
        title: billingTasks.title,
        description: billingTasks.description,
        category: billingTasks.category,
        status: billingTasks.status,
        priority: billingTasks.priority,
        practiceId: billingTasks.practiceId,
        patientName: billingTasks.patientName,
        insuranceName: billingTasks.insuranceName,
        authNumber: billingTasks.authNumber,
        referralNumber: billingTasks.referralNumber,
        serviceDate: billingTasks.serviceDate,
        dueDate: billingTasks.dueDate,
        assignedTo: billingTasks.assignedTo,
        assignedAt: billingTasks.assignedAt,
        createdAt: billingTasks.createdAt,
        updatedAt: billingTasks.updatedAt,
      })
      .from(billingTasks)
      .where(whereClause)
      .orderBy(desc(billingTasks.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const assigneeIds = Array.from(
      new Set(tasks.map((t) => t.assignedTo).filter((id): id is string => Boolean(id)))
    );
    const practiceIds = Array.from(
      new Set(tasks.map((t) => t.practiceId).filter((id): id is string => Boolean(id)))
    );

    const userRows =
      assigneeIds.length > 0
        ? await db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(inArray(users.id, assigneeIds))
        : [];
    const practiceRows =
      practiceIds.length > 0
        ? await db
            .select({ id: practices.id, name: practices.name })
            .from(practices)
            .where(
              and(eq(practices.organizationId, organizationId), inArray(practices.id, practiceIds))
            )
        : [];

    const namesMap = new Map(userRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const practicesMap = new Map(practiceRows.map((p) => [p.id, p.name]));

    const tasksWithDetails = tasks.map((task) => ({
      ...task,
      assigneeName: task.assignedTo ? namesMap.get(task.assignedTo) || null : null,
      practiceName: task.practiceId ? practicesMap.get(task.practiceId) || null : null,
    }));

    return NextResponse.json({
      tasks: tasksWithDetails,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error('Get tasks error:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    if (!canAssignTasks(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const {
      title,
      description,
      category,
      priority,
      practiceId,
      claimId,
      patientName,
      patientDob,
      insuranceName,
      memberId,
      serviceDate,
      dueDate,
      assignedTo,
    } = body;

    if (!title || !category) {
      return NextResponse.json({ error: 'Title and category are required' }, { status: 400 });
    }

    const safeAssignedTo = cleanUuid(assignedTo);
    const safePracticeId = cleanUuid(practiceId);
    const safeClaimId = cleanUuid(claimId);

    if (safePracticeId && !(await verifyPracticeInOrg(safePracticeId, organizationId))) {
      return NextResponse.json(
        { error: 'Practice not found in your organization' },
        { status: 400 }
      );
    }
    if (safeClaimId && !(await verifyClaimInOrg(safeClaimId, organizationId))) {
      return NextResponse.json({ error: 'Claim not found in your organization' }, { status: 400 });
    }
    if (safeAssignedTo && !(await verifyUserInOrg(safeAssignedTo, organizationId))) {
      return NextResponse.json(
        { error: 'Assignee not found in your organization' },
        { status: 400 }
      );
    }

    const taskData: typeof billingTasks.$inferInsert = {
      organizationId,
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      category,
      priority: priority || 'normal',
      practiceId: safePracticeId,
      claimId: safeClaimId,
      patientName: patientName ? String(patientName).trim() : null,
      patientDob: cleanDate(patientDob),
      insuranceName: insuranceName ? String(insuranceName).trim() : null,
      memberId: memberId ? String(memberId).trim() : null,
      serviceDate: cleanDate(serviceDate),
      dueDate: cleanDate(dueDate),
      status: safeAssignedTo ? 'assigned' : 'new',
      assignedTo: safeAssignedTo,
      assignedBy: safeAssignedTo ? user.id : undefined,
      assignedAt: safeAssignedTo ? new Date() : undefined,
    };

    const [newTask] = await db.insert(billingTasks).values(taskData).returning();

    await db.insert(taskStatusHistory).values({
      organizationId,
      taskId: newTask.id,
      newStatus: newTask.status,
      changedBy: user.id,
      reason: 'Task created',
    });

    if (safeAssignedTo) {
      await createNotification({
        organizationId,
        userId: safeAssignedTo,
        type: 'task_assigned',
        title: 'New Task Assigned',
        message: `You have been assigned a new ${category.replace('_', ' ')} task: ${title}`,
      });
    }

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: 'task_created',
      entityType: 'billingTask',
      entityId: newTask.id,
      newValue: { title, category, assignedTo: safeAssignedTo },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ task: newTask });
  } catch (error) {
    console.error('Create task error:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
