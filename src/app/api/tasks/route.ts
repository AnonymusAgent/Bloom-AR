import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { billingTasks, users, practices, taskStatusHistory } from '@/db/schema';
import { eq, and, or, ilike, desc, inArray, gte, lte, sql } from 'drizzle-orm';
import { getCurrentUser, canAssignTasks } from '@/lib/auth';
import { getUserAuthorizedUserIds } from '@/lib/rbac';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { cleanUuid, cleanDate, cleanPage, cleanLimit } from '@/lib/sanitize';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search')?.trim();
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const assignedTo = cleanUuid(searchParams.get('assignedTo'));
    const practiceId = cleanUuid(searchParams.get('practiceId'));
    const page = cleanPage(searchParams.get('page'));
    const limit = cleanLimit(searchParams.get('limit'), 20, 100);

    const conditions = [];

    // Role-based filtering: admins/supervisors/managers see all; team/senior leads see their team; regular users see their own
    const authorizedUsers = await getUserAuthorizedUserIds(user);
    if (authorizedUsers !== 'all') {
      conditions.push(inArray(billingTasks.assignedTo, authorizedUsers));
    }

    if (search) {
      conditions.push(
        or(
          ilike(billingTasks.title, `%${search}%`),
          ilike(billingTasks.patientName, `%${search}%`),
          ilike(billingTasks.authNumber, `%${search}%`),
          ilike(billingTasks.referralNumber, `%${search}%`)
        )
      );
    }

    if (category) {
      conditions.push(eq(billingTasks.category, category as 'prior_authorization' | 'referral_management' | 'verification_of_benefits' | 'charge_entry' | 'payment_posting' | 'custom'));
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

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(billingTasks)
      .where(whereClause);

    // Get tasks
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

    // Get assignee names and practice names
    const tasksWithDetails = await Promise.all(
      tasks.map(async (task) => {
        let assigneeName = null;
        let practiceName = null;

        if (task.assignedTo) {
          const [assignee] = await db
            .select({ firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(eq(users.id, task.assignedTo))
            .limit(1);
          assigneeName = assignee ? `${assignee.firstName} ${assignee.lastName}` : null;
        }

        if (task.practiceId) {
          const [practice] = await db
            .select({ name: practices.name })
            .from(practices)
            .where(eq(practices.id, task.practiceId))
            .limit(1);
          practiceName = practice?.name || null;
        }

        return { ...task, assigneeName, practiceName };
      })
    );

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
    return NextResponse.json(
      { error: 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || !canAssignTasks(user.role)) {
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
      return NextResponse.json(
        { error: 'Title and category are required' },
        { status: 400 }
      );
    }

    const safeAssignedTo = cleanUuid(assignedTo);

    const taskData: typeof billingTasks.$inferInsert = {
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      category,
      priority: priority || 'normal',
      practiceId: cleanUuid(practiceId),
      claimId: cleanUuid(claimId),
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

    const [newTask] = await db
      .insert(billingTasks)
      .values(taskData)
      .returning();

    // Create initial status history
    await db.insert(taskStatusHistory).values({
      taskId: newTask.id,
      newStatus: newTask.status,
      changedBy: user.id,
      reason: 'Task created',
    });

    // Notify assignee
    if (safeAssignedTo) {
      await createNotification({
        userId: safeAssignedTo,
        type: 'task_assigned',
        title: 'New Task Assigned',
        message: `You have been assigned a new ${category.replace('_', ' ')} task: ${title}`,
      });
    }

    await createAuditLog({
      userId: user.id,
      action: 'task_created',
      entityType: 'billingTask',
      entityId: newTask.id,
      newValue: { title, category, assignedTo },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ task: newTask });
  } catch (error) {
    console.error('Create task error:', error);
    return NextResponse.json(
      { error: 'Failed to create task' },
      { status: 500 }
    );
  }
}
