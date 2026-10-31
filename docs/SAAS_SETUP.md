# BloomAR Manager SaaS — Architecture, Setup & Launch Checklist

## 1. Original architecture (audit summary)
Next.js 16 App Router + React 19 + TypeScript, Tailwind 4, PostgreSQL (Neon-compatible) via Drizzle ORM, custom JWT sessions (jose, HTTP-only cookie, DB-backed `sessions`), bcrypt password hashing, DB rate limiting, RBAC (7 roles), SSE chat, Nodemailer SMTP, 40+ tables / 57+ API routes. Existing `organizations` + `organization_members` existed but there was no public registration, email verification, plans/subscriptions, custom domains, marketing site, or platform admin. Root `/` redirected to `/login`. Full prior audit: `audit.md`.

## 2. Changes made (this implementation)
- **Schema (migration `drizzle/0003_saas_platform.sql`, non-destructive):** new `plans`, `subscriptions`, `organization_domains`, `organization_invitations`, `auth_tokens`, `leads`, `processed_webhooks`; `users.email_verified_at/is_platform_admin/account_status`; `organizations.org_type/country/timezone/owner_user_id/status/onboarding_*`; nullable `organization_id` on `claims/practices/patients` (legacy rows stay NULL = unassigned, **never** auto-given to a new registrant — reconcile manually).
- **Auth:** `POST /api/auth/register` (creates user + org + owner membership + trial subscription + hashed, expiring, single-use verification token), verify/resend, forgot/reset (reset revokes all sessions), login blocks `pending_verification`/`suspended`. Legacy seeded users keep `account_status='active'` so existing logins don't break.
- **Tenancy:** `src/lib/tenant.ts` deny-by-default membership checks; `resolveTenantByHostname` (verified custom domain, or `<slug>.<NEXT_PUBLIC_ROOT_DOMAIN>`); public branding-only `GET /api/tenant?host=`. **Slug/hostname alone is never authorization** — session + membership still required.
- **Domains:** add hostname → unique TXT challenge (`_bloomar-verify.<host>`), `verify` does a real `dns.resolveTxt` lookup. A domain is never marked active on entry alone.
- **Team:** invitations (hashed token, 7-day expiry, role-escalation guard, seat-limit entitlement check, accept creates account or links existing).
- **Billing:** plans in DB (`ensureDefaultPlans` seeds Starter/Professional/Enterprise; platform-admin editable via `PUT /api/platform/plans`). Stripe Checkout created server-side; webhook verifies HMAC signature and is idempotent (`processed_webhooks`); **subscriptions activate only from webhooks, never from a success redirect**. Without `STRIPE_SECRET_KEY` checkout honestly returns 503 — no fake payments.
- **Platform admin:** `/admin/platform` + `/api/platform/*` gated on `users.is_platform_admin` (separate from org admin; does not grant PHI access). Suspend/reactivate requires a recorded reason and writes an audit log.
- **Website:** `/` marketing home, `/features`, `/pricing` (live plans from DB), `/about`, `/contact` (leads stored, honeypot), `/faq`, `/legal/{terms,privacy,subscription,cookies,dpa,baa}` templates, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/onboarding`, `/settings/organization`, `/settings/billing`. Existing app URLs and features are untouched.

## 3. Environment variables
See `.env.example`. Required: `DATABASE_URL` (and optionally `DATABASE_URL_POOLED` for Neon's `-pooler` endpoint), `JWT_SECRET`. Neon `?sslmode=require&channel_binding=require` URLs are supported automatically (`NEON_AUTH_BASE_URL` and `NEON_REALTIME_*` are not used). Remove any stale `NEON_DATABASE_URL` when switching databases. For real email: `SMTP_*`. For checkout: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` + Stripe price IDs per plan. For domains: `NEXT_PUBLIC_ROOT_DOMAIN`, DNS wildcard, hosting domain add.

## 4. Migration & rollback
Run `npm run db:migrate` (or apply `drizzle/0003_saas_platform.sql`) against staging first, back up production, then deploy. Rollback SQL is commented at the bottom of the migration file — dropping the new tables/columns does not touch existing data.

## 5. Custom domain go-live (manual steps that cannot be done from code)
1. Org owner adds domain in Organization Settings and publishes the TXT record.
2. Clicks **Verify DNS** (real lookup must pass).
3. Operator/org adds the same hostname in the hosting provider (e.g. Vercel → Project → Settings → Domains) and, for subdomains of the app domain, configures wildcard DNS `*.your-domain` → deployment. Until this is done the domain shows `manual_configuration_required` / TLS `pending_hosting_configuration` — by design we don't claim HTTPS is live.

## 6. Payments go-live
Create products/prices in Stripe, put price IDs on plans (platform admin API), set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, point Stripe webhook to `/api/subscriptions/webhook`, test with Stripe test cards + duplicate-webhook replay.

## 7. Make a platform admin
`UPDATE users SET is_platform_admin = true WHERE email = 'you@example.com';` (deliberately not self-service.)

## 8. Known limitations / external configuration still required
- No live SMTP, Stripe, or DNS/hosting configured in this environment — registration, verification, invites and checkout are implemented but report `not_configured` honestly until keys are set.
- Existing AR tables beyond claims/practices/patients are not yet org-scoped; org scoping is enforced for new SaaS surfaces (orgs, domains, invitations, billing). Extend `organization_id` scoping module-by-module before marketing strict isolation for those modules, and backfill only via manual reconciliation.
- MFA, SSO, and automated Vercel domain provisioning are not implemented (APIs/templates are ready for them).
- Legal pages are templates requiring counsel review. No HIPAA-compliance claim is made.

