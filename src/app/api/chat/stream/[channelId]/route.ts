import { NextRequest } from 'next/server';
import { db } from '@/db';
import { chatChannels, chatMessages, chatMembers, users } from '@/db/schema';
import { eq, and, gt, desc } from 'drizzle-orm';
import { resolveTenantContext } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { channelId } = await params;

  const tenantRes = await resolveTenantContext();
  if (tenantRes.status !== 'ok') {
    const code = tenantRes.status === 'unauthenticated' ? 401 : 403;
    return new Response(code === 401 ? 'Unauthorized' : 'Forbidden', { status: code });
  }
  const { user, organizationId } = tenantRes.ctx;

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
    .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, user.id)))
    .limit(1);
  if (!membership) {
    return new Response('Forbidden', { status: 403 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      let lastChecked = new Date();

      const poll = async () => {
        if (closed) return;

        try {
          const newMessages = await db
            .select({
              id: chatMessages.id,
              content: chatMessages.content,
              messageType: chatMessages.messageType,
              fileName: chatMessages.fileName,
              fileMimeType: chatMessages.fileMimeType,
              relatedClaimId: chatMessages.relatedClaimId,
              createdAt: chatMessages.createdAt,
              senderId: chatMessages.senderId,
              senderFirstName: users.firstName,
              senderLastName: users.lastName,
            })
            .from(chatMessages)
            .leftJoin(users, eq(chatMessages.senderId, users.id))
            .where(
              and(
                eq(chatMessages.channelId, channelId),
                eq(chatMessages.organizationId, organizationId),
                gt(chatMessages.createdAt, lastChecked)
              )
            )
            .orderBy(desc(chatMessages.createdAt))
            .limit(20);

          if (newMessages.length > 0) {
            lastChecked = new Date();
            const formatted = newMessages.reverse().map((m) => ({
              ...m,
              senderName:
                m.senderFirstName && m.senderLastName
                  ? `${m.senderFirstName} ${m.senderLastName}`
                  : 'Unknown',
              hasFile: m.messageType === 'file' && !!m.fileName,
            }));
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'messages', messages: formatted })}\n\n`
              )
            );
          }

          await db
            .update(chatMembers)
            .set({ lastReadAt: new Date() })
            .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, user.id)));
        } catch (e) {
          if (!closed) console.error('SSE poll error:', e);
        }

        if (!closed) {
          setTimeout(poll, 1500);
        }
      };

      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          closed = true;
          clearInterval(heartbeat);
        }
      }, 15000);

      setTimeout(poll, 1500);

      request.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
