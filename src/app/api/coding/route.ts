import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  codingRequests,
  claims,
  users,
  practices,
  codingDocuments,
  claimDocuments,
  claimStatusHistory,
} from '@/db/schema';
import { eq, and, desc, inArray, or, sql } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { getUserAuthorizedPracticeIds, getUserAuthorizedUserIds } from '@/lib/rbac';
import { createAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { cleanUuid } from '@/lib/sanitize';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = request.nextUrl.searchParams;
    const status = sp.get('status');
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '20', 10) || 20));

    const conditions = [];
    if (status) {
      conditions.push(
        eq(
          codingRequests.status,
          status as 'sent_to_coding' | 'under_review' | 'corrected' | 'returned_to_billing' | 'resubmitted'
        )
      );
    }

    if (!isSupervisorOrAbove(user.role)) {
      const authPractices = await getUserAuthorizedPracticeIds(user);
      const authUsers = await getUserAuthorizedUserIds(user);
      const vis = [];
      if (authUsers !== 'all' && authUsers.length > 0) {
        vis.push(inArray(codingRequests.sentBy, authUsers));
        vis.push(inArray(codingRequests.assignedTo, authUsers));
      }
      if (authPractices !== 'all' && authPractices.length > 0) {
        vis.push(inArray(claims.practiceId, authPractices));
      }
      if (vis.length === 0) {
        return NextResponse.json({ codingRequests: [], pagination: { page, limit, total: 0, totalPages: 1 } });
      }
      conditions.push(or(...vis)!);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(codingRequests)
      .leftJoin(claims, eq(codingRequests.claimId, claims.id))
      .where(whereClause);

    const rows = await db
      .select({
        id: codingRequests.id,
        claimId: codingRequests.claimId,
        status: codingRequests.status,
        denialReason: codingRequests.denialReason,
        comments: codingRequests.comments,
        correctionNotes: codingRequests.correctionNotes,
        createdAt: codingRequests.createdAt,
        updatedAt: codingRequests.updatedAt,
        sentBy: codingRequests.sentBy,
        assignedTo: codingRequests.assignedTo,
        claimNumber: claims.claimNumber,
        patientName: claims.patientName,
        practiceId: claims.practiceId,
      })
      .from(codingRequests)
      .leftJoin(claims, eq(codingRequests.claimId, claims.id))
      .where(whereClause)
      .orderBy(desc(codingRequests.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const userIds = Array.from(
      new Set(rows.flatMap((r) => [r.sentBy, r.assignedTo].filter((uid): uid is string => Boolean(uid))))
    );
    const practiceIds = Array.from(
      new Set(rows.map((r) => r.practiceId).filter((pid): pid is string => Boolean(pid)))
    );

    const [userRows, practiceRows] = await Promise.all([
      userIds.length > 0
        ? db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(inArray(users.id, userIds))
        : Promise.resolve([]),
      practiceIds.length > 0
        ? db
            .select({ id: practices.id, name: practices.name, code: practices.code })
            .from(practices)
            .where(inArray(practices.id, practiceIds))
        : Promise.resolve([]),
    ]);

    const userMap = new Map(userRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const practiceMap = new Map(practiceRows.map((p) => [p.id, `${p.code} — ${p.name}`]));

    const withNames = rows.map((r) => ({
      ...r,
      senderName: userMap.get(r.sentBy) || 'Unknown',
      assigneeName: r.assignedTo ? userMap.get(r.assignedTo) || null : null,
      practiceName: r.practiceId ? practiceMap.get(r.practiceId) || null : null,
    }));

    return NextResponse.json({
      codingRequests: withNames,
      pagination: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) },
    });
  } catch (error) {
    console.error('Get coding requests error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const claimId = cleanUuid(body.claimId);
    const assignedTo = cleanUuid(body.assignedTo);
    const { denialReason, comments } = body;
    if (!claimId) return NextResponse.json({ error: 'Valid Claim ID required' }, { status: 400 });

    const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    const [codingReq] = await db
      .insert(codingRequests)
      .values({
        claimId,
        denialReason: denialReason || claim.denialReason || null,
        comments,
        sentBy: user.id,
        assignedTo,
      })
      .returning();

    await db
      .update(claims)
      .set({ status: 'sent_to_coding', updatedAt: new Date() })
      .where(eq(claims.id, claimId));
    await db.insert(claimStatusHistory).values({
      claimId,
      previousStatus: claim.status,
      newStatus: 'sent_to_coding',
      changedBy: user.id,
      reason: 'Sent to coding team',
    });

    const claimDocs = await db.select().from(claimDocuments).where(eq(claimDocuments.claimId, claimId));
    for (const doc of claimDocs) {
      await db.insert(codingDocuments).values({
        codingRequestId: codingReq.id,
        documentType: doc.documentType,
        fileName: doc.fileName,
        fileData: doc.fileData,
        mimeType: doc.mimeType,
        uploadedBy: user.id,
      });
    }

    if (assignedTo) {
      await createNotification({
        userId: assignedTo,
        type: 'task_assigned',
        title: 'Coding Request',
        message: `Claim ${claim.claimNumber} needs coding review`,
      });
    }

    await createAuditLog({
      userId: user.id,
      action: 'sent_to_coding',
      entityType: 'codingRequest',
      entityId: codingReq.id,
      newValue: { claimId, claimNumber: claim.claimNumber },
    });

    return NextResponse.json({ codingRequest: codingReq });
  } catch (error) {
    console.error('Create coding request error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
