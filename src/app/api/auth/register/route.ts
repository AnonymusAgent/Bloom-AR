import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, organizations, organizationMembers, authTokens, plans, subscriptions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth';
import { slugify, validateSlug, makeToken, hashToken, ensureDefaultPlans } from '@/lib/saas';
import { sendVerificationEmail } from '@/lib/auth-emails';
import { isEmailConfigured } from '@/lib/email';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { ensureSaaSColumns, schemaHint, safeErrorDetail } from '@/lib/db-schema';

export async function POST(req: NextRequest) {
  try {
    const schema = await ensureSaaSColumns();
    if (!schema.ok && schema.missingTables.includes('users')) {
      return NextResponse.json({ error: schemaHint(schema.missingTables), code: 'SCHEMA_NOT_READY' }, { status: 503 });
    }
    const rl = await checkRateLimit(getClientIp(req), 'register');
    if (!rl.allowed) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    const b = await req.json();
    const { firstName, lastName, email, password, organizationName, orgType, country, timezone, planSlug, acceptedTerms } = b;
    if (!firstName || !email || !password || !organizationName) return NextResponse.json({ error: 'Name, email, password and organization name are required' }, { status: 400 });
    if (!acceptedTerms) return NextResponse.json({ error: 'You must accept the Terms of Service and Privacy Policy' }, { status: 400 });
    if (String(password).length < 10) return NextResponse.json({ error: 'Password must be at least 10 characters' }, { status: 400 });
    const normEmail = String(email).toLowerCase().trim();
    const [dup] = await db.select().from(users).where(eq(users.email, normEmail)).limit(1);
    if (dup) return NextResponse.json({ error: 'An account with this email already exists. Sign in or reset your password.' }, { status: 409 });
    let slug = slugify(organizationName);
    if (!validateSlug(slug)) slug = slug + '-' + Math.random().toString(36).slice(2, 6);
    // resolve slug collisions deterministically
    for (let i = 0; i < 20; i++) { const [e] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1); if (!e) break; slug = `${slugify(organizationName)}-${i + 2}`; }
    const allPlans = await ensureDefaultPlans();
    const plan = allPlans.find(p => p.slug === planSlug) || allPlans.find(p => p.slug === 'starter') || allPlans[0];
    const smtpReady = isEmailConfigured();
    const [user] = await db.insert(users).values({ email: normEmail, passwordHash: await hashPassword(password), firstName, lastName: lastName || '', role: 'administrator', accountStatus: smtpReady ? 'pending_verification' : 'active' }).returning();
    const [org] = await db.insert(organizations).values({ name: organizationName, slug, orgType: orgType || null, country: country || null, timezone: timezone || null, ownerUserId: user.id, email: normEmail, subscriptionTier: plan?.slug || 'starter' }).returning();
    await db.insert(organizationMembers).values({ organizationId: org.id, userId: user.id, orgRole: 'owner' });
    if (plan) await db.insert(subscriptions).values({ organizationId: org.id, planId: plan.id, status: 'trialing', trialEnd: new Date(Date.now() + (plan.trialDays || 14) * 864e5) });
    const token = makeToken();
    await db.insert(authTokens).values({ userId: user.id, type: 'email_verification', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 24 * 3600e3) });
    const sent = await sendVerificationEmail(normEmail, token);
    const emailDelivery = !sent.configured ? 'not_configured' : sent.success ? 'accepted_by_provider' : 'failed';
    const message = smtpReady
      ? 'Account created. Verify your email before signing in.'
      : 'Account created. You can sign in now.';
    return NextResponse.json({ success: true, organization: { id: org.id, slug: org.slug }, workspacePath: `/dashboard`, emailDelivery, message }, { status: 201 });
  } catch (e) { console.error('register', e); return NextResponse.json({ error: 'Registration failed', detail: safeErrorDetail(e) }, { status: 500 }); }
}
