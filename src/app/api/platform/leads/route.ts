import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { leads } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { requirePlatformAdmin } from '@/lib/platform-admin';
const guard = requirePlatformAdmin;
export async function GET() { if (!await guard()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); return NextResponse.json({ leads: await db.select().from(leads).orderBy(desc(leads.createdAt)).limit(200) }); }
export async function PATCH(req: NextRequest) {
  if (!await guard()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id, status } = await req.json();
  if (!id || !['new','contacted','qualified','converted','closed'].includes(status)) return NextResponse.json({ error: 'Valid id and status required' }, { status: 400 });
  await db.update(leads).set({ status }).where(eq(leads.id, id)); return NextResponse.json({ success: true });
}
export async function DELETE(req: NextRequest) {
  if (!await guard()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({} as Record<string, string>));
  const id = req.nextUrl.searchParams.get('id') || body.id;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await db.delete(leads).where(eq(leads.id, id)); return NextResponse.json({ success: true });
}
