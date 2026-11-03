-- Multi-tenant workspace isolation, active org sessions, MFA, billing invoices & PostgreSQL RLS
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "active_organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "ip_address" varchar(64);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "user_agent" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "mfa_verified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN IF NOT EXISTS "operational_role" "user_role" DEFAULT 'ar_executive' NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN IF NOT EXISTS "team_lead_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN IF NOT EXISTS "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_org_user_uidx" ON "organization_members"("organization_id", "user_id");
--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN IF NOT EXISTS "operational_role" "user_role" DEFAULT 'ar_executive' NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_start" timestamp;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "current_period_start" timestamp;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "grace_period_ends_at" timestamp;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "past_due_since" timestamp;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "subscription_id" uuid REFERENCES "subscriptions"("id") ON DELETE SET NULL,
  "external_invoice_id" varchar(255),
  "amount_cents" integer DEFAULT 0 NOT NULL,
  "currency" varchar(3) DEFAULT 'USD' NOT NULL,
  "status" varchar(30) DEFAULT 'paid' NOT NULL,
  "billing_reason" varchar(50),
  "invoice_pdf_url" text,
  "hosted_invoice_url" text,
  "period_start" timestamp,
  "period_end" timestamp,
  "paid_at" timestamp,
  "failed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoices_org_idx" ON "billing_invoices"("organization_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_mfa" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE NOT NULL,
  "totp_secret" text NOT NULL,
  "backup_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_enabled" boolean DEFAULT false NOT NULL,
  "enabled_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "uploaded_files" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "claim_notes" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "claim_documents" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "claim_status_history" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "denial_codes" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actor_role" varchar(50);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "user_practice_assignments" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "user_responsibilities" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "billing_tasks" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "task_documents" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "task_notes" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "task_status_history" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "signoffs" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "authorizations" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "auth_documents" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "coding_requests" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "coding_documents" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "chat_channels" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "chat_members" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "e_signatures" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ocr_scans" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "denial_analyses" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "era_files" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "era_transactions" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS "practices_code_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "practices_org_code_uidx" ON "practices"("organization_id", "code");
--> statement-breakpoint
ALTER TABLE "era_files" DROP CONSTRAINT IF EXISTS "era_files_file_hash_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "era_files_org_hash_uidx" ON "era_files"("organization_id", "file_hash");
--> statement-breakpoint
ALTER TABLE "denial_codes" DROP CONSTRAINT IF EXISTS "denial_codes_code_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "denial_codes_global_code_uidx" ON "denial_codes"("code") WHERE "organization_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "denial_codes_org_code_uidx" ON "denial_codes"("organization_id", "code") WHERE "organization_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "site_settings" DROP CONSTRAINT IF EXISTS "site_settings_updated_by_fkey";
--> statement-breakpoint
ALTER TABLE "site_settings" DROP CONSTRAINT IF EXISTS "site_settings_updated_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claims_org_status_idx" ON "claims"("organization_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claims_org_claim_number_idx" ON "claims"("organization_id", "claim_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patients_org_idx" ON "patients"("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practices_org_idx" ON "practices"("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_org_idx" ON "payments"("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "era_files_org_idx" ON "era_files"("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_tasks_org_idx" ON "billing_tasks"("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorizations_org_idx" ON "authorizations"("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coding_requests_org_idx" ON "coding_requests"("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signoffs_org_idx" ON "signoffs"("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_org_idx" ON "audit_logs"("organization_id", "created_at");
--> statement-breakpoint
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'practices',
    'patients',
    'claims',
    'claim_notes',
    'claim_documents',
    'claim_status_history',
    'uploaded_files',
    'denial_analyses',
    'payments',
    'payment_allocations',
    'era_files',
    'era_transactions',
    'billing_tasks',
    'task_documents',
    'task_notes',
    'task_status_history',
    'signoffs',
    'authorizations',
    'auth_documents',
    'coding_requests',
    'coding_documents',
    'chat_channels',
    'chat_members',
    'chat_messages',
    'ocr_scans',
    'e_signatures',
    'user_practice_assignments',
    'user_responsibilities'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON %I USING (COALESCE(current_setting(''app.enforce_rls'', true), ''off'') <> ''on'' OR organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid) WITH CHECK (COALESCE(current_setting(''app.enforce_rls'', true), ''off'') <> ''on'' OR organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)',
      tbl
    );
  END LOOP;
END $$;
