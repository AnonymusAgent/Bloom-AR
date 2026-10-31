import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { organizationDomains } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { requireMembership } from '@/lib/tenant';
import { makeToken, hashToken } from '@/lib/saas';
import { cleanUuid } from '@/lib/sanitize';
import { promises as dns } from 'dns';
export async function GET(_r: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params; if (!await requireMembership(user.id, id, ['owner','admin','super_admin'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const rows = await db.select().from(organizationDomains).where(eq(organizationDomains.organizationId, id));
  return NextResponse.json({ domains: rows.map(d=>({...d, verificationTokenHash: undefined, dnsRecord: d.verificationStatus!=='verified' ? { type:'TXT', host:`_bloomar-verify.${d.hostname}`, value:`bloomar-verification=${d.verificationTokenPlain}` } : undefined })) });
}
export async function POST(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params; if (!await requireMembership(user.id, id, ['owner','admin','super_admin'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { hostname, action } = await req.json();
  if (action === 'verify') {
    const [d] = await db.select().from(organizationDomains).where(eq(organizationDomains.hostname, String(hostname).toLowerCase())).limit(1);
    if (!d || d.organizationId !== id) return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
    try {
      const records = await dns.resolveTxt(`_bloomar-verify.${d.hostname}`);
      const flat = records.flat().join(' ');
      if (!flat.includes(`bloomar-verification=${d.verificationTokenPlain}`)) return NextResponse.json({ error: 'Verification TXT record not found yet. DNS can take time to propagate — try again shortly.', verified: false }, { status: 200 });
    } catch { return NextResponse.json({ error: 'Could not resolve DNS for that hostname. Add the TXT record and retry.', verified: false }, { status: 200 }); }
    // Verified by real DNS only — also requires hosting config before we claim HTTPS is live.
    const hostingConfigured = Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);
    await db.update(organizationDomains).set({ verificationStatus: 'verified', verifiedAt: new Date(), hostingStatus: hostingConfigured ? 'configuration_required' : 'manual_configuration_required', tlsStatus: 'pending_hosting_configuration' }).where(eq(organizationDomains.id, d.id));
    return NextResponse.json({ verified: true, message: hostingConfigured ? 'Domain verified. Hosting/HTTPS provisioning still must be confirmed in your hosting provider.' : 'Domain verified. Next step (manual): add this domain in your hosting provider (e.g. Vercel → Project → Domains) so HTTPS is provisioned — see docs/SAAS_SETUP.md.' });
  }
  const host = String(hostname||'').toLowerCase().trim();
  if (!/^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) return NextResponse.json({ error: 'Enter a valid hostname, e.g. billing.example.com' }, { status: 400 });
  const [taken] = await db.select().from(organizationDomains).where(eq(organizationDomains.hostname, host)).limit(1);
  if (taken) return NextResponse.json({ error: 'That hostname is already assigned to an organization' }, { status: 409 });
  const plain = makeToken().slice(0, 32);
  const [d] = await db.insert(organizationDomains).values({ organizationId: id, hostname: host, verificationTokenHash: hashToken(plain), verificationTokenPlain: plain }).returning();
  return NextResponse.json({ domain: d, dnsRecord: { type: 'TXT', host: `_bloomar-verify.${host}`, value: `bloomar-verification=${plain}` } }, { status: 201 });
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params; if (!await requireMembership(user.id, id, ['owner','admin','super_admin'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({} as Record<string, string>));
  const domainId = cleanUuid(req.nextUrl.searchParams.get('domainId') || body.domainId);
  const hostname = (req.nextUrl.searchParams.get('hostname') || body.hostname || '').trim().toLowerCase();
  if (domainId) {
    await db.delete(organizationDomains).where(and(eq(organizationDomains.id, domainId), eq(organizationDomains.organizationId, id)));
  } else if (hostname) {
    await db.delete(organizationDomains).where(and(eq(organizationDomains.hostname, hostname), eq(organizationDomains.organizationId, id)));
  } else {
    return NextResponse.json({ error: 'domainId or hostname required' }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
