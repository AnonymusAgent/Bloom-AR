import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { billingInvoices, plans } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { requireMembership } from '@/lib/tenant';
import { getEntitlements, ensureDefaultPlans } from '@/lib/saas';
import { resolveTenantContext } from '@/lib/tenant-context';
import { cleanUuid } from '@/lib/sanitize';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let orgId = cleanUuid(req.nextUrl.searchParams.get('organizationId'));
  if (orgId) {
    if (!(await requireMembership(user.id, orgId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else {
    const resolved = await resolveTenantContext();
    if (resolved.status !== 'ok') {
      return NextResponse.json({ error: 'No active organization' }, { status: 403 });
    }
    orgId = resolved.ctx.organizationId;
  }

  const allPlans = await ensureDefaultPlans();
  const entitlements = await getEntitlements(orgId);
  const invoices = await db
    .select()
    .from(billingInvoices)
    .where(eq(billingInvoices.organizationId, orgId))
    .orderBy(desc(billingInvoices.createdAt))
    .limit(25);

  return NextResponse.json({
    entitlements,
    plans: allPlans.filter((p) => p.isActive),
    invoices,
    paymentsConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
  });
}
