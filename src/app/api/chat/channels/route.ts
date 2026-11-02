import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { chatChannels, chatMembers, chatMessages, users } from '@/db/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { verifyUserInOrg } from '@/lib/rbac';
import { cleanUuid } from '@/lib/sanitize';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET(_request: NextRequest) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { user, organizationId } = auth.ctx;

    const memberRows = await db
      .select({ channelId: chatMembers.channelId })
      .from(chatMembers)
      .innerJoin(
        chatChannels,
        and(
          eq(chatChannels.id, chatMembers.channelId),
          eq(chatChannels.organizationId, organizationId)
        )
      )
      .where(eq(chatMembers.userId, user.id));
    const channelIds = memberRows.map((r) => r.channelId);

    if (channelIds.length === 0) return NextResponse.json({ channels: [] });

    const channels = await db
      .select()
      .from(chatChannels)
      .where(
        and(eq(chatChannels.organizationId, organizationId), inArray(chatChannels.id, channelIds))
      )
      .orderBy(desc(chatChannels.createdAt));

    const withDetails = [];
    for (const ch of channels) {
      const members = await db
        .select({
          userId: chatMembers.userId,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(chatMembers)
        .leftJoin(users, eq(chatMembers.userId, users.id))
        .where(eq(chatMembers.channelId, ch.id));

      const [lastMsg] = await db
        .select({
          content: chatMessages.content,
          createdAt: chatMessages.createdAt,
          senderId: chatMessages.senderId,
        })
        .from(chatMessages)
        .where(
          and(eq(chatMessages.channelId, ch.id), eq(chatMessages.organizationId, organizationId))
        )
        .orderBy(desc(chatMessages.createdAt))
        .limit(1);

      const myMembership = await db
        .select()
        .from(chatMembers)
        .where(and(eq(chatMembers.channelId, ch.id), eq(chatMembers.userId, user.id)))
        .limit(1);
      let unreadCount = 0;
      if (myMembership[0]?.lastReadAt) {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(chatMessages)
          .where(
            and(
              eq(chatMessages.channelId, ch.id),
              eq(chatMessages.organizationId, organizationId),
              sql`${chatMessages.createdAt} > ${myMembership[0].lastReadAt}`
            )
          );
        unreadCount = count;
      } else if (myMembership[0]) {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(chatMessages)
          .where(
            and(
              eq(chatMessages.channelId, ch.id),
              eq(chatMessages.organizationId, organizationId),
              sql`${chatMessages.senderId} <> ${user.id}`
            )
          );
        unreadCount = count;
      }

      let displayName = ch.name;
      if (ch.channelType === 'direct') {
        const other = members.find((m) => m.userId !== user.id);
        displayName = other ? `${other.firstName} ${other.lastName}` : ch.name;
      }

      withDetails.push({
        ...ch,
        displayName,
        members: members.map((m) => ({
          userId: m.userId,
          name: m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : 'Unknown',
        })),
        lastMessage: lastMsg || null,
        unreadCount,
      });
    }

    return NextResponse.json({ channels: withDetails });
  } catch (error) {
    console.error('Get channels error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { user, organizationId } = auth.ctx;

    const { name, channelType, department, memberIds } = await request.json();

    // Validate all requested members belong to this organization
    const validMemberIds: string[] = [];
    if (Array.isArray(memberIds)) {
      for (const rawId of memberIds) {
        const mid = cleanUuid(rawId);
        if (!mid || mid === user.id) continue;
        if (!(await verifyUserInOrg(mid, organizationId))) {
          return NextResponse.json(
            { error: 'One or more selected members do not belong to your organization' },
            { status: 403 }
          );
        }
        validMemberIds.push(mid);
      }
    }

    if (channelType === 'direct' && validMemberIds.length === 1) {
      const myChannels = await db
        .select({ channelId: chatMembers.channelId })
        .from(chatMembers)
        .innerJoin(
          chatChannels,
          and(
            eq(chatChannels.id, chatMembers.channelId),
            eq(chatChannels.organizationId, organizationId),
            eq(chatChannels.channelType, 'direct')
          )
        )
        .where(eq(chatMembers.userId, user.id));

      for (const mc of myChannels) {
        const [ch] = await db
          .select()
          .from(chatChannels)
          .where(
            and(
              eq(chatChannels.id, mc.channelId),
              eq(chatChannels.organizationId, organizationId),
              eq(chatChannels.channelType, 'direct')
            )
          )
          .limit(1);
        if (ch) {
          const otherMember = await db
            .select()
            .from(chatMembers)
            .where(
              and(eq(chatMembers.channelId, ch.id), eq(chatMembers.userId, validMemberIds[0]))
            )
            .limit(1);
          if (otherMember.length > 0) return NextResponse.json({ channel: ch });
        }
      }
    }

    const [channel] = await db
      .insert(chatChannels)
      .values({
        organizationId,
        name: name || null,
        channelType: channelType || 'direct',
        department,
        createdBy: user.id,
      })
      .returning();

    await db.insert(chatMembers).values({
      organizationId,
      channelId: channel.id,
      userId: user.id,
      lastReadAt: new Date(),
    });

    for (const memberId of validMemberIds) {
      await db.insert(chatMembers).values({
        organizationId,
        channelId: channel.id,
        userId: memberId,
      });
    }

    return NextResponse.json({ channel });
  } catch (error) {
    console.error('Create channel error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
