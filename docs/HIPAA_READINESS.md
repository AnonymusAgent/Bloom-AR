# HIPAA Security & Multi-Tenant Readiness Guide

> **Important Compliance Disclaimer**
> Software controls alone **do not** make an organization "HIPAA compliant." Under the HIPAA Security Rule (45 CFR Part 160 and Subparts A and C of Part 164), compliance requires a combination of **Technical Safeguards**, **Administrative Safeguards**, **Physical Safeguards**, **Organizational Requirements (signed Business Associate Agreements — BAAs)**, and documented **Policies, Procedures, and Security Risk Analyses**.
>
> This document outlines the technical controls implemented in BloomAR Manager and the remaining operational, contractual, and administrative responsibilities required before processing real Protected Health Information (ePHI) in production.

---

## 1. Technical Safeguards Implemented in BloomAR Manager

### 1.1 Strict Multi-Tenant Data Isolation (`45 CFR §164.312(a)(1)`)
- **Mandatory Tenant Ownership**: All 28 operational tables (`practices`, `user_practice_assignments`, `patients`, `uploaded_files`, `claims`, `claim_notes`, `claim_status_history`, `claim_documents`, `payments`, `payment_allocations`, `era_files`, `era_transactions`, `denial_analyses`, `billing_tasks`, `task_notes`, `task_documents`, `task_status_history`, `signoffs`, `authorizations`, `auth_documents`, `coding_requests`, `coding_documents`, `chat_channels`, `chat_members`, `chat_messages`, `ocr_scans`, `e_signatures`, and `notifications`) carry an explicit `organization_id` foreign key referencing `organizations(id)`.
- **Server-Bound Active Workspace**: Every authenticated session (`sessions.active_organization_id`) is bound server-side to a verified, active membership in `organization_members`. Client-supplied query parameters cannot override the tenant boundary on operational routes.
- **Cross-Entity Ownership Validation**: Mutations that link records (e.g., assigning a claim to a user, linking a claim to a practice, posting payments/ERAs against claims, attaching chat claims, or applying OCR scans) verify that all referenced entities belong to the caller's active `organization_id`.
- **PostgreSQL Row-Level Security (RLS)**: Migration `0006_multi_tenant_isolation.sql` enables `ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` across all 28 operational tables, paired with `withTenantRls(organizationId, fn)` (`SET LOCAL app.enforce_rls = 'on'; SET LOCAL app.current_org_id = '<uuid>'`) for kernel-enforced defense-in-depth alongside explicit Drizzle ORM `eq(table.organizationId, ctx.organizationId)` predicates.
- **Platform Admin Separation from Tenant PHI**: `users.is_platform_admin` is decoupled from customer workspaces. Platform administration routes (`/api/platform/*`) expose only SaaS workspace metadata, subscriptions, domains, and account status — never claims, patients, or clinical documents.

### 1.2 Access Control & Least Privilege (`45 CFR §164.312(a)(1)`)
- **Organization-Scoped RBAC**: Each `organization_members` row defines both a SaaS workspace role (`owner`, `admin`, `billing_manager`, `billing_specialist`, `ar_specialist`, `read_only`) and an operational workflow role (`administrator`, `supervisor`, `manager`, `senior_lead`, `team_lead`, `ar_executive`, `billing_user`).
- **Read-Only Enforcement**: Members with `orgRole = 'read_only'` are blocked server-side (`403 READ_ONLY_ACCESS`) on all mutating endpoints via `requireTenantContext({ allowMutation: true })`.
- **Suspended Workspace Blocking**: Suspended organizations (`organizations.status = 'suspended'`) are immediately blocked from operational APIs (`403 ORGANIZATION_SUSPENDED`) without relying on client-side checks.

