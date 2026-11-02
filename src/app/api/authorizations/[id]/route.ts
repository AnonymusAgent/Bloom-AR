import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { authorizations, authDocuments, users } from '@/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import type { User } from '@/db/schema';
import { canViewUser, verifyUserInOrg } from '@/lib/rbac';
import { createAuditLog } from '@/lib/audit';
import { cleanDate, cleanUuid } from '@/lib/sanitize';
import { requireTenantContext } from '@/lib/tenant-context';

async function canAccessAuth(
  user: User,
  authRow: typeof authorizations.$inferSelect,
  organizationId: string,
  isReadOnly: boolean
): Promise<boolean> {
  if (authRow.organizationId !== organizationId) return false;
  if (isReadOnly || ['administrator', 'supervisor', 'manager'].includes(user.role)) return true;
  if (authRow.assignedBy === user.id) return true;
  if (!authRow.assignedTo) return false;
  return canViewUser(user, authRow.assignedTo, organizationId);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authRes = await requireTenantContext();
    if (!authRes.ok) return authRes.response;
    const { ctx } = authRes;
    const { user, organizationId } = ctx;
    const { id } = await params;

    const [auth] = await db
      .select()
      .from(authorizations)
      .where(and(eq(authorizations.id, id), eq(authorizations.organizationId, organizationId)))
      .limit(1);
    if (!auth) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!(await canAccessAuth(user, auth, organizationId, ctx.isReadOnly))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    let assignee = null;
    if (auth.assignedTo) {
      const [u] = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, auth.assignedTo))
        .limit(1);
      assignee = u;
    }

    const docs = await db
      .select({
        id: authDocuments.id,
        fileName: authDocuments.fileName,
        mimeType: authDocuments.mimeType,
        fileSize: authDocuments.fileSize,
        createdAt: authDocuments.createdAt,
      })
      .from(authDocuments)
      .where(and(eq(authDocuments.authId, id), eq(authDocuments.organizationId, organizationId)))
      .orderBy(desc(authDocuments.createdAt));

    return NextResponse.json({ authorization: { ...auth, assignee }, documents: docs });
  } catch (error) {
    console.error('Get authorization error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authRes = await requireTenantContext({ allowMutation: true });
    if (!authRes.ok) return authRes.response;
    const { ctx } = authRes;
    const { user, organizationId } = ctx;
    const { id } = await params;
    const body = await request.json();

    const [existing] = await db
      .select()
      .from(authorizations)
      .where(and(eq(authorizations.id, id), eq(authorizations.organizationId, organizationId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!(await canAccessAuth(user, existing, organizationId, false))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined) {
      updateData.status = body.status;
      if (body.status === 'completed') {
        updateData.completedAt = new Date();
        updateData.completedBy = user.id;
        if (body.authNumber) updateData.authNumber = String(body.authNumber).trim();
        if (body.dateObtained !== undefined) {
          updateData.dateObtained =
            cleanDate(body.dateObtained) || new Date().toISOString().split('T')[0];
        }
      }
    }
    if (body.patientName !== undefined) updateData.patientName = String(body.patientName).trim();
    if (body.insuranceName !== undefined) {
      updateData.insuranceName = String(body.insuranceName).trim();
    }
    if (body.authNumber !== undefined) {
      updateData.authNumber = body.authNumber ? String(body.authNumber).trim() : null;
    }
    if (body.notes !== undefined) updateData.notes = body.notes ? String(body.notes) : null;
    if (body.dateObtained !== undefined && body.status !== 'completed') {
      updateData.dateObtained = cleanDate(body.dateObtained);
    }
    if (body.expirationDate !== undefined) {
      updateData.expirationDate = cleanDate(body.expirationDate);
    }
    if (
      body.assignedTo !== undefined &&
      ['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead'].includes(user.role)
    ) {
      const nextAssignee = cleanUuid(body.assignedTo);
      if (nextAssignee && !(await verifyUserInOrg(nextAssignee, organizationId))) {
        return NextResponse.json(
          { error: 'Assignee not found in your organization' },
          { status: 400 }
        );
      }
      updateData.assignedTo = nextAssignee;
      updateData.assignedBy = user.id;
      updateData.assignedAt = nextAssignee ? new Date() : null;
    }

    const [updated] = await db
      .update(authorizations)
      .set(updateData)
      .where(and(eq(authorizations.id, id), eq(authorizations.organizationId, organizationId)))
      .returning();

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: 'authorization_updated',
      entityType: 'authorization',
      entityId: id,
      previousValue: { status: existing.status },
      newValue: { status: updated.status },
    });

    return NextResponse.json({ authorization: updated });
  } catch (error) {
    console.error('Update authorization error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
