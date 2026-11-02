import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { practices, userPracticeAssignments, users, organizationMembers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { canAssignPractices } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { requireTenantContext, mapOrgRoleToOperationalRole } from '@/lib/tenant-context';
import { verifyUserInOrg } from '@/lib/rbac';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    if (!canAssignPractices(ctx.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id } = await params;
    const { userId, responsibilities, isPrimary } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const [practice] = await db
      .select()
      .from(practices)
      .where(and(eq(practices.id, id), eq(practices.organizationId, ctx.organizationId)))
      .limit(1);

    if (!practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 });
    }

    const inOrg = await verifyUserInOrg(userId, ctx.organizationId);
    if (!inOrg) {
      return NextResponse.json(
        { error: 'User does not belong to your organization' },
        { status: 404 }
      );
    }

    const [existingAssignment] = await db
      .select()
      .from(userPracticeAssignments)
      .where(
        and(
          eq(userPracticeAssignments.practiceId, id),
          eq(userPracticeAssignments.userId, userId)
        )
      )
      .limit(1);

    if (existingAssignment) {
      const [updatedAssignment] = await db
        .update(userPracticeAssignments)
        .set({
          organizationId: ctx.organizationId,
          responsibilities: responsibilities || existingAssignment.responsibilities || [],
          isPrimary: isPrimary ?? existingAssignment.isPrimary,
        })
        .where(eq(userPracticeAssignments.id, existingAssignment.id))
        .returning();
      return NextResponse.json({ assignment: updatedAssignment, updated: true });
    }

    const [assignment] = await db
      .insert(userPracticeAssignments)
      .values({
        organizationId: ctx.organizationId,
        userId,
        practiceId: id,
        assignedBy: ctx.user.id,
        responsibilities: responsibilities || [],
        isPrimary: isPrimary || false,
        startDate: new Date().toISOString().split('T')[0],
      })
      .returning();

    await createNotification({
      organizationId: ctx.organizationId,
      userId,
      type: 'practice_assigned',
      title: 'New Practice Assigned',
      message: `You have been assigned to practice: ${practice.name}`,
    });

    await createAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      actorRole: ctx.orgRole,
      action: 'practice_assigned',
      entityType: 'userPracticeAssignment',
      entityId: assignment.id,
      newValue: { practiceId: id, userId, responsibilities },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ assignment });
  } catch (error) {
    console.error('Assign practice error:', error);
    return NextResponse.json({ error: 'Failed to assign practice' }, { status: 500 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const { id } = await params;

    const [practice] = await db
      .select({ id: practices.id })
      .from(practices)
      .where(and(eq(practices.id, id), eq(practices.organizationId, ctx.organizationId)))
      .limit(1);

    if (!practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 });
    }

    const rows = await db
      .select({
        id: userPracticeAssignments.id,
        userId: userPracticeAssignments.userId,
        responsibilities: userPracticeAssignments.responsibilities,
        isPrimary: userPracticeAssignments.isPrimary,
        startDate: userPracticeAssignments.startDate,
        createdAt: userPracticeAssignments.createdAt,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        orgRole: organizationMembers.orgRole,
        operationalRole: organizationMembers.operationalRole,
      })
      .from(userPracticeAssignments)
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.userId, userPracticeAssignments.userId),
          eq(organizationMembers.organizationId, ctx.organizationId),
          eq(organizationMembers.isActive, true)
        )
      )
      .innerJoin(users, eq(userPracticeAssignments.userId, users.id))
      .where(eq(userPracticeAssignments.practiceId, id));

    const assignments = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      responsibilities: r.responsibilities,
      isPrimary: r.isPrimary,
      startDate: r.startDate,
      createdAt: r.createdAt,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      role: mapOrgRoleToOperationalRole(r.orgRole, r.operationalRole),
    }));

    return NextResponse.json({ assignments });
  } catch (error) {
    console.error('Get practice assignments error:', error);
    return NextResponse.json({ error: 'Failed to fetch assignments' }, { status: 500 });
  }
}