## 9. Security & launch checklist
- [ ] Rotate any dev credentials; disable `/api/seed` in production; set strong `JWT_SECRET`
- [ ] Backups + restore test; staging migration rehearsal
- [ ] Configure SMTP, Stripe (test then live), wildcard DNS + custom-domain hosting
- [ ] `npm run typecheck && npm run build`, `node tests/saas-unit.test.mjs`
- [ ] Two-org cross-tenant test with real DB: register Org A and Org B, confirm B cannot read A's domains/invitations/billing via direct API calls
- [ ] Legal review of Terms/Privacy/DPA/BAA; incident-response & retention policy documented

## 10. Platform Admin — Website Manager (`/admin/platform`)
Requires `users.is_platform_admin = true`. Tabs:
- **Overview** — org/user/trial/subscription/domain metrics and shortcuts.
- **Website** — edits everything public visitors see, stored in `site_settings` (migration `0004_site_settings.sql`): brand/tagline/support contacts, announcement banner, homepage hero CTAs, feature cards, About/Roadmap, FAQs, all legal pages, SEO title/description. Saving publishes immediately (marketing pages are `force-dynamic` and read through `GET /api/site`). Changes are audit-logged as `site_content_updated`.
- **Plans & Pricing** — create/edit/disable plans, $ prices, trial days, feature lists, seat/usage limits (JSON) and Stripe price IDs. Edits drive `/pricing` and checkout. Disable is a soft-disable so existing subscriptions keep working.
- **Organizations** — suspend/reactivate with a mandatory audit-logged reason.
- **Users** — search all users; activate/deactivate (deactivation revokes sessions), grant/remove platform admin, revoke sessions, mark email verified. You cannot modify your own platform account from here.
- **Leads Inbox** — contact/sales/demo submissions from `/contact` with status workflow and delete.
- **Domains & System** — custom-domain verification/hosting/TLS status and integration configuration status (booleans only; secrets are never displayed).

## 11. Account Settings (`/settings/account`)
For every signed-in user (linked from the sidebar, next to Profile / Organization Settings / Billing):
- **Profile** — first/last name, phone, avatar URL (email is the sign-in identity).
- **Security & Sessions** — change password, list active sessions (tokens never exposed), sign out individual devices or all other devices (`/api/account/sessions`).
- **Preferences** — date format, timezone, page size (same sanitized preferences store as `/profile`).
- **My Organizations** — memberships with links to Organization Settings, Billing and Onboarding.

## 12. Granting platform-admin access (no credentials in source code)
Pick **one** method — real emails/passwords must never be committed:
1. **Hosting env allowlist (recommended):** set `PLATFORM_ADMIN_EMAILS=you@example.com` (comma-separated) in Vercel env vars and redeploy. Signing in with a listed email authorizes `/admin/platform` immediately and permanently promotes that user (`users.is_platform_admin=true`), after which the env var can be removed.
2. **Bootstrap script:** with `DATABASE_URL`, `PLATFORM_ADMIN_EMAIL`, and optionally `PLATFORM_ADMIN_TEMP_PASSWORD` set only in your shell/hosting env, run `npm run bootstrap:admin`. It creates or promotes the admin, stores only a bcrypt hash, marks the account verified/active, and revokes old sessions after a password reset. Change any temporary password at first sign-in (Account Settings → Security & Sessions).
3. **Direct SQL:** `UPDATE users SET is_platform_admin=true WHERE email='<your email>';` in your database console.

## 13. AI Denial Analysis — bugs fixed
- **Misclassification (root cause):** the matcher OR-ed the code's CARC category with broad substrings (`procedure`, `coverage`, `benefit`, `invalid`…) found in claim *notes/history*. A Timely Filing or Bundling code could be classified as Coding/Eligibility by an unrelated note. The engine (`src/lib/denial-analysis.ts`) is now **category-first**: the code's category decides the branch; free text is only a specific-first, word-boundary fallback when no category exists. Contractual adjustments (49 codes) now reach the contractual branch instead of "General".
- **Paid claims treated as denied:** any claim with stale `denialCodeId`/`denialReason` counted as denied. Paid/closed/approved claims are now excluded (claim detail page aligned too).
- **Blank recommended actions:** the API stored `string[]` while the AI page rendered `{action, priority, successRate}` objects — showing empty rows and "% success rate". The API now stores structured actions and the page normalizes legacy string rows.
- **Dead historical learning:** the engine looked for `status='resolved'` outcomes that nothing could ever create. `PATCH /api/ai-analysis` now records outcomes (`recovered`, `paid`, `partially_recovered`, `written_off`, `no_recovery`), the AI page has "Record outcome" buttons, and historical success rates only display when real resolved history exists (no invented percentages).
- **Robustness:** invalid JSON / malformed claim IDs returned 500s (now 400), pagination `page`/`limit` is clamped (1–100), and the AI page shows a real error + Retry state instead of silently claiming "No analyses yet".
- Regression tests: `node tests/denial-analysis.test.mjs` (10 checks against the real engine).

## 14. Troubleshooting: "An error occurred during login" / "Seed failed" / Switching Neon Databases
`/api/health` reports database reachability and schema readiness without exposing secrets. When switching to a brand-new empty Neon database in Vercel (setting `DATABASE_URL` and optionally `DATABASE_URL_POOLED`), hitting `/api/health`, `/login` (or **Seed Database**), or `/register` **automatically bootstraps the full Drizzle schema (`0000`–`0004`)** on first request using an idempotent direct connection and PostgreSQL advisory lock — no local CLI step required (though `npm run db:migrate` also runs all migrations idempotently and verifies core tables). Seed is idempotent: re-running reactivates demo users (passwords are not reset) and a single bad denial code no longer aborts the whole seed.
