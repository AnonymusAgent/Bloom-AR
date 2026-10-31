import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { chatMessages, chatMembers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    const [message] = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, id))
      .limit(1);

    if (!message) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const [membership] = await db
      .select({ id: chatMembers.id })
      .from(chatMembers)
      .where(and(eq(chatMembers.channelId, message.channelId), eq(chatMembers.userId, user.id)))
      .limit(1);

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!message.fileData || !message.fileMimeType) {
      return NextResponse.json({ error: 'No file data' }, { status: 404 });
    }

    const buffer = Buffer.from(message.fileData, 'base64');
    const fileName = message.fileName || 'download';

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': message.fileMimeType,
        'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error) {
    console.error('Download chat file error:', error);
    return NextResponse.json({ error: 'Failed to download file' }, { status: 500 });
  }
}
