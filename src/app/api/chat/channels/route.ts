import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { chatChannels, chatMembers, chatMessages, users } from '@/db/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Get channels user is member of
    const memberRows = await db.select({ channelId: chatMembers.channelId }).from(chatMembers).where(eq(chatMembers.userId, user.id));
    const channelIds = memberRows.map(r => r.channelId);

    if (channelIds.length === 0) return NextResponse.json({ channels: [] });

    const channels = await db.select().from(chatChannels).where(inArray(chatChannels.id, channelIds)).orderBy(desc(chatChannels.createdAt));

    const withDetails = await Promise.all(channels.map(async (ch) => {
      // Get member list
      const members = await db.select({ userId: chatMembers.userId, firstName: users.firstName, lastName: users.lastName })
        .from(chatMembers).leftJoin(users, eq(chatMembers.userId, users.id)).where(eq(chatMembers.channelId, ch.id));

      // Get last message
      const [lastMsg] = await db.select({ content: chatMessages.content, createdAt: chatMessages.createdAt, senderId: chatMessages.senderId })
        .from(chatMessages).where(eq(chatMessages.channelId, ch.id)).orderBy(desc(chatMessages.createdAt)).limit(1);

      // Count unread
      const myMembership = await db.select().from(chatMembers).where(and(eq(chatMembers.channelId, ch.id), eq(chatMembers.userId, user.id))).limit(1);
      let unreadCount = 0;
      if (myMembership[0]?.lastReadAt) {
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(chatMessages)
          .where(and(eq(chatMessages.channelId, ch.id), sql`${chatMessages.createdAt} > ${myMembership[0].lastReadAt}`));
        unreadCount = count;
      } else if (myMembership[0]) {
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(chatMessages)
          .where(and(eq(chatMessages.channelId, ch.id), sql`${chatMessages.senderId} <> ${user.id}`));
        unreadCount = count;
      }

      // Display name for direct channels
      let displayName = ch.name;
      if (ch.channelType === 'direct') {
        const other = members.find(m => m.userId !== user.id);
        displayName = other ? `${other.firstName} ${other.lastName}` : ch.name;
      }

      return {
        ...ch,
        displayName,
        members: members.map(m => ({ userId: m.userId, name: m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : 'Unknown' })),
        lastMessage: lastMsg || null,
        unreadCount,
      };
    }));

    return NextResponse.json({ channels: withDetails });
  } catch (error) {
    console.error('Get channels error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name, channelType, department, memberIds } = await request.json();

    if (channelType === 'direct' && memberIds?.length === 1) {
      // Check existing DM
      const myChannels = await db.select({ channelId: chatMembers.channelId }).from(chatMembers).where(eq(chatMembers.userId, user.id));
      for (const mc of myChannels) {
        const [ch] = await db.select().from(chatChannels).where(and(eq(chatChannels.id, mc.channelId), eq(chatChannels.channelType, 'direct'))).limit(1);
        if (ch) {
          const otherMember = await db.select().from(chatMembers).where(and(eq(chatMembers.channelId, ch.id), eq(chatMembers.userId, memberIds[0]))).limit(1);
          if (otherMember.length > 0) return NextResponse.json({ channel: ch });
        }
      }
    }

    const [channel] = await db.insert(chatChannels).values({
      name: name || null, channelType: channelType || 'direct', department, createdBy: user.id,
    }).returning();

    // Add creator as member
    await db.insert(chatMembers).values({ channelId: channel.id, userId: user.id, lastReadAt: new Date() });

    // Add other members
    if (memberIds?.length) {
      for (const memberId of memberIds) {
        if (memberId !== user.id) {
          await db.insert(chatMembers).values({ channelId: channel.id, userId: memberId });
        }
      }
    }

    return NextResponse.json({ channel });
  } catch (error) {
    console.error('Create channel error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
