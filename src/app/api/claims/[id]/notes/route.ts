import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, claimNotes } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
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

    const { id } = await params;
    const { note, actionPerformed } = await request.json();

    if (!note || note.trim() === '') {
      return NextResponse.json({ error: 'Note content is required' }, { status: 400 });
    }

    const [claim] = await db
      .select()
      .from(claims)
      .where(and(eq(claims.id, id), eq(claims.organizationId, organizationId)))
      .limit(1);

    if (!claim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    if (
      ['ar_executive', 'billing_user'].includes(user.role) &&
      claim.assignedTo !== user.id
    ) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [newNote] = await db
      .insert(claimNotes)
      .values({
        organizationId,
        claimId: id,
        userId: user.id,
        note: note.trim(),
        actionPerformed,
      })
      .returning();

    if (claim.status === 'assigned') {
      await db
        .update(claims)
        .set({ status: 'in_progress', updatedAt: new Date() })
        .where(and(eq(claims.id, id), eq(claims.organizationId, organizationId)));
    }

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: AUDIT_ACTIONS.CLAIM_NOTE_ADDED,
      entityType: 'claim',
      entityId: id,
      newValue: { note: note.trim(), actionPerformed },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      note: {
        ...newNote,
        userName: `${user.firstName} ${user.lastName}`,
      },
    });
  } catch (error) {
    console.error('Add note error:', error);
    return NextResponse.json({ error: 'Failed to add note' }, { status: 500 });
  }
}