### 1.3 Person or Entity Authentication (`45 CFR §164.312(d)`)
- **Password Hashing**: Passwords are hashed with `bcrypt` (cost factor 12).
- **TOTP Multi-Factor Authentication (MFA)**: RFC 6238 SHA-1 6-digit TOTP authenticator enrollment, AES-256-GCM secret encryption at rest (`MFA_ENCRYPTION_KEY` / derived key), and SHA-256 hashed one-time recovery codes (`/api/account/mfa` and `/api/auth/login`).
- **Session Controls (`45 CFR §164.312(a)(2)(iii)`)**: Unique JWT `jti` per session, server-side session revocation (`/api/account/sessions`), 8-hour server idle timeout, 7-day absolute session lifetime, and configurable client inactivity auto-logoff (`SessionGuard`).
- **Scoped API Keys**: External `/api/v1/*` keys are SHA-256 hashed at rest, bound to a single `organization_id`, and enforce explicit scopes (`claims:read`).

### 1.4 Audit Controls (`45 CFR §164.312(b)`)
- **Tenant-Scoped Audit Trail**: Authentication events, MFA changes, workspace switches, user/role updates, claim workflow transitions, document uploads, payment/ERA postings, and coding edits write structured records to `audit_logs` tagged with `organization_id`, `user_id`, `actor_role`, IP address, and user agent.
- **Tenant Isolation of Audit Logs**: `/api/audit-logs` and `/api/export?type=audit_logs` strictly filter by `eq(auditLogs.organizationId, ctx.organizationId)`.

---

## 2. Remaining Operator & Organizational Requirements Before Using Real ePHI

Deploying this codebase **does not** by itself satisfy HIPAA. Before ingesting real patient data, the operating entity (Covered Entity or Business Associate) **must** complete all of the following:

1. **Signed Business Associate Agreements (BAAs) (`45 CFR §164.308(b)(1)`)**:
   - Execute HIPAA BAAs with your cloud hosting provider (e.g., Vercel Enterprise w/ HIPAA BAA or AWS/GCP/Azure HIPAA-eligible infrastructure), managed PostgreSQL provider (e.g., Neon HIPAA plan / AWS RDS with BAA), transactional email provider (SMTP/SES with BAA — **never** transmit unencrypted PHI in email digests), and any external OCR/AI vendor if connected.
   - Note: Stripe processes subscription billing metadata and generally should **never** receive patient PHI.
2. **Encryption & Key Management (`45 CFR §164.312(a)(2)(iv)`, `§164.312(e)(1)`)**:
   - Enforce TLS 1.2+ on all public and database connections (`sslmode=require`).
   - Provision dedicated high-entropy secrets in a managed KMS/secret store for `JWT_SECRET` and `MFA_ENCRYPTION_KEY`, with documented key rotation procedures.
   - Store large clinical attachments (EOBs, medical records, ERA files) in BAA-covered encrypted object storage (e.g., S3 with SSE-KMS) rather than base64 database columns for high-volume production workloads, and enable encrypted-at-rest database volumes and backups.
3. **Database Least-Privilege Role for PostgreSQL RLS**:
   - Ensure the runtime `DATABASE_URL` connects as a non-superuser role without `BYPASSRLS`, and route operational queries through `withTenantRls(organizationId, ...)` when strict database-role enforcement is required alongside application-layer predicates.
4. **Administrative & Physical Safeguards (`45 CFR §164.308`, `§164.310`)**:
   - Designate a HIPAA Security Officer and Privacy Officer.
   - Conduct and document a formal **Security Risk Analysis (SRA)** (`§164.308(a)(1)(ii)(A)`) and remediation plan.
   - Establish workforce HIPAA training, background checks, workstation security policies, minimum-necessary access reviews, and sanctions policies.
   - Maintain a documented **Contingency / Disaster Recovery Plan** (`§164.308(a)(7)`) with tested point-in-time recovery (PITR) and immutable audit-log retention (minimum 6 years under `§164.530(j)`).
   - Maintain a documented **Security Incident Response & Breach Notification Plan** (`45 CFR Part 164 Subpart D`).
