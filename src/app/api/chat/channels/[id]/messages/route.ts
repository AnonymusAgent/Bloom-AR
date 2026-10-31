import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { chatMessages, chatMembers, users, claims } from '@/db/schema';
import { eq, and, desc, sql, ne } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { createNotification } from '@/lib/notifications';
import { cleanUuid, cleanLimit } from '@/lib/sanitize';

async function verifyChannelMember(channelId: string, userId: string): Promise<boolean> {
  const [membership] = await db
    .select({ id: chatMembers.id })
    .from(chatMembers)
    .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, userId)))
    .limit(1);
  return Boolean(membership);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    if (!(await verifyChannelMember(id, user.id))) {
      return NextResponse.json({ error: 'Forbidden — not a member of this channel' }, { status: 403 });
    }

    const limit = cleanLimit(request.nextUrl.searchParams.get('limit'), 50, 200);
    const before = request.nextUrl.searchParams.get('before');

    const conditions = [eq(chatMessages.channelId, id)];
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

    const withClaims = await Promise.all(
      messages.map(async (m) => {
        let claimInfo = null;
        if (m.relatedClaimId) {
          const [c] = await db
            .select({ claimNumber: claims.claimNumber, patientName: claims.patientName, status: claims.status })
            .from(claims)
            .where(eq(claims.id, m.relatedClaimId))
            .limit(1);
          claimInfo = c;
        }
        return {
          ...m,
          senderName: m.senderFirstName && m.senderLastName ? `${m.senderFirstName} ${m.senderLastName}` : 'Unknown',
          claimInfo,
          hasFile: m.messageType === 'file' && !!m.fileName,
        };
      })
    );

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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    if (!(await verifyChannelMember(id, user.id))) {
      return NextResponse.json({ error: 'Forbidden — not a member of this channel' }, { status: 403 });
    }

    const contentType = request.headers.get('content-type') || '';

    let content = '',
      messageType = 'text',
      fileName: string | undefined,
      fileData: string | undefined,
      fileMimeType: string | undefined,
      relatedClaimId: string | null = null;

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

    if (!content.trim() && !fileData) {
      return NextResponse.json({ error: 'Content required' }, { status: 400 });
    }

    const [msg] = await db
      .insert(chatMessages)
      .values({
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
    const notifTitle = messageType === 'file' ? `${senderName} shared a file` : `New message from ${senderName}`;
    const notifMessage =
      messageType === 'file'
        ? `📎 ${fileName || 'File'}`
        : content.length > 100
        ? content.substring(0, 100) + '...'
        : content;

    for (const member of otherMembers) {
      await createNotification({
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
