import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { chatChannels, chatMessages, chatMembers, users, claims } from '@/db/schema';
import { eq, and, desc, sql, ne, inArray } from 'drizzle-orm';
import { verifyClaimInOrg } from '@/lib/rbac';
import { createNotification } from '@/lib/notifications';
import { cleanUuid, cleanLimit } from '@/lib/sanitize';
import { requireTenantContext } from '@/lib/tenant-context';

async function verifyOrgChannelMember(
  channelId: string,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const [membership] = await db
    .select({ id: chatMembers.id })
    .from(chatMembers)
    .innerJoin(
      chatChannels,
      and(
        eq(chatChannels.id, chatMembers.channelId),
        eq(chatChannels.organizationId, organizationId)
      )
    )
    .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, userId)))
    .limit(1);
  return Boolean(membership);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { user, organizationId } = auth.ctx;
    const { id } = await params;

    if (!(await verifyOrgChannelMember(id, user.id, organizationId))) {
      return NextResponse.json(
        { error: 'Forbidden — not a member of this channel in your organization' },
        { status: 403 }
      );
    }

    const limit = cleanLimit(request.nextUrl.searchParams.get('limit'), 50, 200);
    const before = request.nextUrl.searchParams.get('before');

    const conditions = [
      eq(chatMessages.channelId, id),
      eq(chatMessages.organizationId, organizationId),
    ];
    if (before) conditions.push(sql`${chatMessages.createdAt} < ${before}`);

    const messages = await db
      .select({
        id: chatMessages.id,
        content: chatMessages.content,
        messageType: chatMessages.messageType,
        fileName: chatMessages.fileName,
        fileMimeType: chatMessages.fileMimeType,
        relatedClaimId: chatMessages.relatedClaimId,
        isEdited: chatMessages.isEdited,
        createdAt: chatMessages.createdAt,
        senderId: chatMessages.senderId,
        senderFirstName: users.firstName,
        senderLastName: users.lastName,
      })
      .from(chatMessages)
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(and(...conditions))
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);

    const claimIds = Array.from(
      new Set(messages.map((m) => m.relatedClaimId).filter((cid): cid is string => Boolean(cid)))
    );
    const claimRows =
      claimIds.length > 0
        ? await db
            .select({
              id: claims.id,
              claimNumber: claims.claimNumber,
              patientName: claims.patientName,
              status: claims.status,
            })
            .from(claims)
            .where(and(eq(claims.organizationId, organizationId), inArray(claims.id, claimIds)))
        : [];
    const claimsMap = new Map(
      claimRows.map((c) => [
        c.id,
        { claimNumber: c.claimNumber, patientName: c.patientName, status: c.status },
      ])
    );

    const withClaims = messages.map((m) => ({
      ...m,
      senderName:
        m.senderFirstName && m.senderLastName
          ? `${m.senderFirstName} ${m.senderLastName}`
          : 'Unknown',
      claimInfo: m.relatedClaimId ? claimsMap.get(m.relatedClaimId) || null : null,
      hasFile: m.messageType === 'file' && !!m.fileName,
    }));

    await db
      .update(chatMembers)
      .set({ lastReadAt: new Date() })
      .where(and(eq(chatMembers.channelId, id), eq(chatMembers.userId, user.id)));

    return NextResponse.json({ messages: withClaims.reverse() });
  } catch (error) {
    console.error('Get messages error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { user, organizationId } = auth.ctx;
    const { id } = await params;

    if (!(await verifyOrgChannelMember(id, user.id, organizationId))) {
      return NextResponse.json(
        { error: 'Forbidden — not a member of this channel in your organization' },
        { status: 403 }
      );
    }

    const contentType = request.headers.get('content-type') || '';

    let content = '';
    let messageType = 'text';
    let fileName: string | undefined;
    let fileData: string | undefined;
    let fileMimeType: string | undefined;
    let relatedClaimId: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      content = (formData.get('content') as string) || '';
      const file = formData.get('file') as File | null;
      relatedClaimId = cleanUuid(formData.get('relatedClaimId'));
      if (file) {
        messageType = 'file';
        fileName = file.name;
        const buffer = Buffer.from(await file.arrayBuffer());
        fileData = buffer.toString('base64');
        fileMimeType = file.type || 'application/octet-stream';
        if (!content) content = `📎 ${fileName}`;
      }
    } else {
      const body = await request.json();
      content = String(body.content || '');
      relatedClaimId = cleanUuid(body.relatedClaimId);
      if (relatedClaimId) messageType = 'claim';
    }

    if (relatedClaimId && !(await verifyClaimInOrg(relatedClaimId, organizationId))) {
      return NextResponse.json(
        { error: 'Referenced claim not found in your organization' },
        { status: 403 }
      );
    }

    if (!content.trim() && !fileData) {
      return NextResponse.json({ error: 'Content required' }, { status: 400 });
    }

    const [msg] = await db
      .insert(chatMessages)
      .values({
        organizationId,
        channelId: id,
        senderId: user.id,
        content,
        messageType,
        fileName,
        fileData,
        fileMimeType,
        relatedClaimId,
      })
      .returning();

    const otherMembers = await db
      .select({ userId: chatMembers.userId })
      .from(chatMembers)
      .where(and(eq(chatMembers.channelId, id), ne(chatMembers.userId, user.id)));

    const senderName = `${user.firstName} ${user.lastName}`;
    const notifTitle =
      messageType === 'file' ? `${senderName} shared a file` : `New message from ${senderName}`;
    const notifMessage =
      messageType === 'file'
        ? `📎 ${fileName || 'File'}`
        : content.length > 100
        ? content.substring(0, 100) + '...'
        : content;

    for (const member of otherMembers) {
      await createNotification({
        organizationId,
        userId: member.userId,
        type: 'system',
        title: notifTitle,
        message: notifMessage,
      });
    }

    return NextResponse.json({
      message: {
        ...msg,
        senderName,
        senderFirstName: user.firstName,
        senderLastName: user.lastName,
        hasFile: messageType === 'file' && !!fileName,
      },
    });
  } catch (error) {
    console.error('Send message error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
