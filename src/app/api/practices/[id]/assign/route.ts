import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { practices, userPracticeAssignments, users } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getCurrentUser, canAssignPractices } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user || !canAssignPractices(user.role)) {
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
      .where(eq(practices.id, id))
      .limit(1);

    if (!practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 });
    }

    const [assignee] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!assignee) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const [existingAssignment] = await db
      .select()
      .from(userPracticeAssignments)
      .where(and(eq(userPracticeAssignments.practiceId, id), eq(userPracticeAssignments.userId, userId)))
      .limit(1);

    if (existingAssignment) {
      const [updatedAssignment] = await db
        .update(userPracticeAssignments)
        .set({
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
        userId,
        practiceId: id,
        assignedBy: user.id,
        responsibilities: responsibilities || [],
        isPrimary: isPrimary || false,
        startDate: new Date().toISOString().split('T')[0],
      })
      .returning();

    // Create notification
    await createNotification({
      userId,
      type: 'practice_assigned',
      title: 'New Practice Assigned',
      message: `You have been assigned to practice: ${practice.name}`,
    });

    await createAuditLog({
      userId: user.id,
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
    return NextResponse.json(
      { error: 'Failed to assign practice' },
      { status: 500 }
    );
  }
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

    const assignments = await db
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
        role: users.role,
      })
      .from(userPracticeAssignments)
      .leftJoin(users, eq(userPracticeAssignments.userId, users.id))
      .where(eq(userPracticeAssignments.practiceId, id));

    return NextResponse.json({ assignments });
  } catch (error) {
    console.error('Get practice assignments error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch assignments' },
      { status: 500 }
    );
  }
}
