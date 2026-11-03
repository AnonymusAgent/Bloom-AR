import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Pool, type PoolClient } from 'pg';
import { db, pool as runtimePool } from '@/db';
import { buildPgPoolConfig, resolveRuntimeDatabaseUrl } from '@/db/pg-config';
import {
  organizations,
  organizationMembers,
  subscriptions,
  billingInvoices,
  plans,
  users,
  userMfa,
  practices,
  patients,
  claims,
  claimNotes,
  claimDocuments,
  claimStatusHistory,
  payments,
  paymentAllocations,
  eraFiles,
  eraTransactions,
  denialCodes,
  denialAnalyses,
  billingTasks,
  taskNotes,
  taskDocuments,
  taskStatusHistory,
  signoffs,
  authorizations,
  authDocuments,
  codingRequests,
  codingDocuments,
  chatChannels,
  chatMembers,
  chatMessages,
  ocrScans,
  eSignatures,
  userPracticeAssignments,
  notifications,
  auditLogs,
  siteSettings,
} from '@/db/schema';
import { eq, isNull, sql } from 'drizzle-orm';
import { ensureDefaultPlans, slugify } from '@/lib/saas';
import { ensureStandardDenialCodes } from '@/lib/standard-denial-codes';
import { mapOrgRoleToOperationalRole } from '@/lib/tenant-context';
import type { UserRole } from '@/lib/auth';

export interface BootstrapMemberSpec {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  orgRole: string; // 'owner' | 'admin' | 'billing_manager' | 'ar_specialist' | 'read_only'
  operationalRole?: UserRole;
  reportsToIndex?: number;
}

export interface BootstrapOrganizationSpec {
  name: string;
  slug?: string;
  planSlug?: 'starter' | 'professional' | 'enterprise';
  specialtyProfile: 'cardiology' | 'orthopedics';
  phone?: string;
  address?: string;
  taxId?: string;
  npi?: string;
  members: BootstrapMemberSpec[];
}

export interface TenantBootstrapConfig {
  version: string;
  purgeLegacyDemoData?: boolean;
  organizations: BootstrapOrganizationSpec[];
}

function makeTextAttachmentBase64(title: string, lines: string[]): string {
  const body = [title, '='.repeat(title.length), '', ...lines, ''].join('\n');
  return Buffer.from(body, 'utf8').toString('base64');
}

function getProfileSeedData(profile: 'cardiology' | 'orthopedics') {
  if (profile === 'cardiology') {
    return {
      claimPrefix: 'APEX-CLM-2026',
      practices: [
        {
          name: 'Apex Heart & Vascular — Houston Medical Center',
          code: 'APEX-HOU',
          npi: '1487621094',
          taxId: '76-4812091',
          address: '6550 Fannin St, Suite 1900, Houston, TX 77030',
          phone: '(713) 555-0140',
          specialty: 'Interventional Cardiology',
        },
        {
          name: 'Apex Electrophysiology — Sugar Land',
          code: 'APEX-SUG',
          npi: '1598732105',
          taxId: '76-4812092',
          address: '16655 Southwest Fwy, Suite 420, Sugar Land, TX 77479',
          phone: '(281) 555-0188',
          specialty: 'Cardiac Electrophysiology',
        },
      ],
      patients: [
        {
          firstName: 'Eleanor',
          lastName: 'Vance',
          dob: '1954-03-14',
          gender: 'Female',
          phone: '(713) 555-0211',
          address: '4120 Bellaire Blvd',
          city: 'Houston',
          state: 'TX',
          zip: '77025',
          memberId: 'MCR-88412099A',
          payer: 'Medicare Part B (Novitas)',
        },
        {
          firstName: 'Marcus',
          lastName: 'Delgado',
          dob: '1966-08-27',
          gender: 'Male',
          phone: '(713) 555-0249',
          address: '1908 Heights Blvd',
          city: 'Houston',
          state: 'TX',
          zip: '77008',
          memberId: 'BCB-TX-9023411',
          payer: 'Blue Cross Blue Shield of Texas',
        },
        {
          firstName: 'Priya',
          lastName: 'Natarajan',
          dob: '1972-11-05',
          gender: 'Female',
          phone: '(281) 555-0293',
          address: '3314 Sweetwater Blvd',
          city: 'Sugar Land',
          state: 'TX',
          zip: '77479',
          memberId: 'UHC-77194022',
          payer: 'UnitedHealthcare Choice Plus',
        },
        {
          firstName: 'Gerald',
          lastName: 'Thornton',
          dob: '1949-01-19',
          gender: 'Male',
          phone: '(832) 555-0334',
          address: '910 Memorial Dr',
          city: 'Houston',
          state: 'TX',
          zip: '77024',
          memberId: 'AET-55491820',
          payer: 'Aetna Medicare Advantage',
        },
      ],
      claims: [
        {
          suffix: '1001',
          patientIdx: 0,
          practiceIdx: 0,
          dos: '2026-10-08',
          provider: 'Dr. Elena Rostova, MD',
          billed: '2850.00',
          paid: '2140.00',
          balance: '0.00',
          status: 'paid' as const,
          priority: 'normal',
          cpt: '93306, 93000',
          icd: 'I48.91, I10',
          denialCode: null,
          denialReason: null,
        },
        {
          suffix: '1002',
          patientIdx: 1,
          practiceIdx: 0,
          dos: '2026-09-18',
          provider: 'Dr. Elena Rostova, MD',
          billed: '6420.00',
          paid: '0.00',
          balance: '6420.00',
          status: 'denied' as const,
          priority: 'urgent',
          cpt: '93458, 99215',
          icd: 'I25.10, I20.9',
          denialCode: 'CO-197',
          denialReason:
            'Diagnostic left heart catheterization missing linked prior authorization reference.',
        },
        {
          suffix: '1003',
          patientIdx: 2,
          practiceIdx: 1,
          dos: '2026-10-14',
          provider: 'Dr. Vikram Patel, MD',
          billed: '1490.00',
          paid: '0.00',
          balance: '1490.00',
          status: 'submitted_for_review' as const,
          priority: 'high',
          cpt: '93241, 93244',
          icd: 'I47.1, R00.2',
          denialCode: 'CO-50',
          denialReason: 'Extended Holter patch medical necessity documentation requested by UHC.',
        },
        {
          suffix: '1004',
          patientIdx: 3,
          practiceIdx: 0,
          dos: '2026-10-21',
          provider: 'Dr. Elena Rostova, MD',
          billed: '980.00',
          paid: '592.00',
          balance: '148.00',
          status: 'in_progress' as const,
          priority: 'normal',
          cpt: '93880, 99214',
          icd: 'I65.23, E78.5',
          denialCode: null,
          denialReason: null,
        },
        {
          suffix: '1005',
          patientIdx: 0,
          practiceIdx: 1,
          dos: '2026-10-26',
          provider: 'Dr. Vikram Patel, MD',
          billed: '1850.00',
          paid: '0.00',
          balance: '1850.00',
          status: 'assigned' as const,
          priority: 'high',
          cpt: '93282, 99214',
          icd: 'Z95.810, I49.9',
          denialCode: null,
          denialReason: null,
        },
        {
          suffix: '1006',
          patientIdx: 1,
          practiceIdx: 0,
          dos: '2026-10-30',
          provider: 'Dr. Elena Rostova, MD',
          billed: '640.00',
          paid: '0.00',
          balance: '640.00',
          status: 'new' as const,
          priority: 'low',
          cpt: '99214, 93000',
          icd: 'I11.9, I48.0',
          denialCode: null,
          denialReason: null,
        },
      ],
      authItems: [
        {
          authNumber: 'AUTH-APEX-78401',
          payer: 'Blue Cross Blue Shield of Texas',
          cpt: '93458',
          icd: 'I25.10, I20.0',
          serviceRequested: 'Left heart diagnostic coronary angiography',
          status: 'completed' as const,
          notes: 'Approved diagnostic coronary angiography at Houston Medical Center cath lab.',
        },
        {
          authNumber: 'AUTH-APEX-78419',
          payer: 'UnitedHealthcare Choice Plus',
          cpt: '78452',
          icd: 'R07.9, I25.10',
          serviceRequested: 'Myocardial perfusion SPECT stress imaging',
          status: 'pending' as const,
          notes: 'Nuclear myocardial perfusion SPECT stress imaging awaiting peer-to-peer review.',
        },
      ],
      chatChannelName: 'apex-cardiology-ar-escalations',
      chatMessages: [
        'Morning team — BCBS TX cath lab prior auth #AUTH-APEX-78401 is now on file for APEX-CLM-2026-1002.',
        'Uploading the cath lab procedure report and submitting the reconsideration packet before noon.',
      ],
      eraCheckNumber: 'EFT-NOVITAS-994012',
      eraPayer: 'Medicare Part B (Novitas)',
    };
  }

  return {
    claimPrefix: 'PAC-CLM-2026',
    practices: [
      {
        name: 'Pacific Orthopedic & Spine — Seattle Downtown',
        code: 'PAC-SEA',
        npi: '1720491832',
        taxId: '91-6049211',
        address: '1229 Madison St, Suite 800, Seattle, WA 98104',
        phone: '(206) 555-0175',
        specialty: 'Orthopedic Spine Surgery',
      },
      {
        name: 'Pacific Sports Medicine & Joint — Bellevue',
        code: 'PAC-BEL',
        npi: '1831502943',
        taxId: '91-6049212',
        address: '1135 116th Ave NE, Suite 510, Bellevue, WA 98004',
        phone: '(425) 555-0192',
        specialty: 'Orthopedic Sports Medicine',
      },
    ],
    patients: [
      {
        firstName: 'Hannah',
        lastName: 'Lindqvist',
        dob: '1981-05-22',
        gender: 'Female',
        phone: '(206) 555-0412',
        address: '2415 Queen Anne Ave N',
        city: 'Seattle',
        state: 'WA',
        zip: '98109',
        memberId: 'PREM-WA-6610294',
        payer: 'Premera Blue Cross',
      },
      {
        firstName: 'Devon',
        lastName: 'Kowalski',
        dob: '1975-12-09',
        gender: 'Male',
        phone: '(425) 555-0468',
        address: '10420 Main St',
        city: 'Bellevue',
        state: 'WA',
        zip: '98004',
        memberId: 'REG-WA-3391847',
        payer: 'Regence BlueShield',
      },
      {
        firstName: 'Keiko',
        lastName: 'Takahashi',
        dob: '1959-07-03',
        gender: 'Female',
        phone: '(206) 555-0519',
        address: '4811 California Ave SW',
        city: 'Seattle',
        state: 'WA',
        zip: '98116',
        memberId: 'MCR-77201944B',
        payer: 'Noridian Medicare Part B',
      },
      {
        firstName: 'Trevor',
        lastName: 'Callahan',
        dob: '1990-02-17',
        gender: 'Male',
        phone: '(425) 555-0584',
        address: '7802 SE 28th St',
        city: 'Mercer Island',
        state: 'WA',
        zip: '98040',
        memberId: 'CIG-44820193',
        payer: 'Cigna Open Access Plus',
      },
    ],
    claims: [
      {
        suffix: '2001',
        patientIdx: 0,
        practiceIdx: 1,
        dos: '2026-10-06',
        provider: 'Dr. Nathan Mercer, MD',
        billed: '4850.00',
        paid: '3620.00',
        balance: '0.00',
        status: 'paid' as const,
        priority: 'normal',
        cpt: '29881, 20610',
        icd: 'M23.221, M25.561',
        denialCode: null,
        denialReason: null,
      },
      {
        suffix: '2002',
        patientIdx: 1,
        practiceIdx: 0,
        dos: '2026-09-24',
        provider: 'Dr. Claire Sorensen, MD',
        billed: '12900.00',
        paid: '0.00',
        balance: '12900.00',
        status: 'denied' as const,
        priority: 'urgent',
        cpt: '63030, 99214',
        icd: 'M51.16, M54.16',
        denialCode: 'CO-97',
        denialReason:
          'Pre-operative evaluation bundled into global surgical spine package without modifier 57.',
      },
      {
        suffix: '2003',
        patientIdx: 2,
        practiceIdx: 0,
        dos: '2026-10-15',
        provider: 'Dr. Claire Sorensen, MD',
        billed: '2340.00',
        paid: '0.00',
        balance: '2340.00',
        status: 'submitted_for_review' as const,
        priority: 'high',
        cpt: '64483, 77003',
        icd: 'M54.17, M47.816',
        denialCode: 'CO-4',
        denialReason:
          'Transforaminal epidural steroid injection missing anatomical laterality modifier RT/LT.',
      },
      {
        suffix: '2004',
        patientIdx: 3,
        practiceIdx: 1,
        dos: '2026-10-20',
        provider: 'Dr. Nathan Mercer, MD',
        billed: '1180.00',
        paid: '712.00',
        balance: '178.00',
        status: 'in_progress' as const,
        priority: 'normal',
        cpt: '73721, 99214',
        icd: 'S83.511A, M25.561',
        denialCode: null,
        denialReason: null,
      },
      {
        suffix: '2005',
        patientIdx: 0,
        practiceIdx: 1,
        dos: '2026-10-25',
        provider: 'Dr. Nathan Mercer, MD',
        billed: '3190.00',
        paid: '0.00',
        balance: '3190.00',
        status: 'assigned' as const,
        priority: 'high',
        cpt: '29827, 99214',
        icd: 'M75.121, M25.511',
        denialCode: null,
        denialReason: null,
      },
      {
        suffix: '2006',
        patientIdx: 2,
        practiceIdx: 0,
        dos: '2026-10-29',
        provider: 'Dr. Claire Sorensen, MD',
        billed: '520.00',
        paid: '0.00',
        balance: '520.00',
        status: 'new' as const,
        priority: 'low',
        cpt: '99213, 72100',
        icd: 'M54.50, M48.061',
        denialCode: null,
        denialReason: null,
      },
    ],
    authItems: [
      {
        authNumber: 'AUTH-PAC-51904',
        payer: 'Regence BlueShield',
        cpt: '63030',
        icd: 'M51.16, M54.16',
        serviceRequested: 'Lumbar L4-L5 microdiscectomy',
        status: 'completed' as const,
        notes:
          'Approved L4-L5 lumbar microdiscectomy after 6 weeks documented conservative physical therapy.',
      },
      {
        authNumber: 'AUTH-PAC-51922',
        payer: 'Cigna Open Access Plus',
        cpt: '29888',
        icd: 'S83.511A',
        serviceRequested: 'Arthroscopic ACL reconstruction',
        status: 'pending' as const,
        notes: 'Arthroscopic ACL reconstruction awaiting MRI report upload review by Cigna.',
      },
    ],
    chatChannelName: 'pacific-ortho-appeals-desk',
    chatMessages: [
      'Team — Regence spine operative notes and decision-for-surgery documentation are attached to PAC-CLM-2026-2002.',
      'Adding modifier 57 to the pre-op E/M line and routing to Billing Manager signoff today.',
    ],
    eraCheckNumber: 'EFT-PREMERA-550819',
    eraPayer: 'Premera Blue Cross',
  };
}

async function acquireBootstrapLock(): Promise<{ release: () => Promise<void> }> {
  const runtimeUrl = resolveRuntimeDatabaseUrl();
  let dedicatedPool: Pool | null = null;
  let client: PoolClient | null = null;
  let locked = false;

  if (runtimeUrl) {
    try {
      dedicatedPool = new Pool(buildPgPoolConfig(runtimeUrl, { direct: true, max: 1 }));
      client = await dedicatedPool.connect();
    } catch {
      if (dedicatedPool) {
        await dedicatedPool.end().catch(() => {});
        dedicatedPool = null;
      }
    }
  }

  if (!client) {
    try {
      client = await runtimePool.connect();
    } catch {
      client = null;
    }
  }

  if (client) {
    try {
      await client.query('SELECT pg_advisory_lock(82437002)');
      locked = true;
    } catch {
      locked = false;
    }
  }

  return {
    release: async () => {
      if (client) {
        if (locked) {
          await client.query('SELECT pg_advisory_unlock(82437002)').catch(() => {});
        }
        client.release();
      }
      if (dedicatedPool) {
        await dedicatedPool.end().catch(() => {});
      }
    },
  };
}

async function clearRemainingUserForeignKeys(): Promise<void> {
  try {
    await db.execute(sql`
      DO $$
      DECLARE
        rec record;
      BEGIN
        FOR rec IN
          SELECT
            ns.nspname AS schema_name,
            cls.relname AS table_name,
            att.attname AS column_name,
            att.attnotnull AS is_not_null
          FROM pg_constraint con
          JOIN pg_class cls ON cls.oid = con.conrelid
          JOIN pg_namespace ns ON ns.oid = cls.relnamespace
          JOIN pg_attribute att ON att.attrelid = cls.oid AND att.attnum = con.conkey[1]
          WHERE con.contype = 'f'
            AND con.confrelid = 'public.users'::regclass
            AND array_length(con.conkey, 1) = 1
            AND ns.nspname = 'public'
        LOOP
          IF rec.table_name = 'users' THEN
            EXECUTE format('UPDATE %I.%I SET %I = NULL', rec.schema_name, rec.table_name, rec.column_name);
          ELSIF rec.is_not_null THEN
            EXECUTE format(
              'DELETE FROM %I.%I WHERE %I IN (SELECT id FROM public.users WHERE is_platform_admin = false)',
              rec.schema_name,
              rec.table_name,
              rec.column_name
            );
          ELSE
            EXECUTE format(
              'UPDATE %I.%I SET %I = NULL WHERE %I IN (SELECT id FROM public.users WHERE is_platform_admin = false)',
              rec.schema_name,
              rec.table_name,
              rec.column_name,
              rec.column_name
            );
          END IF;
        END LOOP;
      END $$;
    `);
  } catch {
    // Individual table statements above already cover standard schema tables.
  }
}

export async function runTenantBootstrapFromConfig(config: TenantBootstrapConfig): Promise<{
  applied: boolean;
  version: string;
  organizationsCreated: string[];
}> {
  if (!config || !config.version || !Array.isArray(config.organizations)) {
    return { applied: false, version: 'none', organizationsCreated: [] };
  }

  const lock = await acquireBootstrapLock();
  try {
    const [existingSetting] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, 'tenant_bootstrap_version'));

    const currentVersion = (existingSetting?.value as { version?: string } | undefined)?.version;
    if (currentVersion === config.version) {
      return { applied: false, version: config.version, organizationsCreated: [] };
    }

    if (config.purgeLegacyDemoData) {
      await db.execute(sql`DELETE FROM payment_allocations`);
      await db.execute(sql`DELETE FROM payments`);
      await db.execute(sql`DELETE FROM era_transactions`);
      await db.execute(sql`DELETE FROM era_files`);
      await db.execute(sql`DELETE FROM denial_analyses`);
      await db.execute(sql`DELETE FROM signoffs`);
      await db.execute(sql`DELETE FROM task_documents`);
      await db.execute(sql`DELETE FROM task_notes`);
      await db.execute(sql`DELETE FROM task_status_history`);
      await db.execute(sql`DELETE FROM billing_tasks`);
      await db.execute(sql`DELETE FROM auth_documents`);
      await db.execute(sql`DELETE FROM authorizations`);
      await db.execute(sql`DELETE FROM coding_documents`);
      await db.execute(sql`DELETE FROM coding_requests`);
      await db.execute(sql`DELETE FROM chat_messages`);
      await db.execute(sql`DELETE FROM chat_members`);
      await db.execute(sql`DELETE FROM chat_channels`);
      await db.execute(sql`DELETE FROM ocr_scans`);
      await db.execute(sql`DELETE FROM e_signatures`);
      await db.execute(sql`DELETE FROM claim_notes`);
      await db.execute(sql`DELETE FROM claim_documents`);
      await db.execute(sql`DELETE FROM claim_status_history`);
      await db.execute(sql`DELETE FROM uploaded_files`);
      await db.execute(sql`DELETE FROM claims`);
      await db.execute(sql`DELETE FROM patients`);
      await db.execute(sql`DELETE FROM user_practice_assignments`);
      await db.execute(sql`DELETE FROM user_responsibilities`);
      await db.execute(sql`DELETE FROM practices`);
      await db.execute(sql`DELETE FROM notifications`);
      await db.execute(sql`DELETE FROM audit_logs`);
      await db.execute(sql`DELETE FROM billing_invoices`);
      await db.execute(sql`DELETE FROM subscriptions`);
      await db.execute(sql`DELETE FROM api_keys`);
      await db.execute(sql`DELETE FROM organization_domains`);
      await db.execute(sql`DELETE FROM organization_invitations`);
      await db.execute(sql`DELETE FROM organization_members`);
      await db.execute(sql`DELETE FROM sessions`);
      await db.execute(sql`DELETE FROM organizations`);
      await db.execute(sql`DELETE FROM denial_codes WHERE organization_id IS NOT NULL`);
      await db.execute(sql`DELETE FROM rate_limits`);
      await db.execute(sql`DELETE FROM leads`);
      await db.execute(sql`UPDATE site_settings SET updated_by = NULL`);
      await db.execute(sql`UPDATE users SET team_lead_id = NULL`);
      await db.execute(
        sql`DELETE FROM auth_tokens WHERE user_id IN (SELECT id FROM users WHERE is_platform_admin = false)`
      );
      await db.execute(
        sql`DELETE FROM user_mfa WHERE user_id IN (SELECT id FROM users WHERE is_platform_admin = false)`
      );
      await clearRemainingUserForeignKeys();
      await db.execute(sql`DELETE FROM users WHERE is_platform_admin = false`);
    }

    await ensureDefaultPlans();
    await ensureStandardDenialCodes();

    const allPlans = await db.select().from(plans);
    const globalDenialCodes = await db
      .select()
      .from(denialCodes)
      .where(isNull(denialCodes.organizationId));
    const denialCodeByCode = new Map(globalDenialCodes.map((d) => [d.code, d.id]));

    const createdOrgs: string[] = [];

    for (const orgSpec of config.organizations) {
      const orgSlug = slugify(orgSpec.slug || orgSpec.name);
      const primaryEmail = orgSpec.members[0]?.email?.toLowerCase().trim() || null;

      // If an organization with this slug exists from a non-purge or partial run, clean it first
      const [existingOrg] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, orgSlug));
      if (existingOrg) {
        await db.execute(sql`DELETE FROM claims WHERE organization_id = ${existingOrg.id}`);
        await db.execute(sql`DELETE FROM practices WHERE organization_id = ${existingOrg.id}`);
        await db.execute(sql`DELETE FROM patients WHERE organization_id = ${existingOrg.id}`);
        await db.delete(organizations).where(eq(organizations.id, existingOrg.id));
      }

      // Create or synchronize organization users so credentials always match config
      const createdUsers: Array<typeof users.$inferSelect> = [];
      for (const m of orgSpec.members) {
        const normalizedEmail = m.email.toLowerCase().trim();
        const opRole = mapOrgRoleToOperationalRole(m.orgRole, m.operationalRole);
        const pwHash = await bcrypt.hash(m.password, 12);

        const [existingUser] = await db
          .select()
          .from(users)
          .where(eq(users.email, normalizedEmail));

        let userRow = existingUser;
        if (!userRow) {
          const [inserted] = await db
            .insert(users)
            .values({
              email: normalizedEmail,
              passwordHash: pwHash,
              firstName: m.firstName,
              lastName: m.lastName,
              role: opRole,
              isActive: true,
              emailVerifiedAt: new Date(),
              accountStatus: 'active',
            })
            .returning();
          userRow = inserted;
        } else {
          const [updated] = await db
            .update(users)
            .set({
              passwordHash: pwHash,
              firstName: m.firstName,
              lastName: m.lastName,
              role: opRole,
              isActive: true,
              emailVerifiedAt: existingUser.emailVerifiedAt || new Date(),
              accountStatus: 'active',
              updatedAt: new Date(),
            })
            .where(eq(users.id, existingUser.id))
            .returning();
          userRow = updated;
          if (config.purgeLegacyDemoData) {
            await db.delete(userMfa).where(eq(userMfa.userId, existingUser.id));
          }
        }
        createdUsers.push(userRow);
      }

    const ownerUser = createdUsers[0];
    const planSlug = orgSpec.planSlug || 'professional';
    const plan =
      allPlans.find((p) => p.slug === planSlug) ||
      allPlans.find((p) => p.slug === 'professional') ||
      allPlans[0];

    const [org] = await db
      .insert(organizations)
      .values({
        name: orgSpec.name,
        slug: orgSlug,
        status: 'active',
        email: primaryEmail,
        phone: orgSpec.phone || null,
        address: orgSpec.address || null,
        taxId: orgSpec.taxId || null,
        npi: orgSpec.npi || null,
        subscriptionTier: planSlug,
        ownerUserId: ownerUser.id,
        onboardingStep: 4,
        onboardingComplete: true,
        isActive: true,
      })
      .returning();

    createdOrgs.push(org.name);

    const now = new Date();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (plan) {
      const [sub] = await db
        .insert(subscriptions)
        .values({
          organizationId: org.id,
          planId: plan.id,
          status: 'active',
          billingInterval: 'monthly',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
        })
        .returning();

      await db.insert(billingInvoices).values({
        organizationId: org.id,
        subscriptionId: sub.id,
        externalInvoiceId: `INV-${orgSlug.toUpperCase().slice(0, 8)}-202611`,
        amountCents: plan.monthlyPriceCents || 24900,
        currency: plan.currency,
        status: 'paid',
        billingReason: 'subscription_create',
        periodStart: now,
        periodEnd,
        paidAt: now,
      });
    }

    for (let i = 0; i < orgSpec.members.length; i++) {
      const m = orgSpec.members[i];
      const u = createdUsers[i];
      const opRole = mapOrgRoleToOperationalRole(m.orgRole, m.operationalRole);
      const leadUser =
        m.reportsToIndex !== undefined ? createdUsers[m.reportsToIndex] : undefined;

      await db.insert(organizationMembers).values({
        organizationId: org.id,
        userId: u.id,
        orgRole: m.orgRole,
        operationalRole: opRole,
        teamLeadId: leadUser?.id || null,
        isActive: true,
        invitedBy: ownerUser.id,
      });

      if (leadUser) {
        await db.update(users).set({ teamLeadId: leadUser.id }).where(eq(users.id, u.id));
      }
    }

    const managerUser =
      createdUsers.find(
        (_, idx) =>
          ['billing_manager', 'manager', 'admin', 'owner'].includes(orgSpec.members[idx].orgRole) &&
          idx > 0
      ) || ownerUser;
    const specialistUser =
      createdUsers.find((_, idx) =>
        ['ar_specialist', 'billing_specialist', 'member'].includes(orgSpec.members[idx].orgRole)
      ) || ownerUser;

    const seed = getProfileSeedData(orgSpec.specialtyProfile);

    const insertedPractices = await db
      .insert(practices)
      .values(
        seed.practices.map((p) => ({
          organizationId: org.id,
          name: p.name,
          code: p.code,
          npi: p.npi,
          taxId: p.taxId,
          address: p.address,
          phone: p.phone,
          specialty: p.specialty,
          isActive: true,
        }))
      )
      .returning();

    for (const u of createdUsers) {
      for (let pIdx = 0; pIdx < insertedPractices.length; pIdx++) {
        await db.insert(userPracticeAssignments).values({
          organizationId: org.id,
          userId: u.id,
          practiceId: insertedPractices[pIdx].id,
          assignedBy: ownerUser.id,
          isPrimary: pIdx === 0,
        });
      }
    }

    const insertedPatients = await db
      .insert(patients)
      .values(
        seed.patients.map((pt) => ({
          organizationId: org.id,
          firstName: pt.firstName,
          lastName: pt.lastName,
          dateOfBirth: pt.dob,
          gender: pt.gender,
          phone: pt.phone,
          address: pt.address,
          city: pt.city,
          state: pt.state,
          zip: pt.zip,
          memberId: pt.memberId,
          subscriberName: `${pt.firstName} ${pt.lastName}`,
          relationshipToSubscriber: 'self',
        }))
      )
      .returning();

    const insertedClaims: Array<typeof claims.$inferSelect> = [];
    for (const clm of seed.claims) {
      const pt = insertedPatients[clm.patientIdx];
      const seedPt = seed.patients[clm.patientIdx];
      const prac = insertedPractices[clm.practiceIdx];
      const assignedUserId = clm.status === 'new' ? null : specialistUser.id;
      const denialCodeId = clm.denialCode ? denialCodeByCode.get(clm.denialCode) ?? null : null;

      const [c] = await db
        .insert(claims)
        .values({
          organizationId: org.id,
          claimNumber: `${seed.claimPrefix}-${clm.suffix}`,
          accountNumber: `ACC-${prac.code}-${clm.suffix}`,
          patientName: `${pt.firstName} ${pt.lastName}`,
          patientId: pt.id,
          practiceId: prac.id,
          dateOfService: clm.dos,
          cptCodes: clm.cpt,
          diagnosisCode: clm.icd,
          location: prac.name,
          provider: clm.provider,
          insurance: seedPt.payer,
          payer: seedPt.payer,
          billedAmount: clm.billed,
          paidAmount: clm.paid,
          balance: clm.balance,
          status: clm.status,
          priority: clm.priority,
          assignedTo: assignedUserId,
          assignedBy: assignedUserId ? managerUser.id : null,
          assignedAt: assignedUserId ? now : null,
          denialCodeId,
          denialReason: clm.denialReason,
          workflowStatus: clm.status === 'new' ? 'unworked' : 'in_progress',
          followUpDate: '2026-11-12',
        })
        .returning();
      insertedClaims.push(c);

      await db.insert(claimStatusHistory).values({
        organizationId: org.id,
        claimId: c.id,
        previousStatus: null,
        newStatus: c.status,
        changedBy: ownerUser.id,
        reason: 'Initial workspace claim intake',
      });

      await db.insert(claimNotes).values({
        organizationId: org.id,
        claimId: c.id,
        userId: specialistUser.id,
        note: clm.denialCode
          ? `Denial ${clm.denialCode} triaged inside ${org.name}. Clinical packet prepared for payer reconsideration.`
          : `Claim ${c.claimNumber} verified against ${prac.name} fee schedule.`,
        actionPerformed: clm.denialCode ? 'Appeal packet queued' : 'Eligibility & CPT verified',
      });

      await db.insert(claimDocuments).values({
        organizationId: org.id,
        claimId: c.id,
        documentType: clm.denialCode ? 'denial_letter' : 'eob',
        fileName: `${c.claimNumber}-summary.txt`,
        fileData: makeTextAttachmentBase64(`${org.name} — Claim Summary`, [
          `Organization: ${org.name}`,
          `Practice: ${prac.name} (${prac.code})`,
          `Claim Number: ${c.claimNumber}`,
          `Patient: ${pt.firstName} ${pt.lastName} (DOB: ${pt.dateOfBirth})`,
          `Payer: ${c.payer}`,
          `Billed: $${c.billedAmount} | Paid: $${c.paidAmount} | Balance: $${c.balance}`,
        ]),
        mimeType: 'text/plain',
        uploadedBy: specialistUser.id,
      });
    }

    const paidClaim = insertedClaims[0];
    const deniedClaim = insertedClaims[1];
    const pendingClaim = insertedClaims[2];
    const inProgClaim = insertedClaims[3];

    const eraHash = crypto
      .createHash('sha256')
      .update(`${org.id}:${seed.eraCheckNumber}`)
      .digest('hex');

    const [eraFile] = await db
      .insert(eraFiles)
      .values({
        organizationId: org.id,
        fileName: `${orgSlug}-remit-2026-10.835`,
        fileHash: eraHash,
        fileData: `ISA*00*          *00*          *ZZ*PAYER*ZZ*${orgSlug.toUpperCase()}~CLP*${paidClaim.claimNumber}*1*${paidClaim.billedAmount}*${paidClaim.paidAmount}~`,
        payerName: seed.eraPayer,
        paymentDate: '2026-10-24',
        checkNumber: seed.eraCheckNumber,
        totalPayment: paidClaim.paidAmount || '2140.00',
        totalClaims: 1,
        matchedClaims: 1,
        unmatchedClaims: 0,
        postedClaims: 1,
        status: 'posted',
        processedAt: now,
        uploadedBy: ownerUser.id,
      })
      .returning();

    await db.insert(eraTransactions).values({
      organizationId: org.id,
      eraFileId: eraFile.id,
      claimId: paidClaim.id,
      claimNumber: paidClaim.claimNumber,
      patientName: paidClaim.patientName,
      dateOfService: paidClaim.dateOfService,
      cptCode: (paidClaim.cptCodes || '').split(',')[0].trim(),
      billedAmount: paidClaim.billedAmount,
      allowedAmount: paidClaim.paidAmount,
      paidAmount: paidClaim.paidAmount,
      contractualAdjustment: '710.00',
      patientResponsibility: '0.00',
      carcCode: '45',
      rarcCode: 'N130',
      matchStatus: 'matched',
      postStatus: 'posted',
    });

    const [payment1] = await db
      .insert(payments)
      .values({
        organizationId: org.id,
        paymentType: 'era',
        payerName: seed.eraPayer,
        paymentDate: '2026-10-24',
        checkNumber: seed.eraCheckNumber,
        totalAmount: paidClaim.paidAmount || '2140.00',
        allocatedAmount: paidClaim.paidAmount || '2140.00',
        unallocatedAmount: '0.00',
        eraFileId: eraFile.id,
        notes: `Posted electronic remittance for ${paidClaim.claimNumber}`,
        status: 'posted',
        postedBy: specialistUser.id,
      })
      .returning();

    await db.insert(paymentAllocations).values({
      organizationId: org.id,
      paymentId: payment1.id,
      claimId: paidClaim.id,
      insurancePayment: paidClaim.paidAmount || '2140.00',
      contractualAdjustment: '710.00',
      patientResponsibility: '0.00',
      carcCode: '45',
      rarcCode: 'N130',
      remarks: 'Posted per contracted fee schedule',
      postedBy: specialistUser.id,
    });

    await db.insert(payments).values({
      organizationId: org.id,
      paymentType: 'patient',
      payerName: `${inProgClaim.patientName} (Patient Portal)`,
      paymentDate: '2026-10-29',
      checkNumber: `CC-${orgSlug.toUpperCase().slice(0, 4)}-882`,
      totalAmount: '148.00',
      allocatedAmount: '0.00',
      unallocatedAmount: '148.00',
      notes: `Pending allocation for ${inProgClaim.claimNumber}`,
      status: 'pending',
      postedBy: specialistUser.id,
    });

    for (const [dc, codeStr] of [
      [deniedClaim, seed.claims[1].denialCode || 'CO-197'],
      [pendingClaim, seed.claims[2].denialCode || 'CO-50'],
    ] as const) {
      await db.insert(denialAnalyses).values({
        organizationId: org.id,
        claimId: dc.id,
        denialCodeId: dc.denialCodeId,
        denialCode: codeStr,
        likelyReason: dc.denialReason || 'Clinical modifier/documentation review required',
        recommendedActions: [
          'Verify operative/procedure documentation in clinical chart',
          'Submit payer reconsideration with linked authorization/modifier support',
        ],
        recoveryPotential: 'high',
        priorityScore: 88,
        confidenceScore: '92.50',
        historicalMatchCount: 4,
        status: 'in_progress',
        analyzedBy: specialistUser.id,
      });
    }

    for (let idx = 0; idx < seed.authItems.length; idx++) {
      const a = seed.authItems[idx];
      const pt = insertedPatients[idx + 1];
      const [authRow] = await db
        .insert(authorizations)
        .values({
          organizationId: org.id,
          patientName: `${pt.firstName} ${pt.lastName}`,
          insuranceName: a.payer,
          authNumber: a.authNumber,
          status: a.status,
          dateObtained: a.status === 'completed' ? '2026-10-09' : null,
          expirationDate: '2027-01-09',
          serviceRequested: a.serviceRequested,
          cptCodes: a.cpt,
          diagnosisCodes: a.icd,
          notes: a.notes,
          claimId: insertedClaims[idx + 1]?.id || null,
          practiceId: insertedPractices[0].id,
          assignedTo: specialistUser.id,
          assignedBy: managerUser.id,
          assignedAt: now,
        })
        .returning();

      await db.insert(authDocuments).values({
        organizationId: org.id,
        authId: authRow.id,
        fileName: `${a.authNumber}-clinical-packet.txt`,
        fileData: makeTextAttachmentBase64(`${org.name} — Prior Authorization`, [
          `Auth Reference: ${a.authNumber}`,
          `Payer: ${a.payer}`,
          `Patient: ${pt.firstName} ${pt.lastName}`,
          `Clinical Justification: ${a.notes}`,
        ]),
        mimeType: 'text/plain',
        fileSize: 310,
        uploadedBy: specialistUser.id,
      });
    }

    const [codingRow] = await db
      .insert(codingRequests)
      .values({
        organizationId: org.id,
        claimId: deniedClaim.id,
        status: 'under_review',
        denialReason: deniedClaim.denialReason,
        comments: `Review CPT/modifier pairing for ${deniedClaim.claimNumber} inside ${org.name}.`,
        sentBy: managerUser.id,
        assignedTo: specialistUser.id,
      })
      .returning();

    await db.insert(codingDocuments).values({
      organizationId: org.id,
      codingRequestId: codingRow.id,
      documentType: 'operative_note',
      fileName: `${deniedClaim.claimNumber}-operative-note.txt`,
      fileData: makeTextAttachmentBase64(`${org.name} — Operative Encounter Note`, [
        `Claim: ${deniedClaim.claimNumber}`,
        `CPT: ${deniedClaim.cptCodes} | ICD-10: ${deniedClaim.diagnosisCode}`,
      ]),
      mimeType: 'text/plain',
      uploadedBy: ownerUser.id,
    });

    const [task1] = await db
      .insert(billingTasks)
      .values({
        organizationId: org.id,
        title: `Appeal denial on ${deniedClaim.claimNumber}`,
        description: deniedClaim.denialReason,
        category: 'prior_authorization',
        status: 'submitted_for_signoff',
        priority: 'urgent',
        practiceId: insertedPractices[0].id,
        claimId: deniedClaim.id,
        patientName: deniedClaim.patientName,
        insuranceName: deniedClaim.payer,
        assignedTo: specialistUser.id,
        assignedBy: managerUser.id,
        assignedAt: now,
        dueDate: '2026-11-10',
      })
      .returning();

    await db.insert(taskNotes).values({
      organizationId: org.id,
      taskId: task1.id,
      userId: specialistUser.id,
      note: `Prepared appeal letter and attached clinical documentation for ${deniedClaim.claimNumber}. Ready for supervisor sign-off.`,
    });

    await db.insert(taskDocuments).values({
      organizationId: org.id,
      taskId: task1.id,
      documentType: 'appeal_letter',
      fileName: `${deniedClaim.claimNumber}-appeal-letter.txt`,
      fileData: makeTextAttachmentBase64(`${org.name} — Formal Payer Appeal`, [
        `Claim: ${deniedClaim.claimNumber}`,
        `Summary: ${deniedClaim.denialReason}`,
      ]),
      mimeType: 'text/plain',
      fileSize: 295,
      uploadedBy: specialistUser.id,
      status: 'pending',
    });

    await db.insert(taskStatusHistory).values({
      organizationId: org.id,
      taskId: task1.id,
      previousStatus: 'in_progress',
      newStatus: 'submitted_for_signoff',
      changedBy: specialistUser.id,
      reason: 'Submitted appeal packet for manager sign-off',
    });

    await db.insert(signoffs).values({
      organizationId: org.id,
      entityType: 'task',
      entityId: task1.id,
      taskId: task1.id,
      claimId: deniedClaim.id,
      status: 'pending',
      submittedBy: specialistUser.id,
      submissionNotes: `Please review formal appeal packet for ${deniedClaim.claimNumber}.`,
    });

    await db.insert(billingTasks).values([
      {
        organizationId: org.id,
        title: `Follow up medical necessity review on ${pendingClaim.claimNumber}`,
        description: pendingClaim.denialReason,
        category: 'verification_of_benefits',
        status: 'in_progress',
        priority: 'high',
        practiceId: insertedPractices[1].id,
        claimId: pendingClaim.id,
        patientName: pendingClaim.patientName,
        insuranceName: pendingClaim.payer,
        assignedTo: specialistUser.id,
        assignedBy: ownerUser.id,
        assignedAt: now,
        dueDate: '2026-11-14',
      },
      {
        organizationId: org.id,
        title: `Allocate patient portal payment for ${inProgClaim.claimNumber}`,
        description: `Apply $148.00 patient coinsurance payment to ${inProgClaim.claimNumber}.`,
        category: 'payment_posting',
        status: 'assigned',
        priority: 'normal',
        practiceId: insertedPractices[0].id,
        claimId: inProgClaim.id,
        patientName: inProgClaim.patientName,
        insuranceName: inProgClaim.payer,
        assignedTo: specialistUser.id,
        assignedBy: managerUser.id,
        assignedAt: now,
        dueDate: '2026-11-08',
      },
    ]);

    const [generalChannel] = await db
      .insert(chatChannels)
      .values({
        organizationId: org.id,
        name: seed.chatChannelName,
        channelType: 'group',
        department: 'AR Escalations',
        createdBy: ownerUser.id,
      })
      .returning();

    for (const u of createdUsers) {
      await db.insert(chatMembers).values({
        organizationId: org.id,
        channelId: generalChannel.id,
        userId: u.id,
      });
    }

    await db.insert(chatMessages).values([
      {
        organizationId: org.id,
        channelId: generalChannel.id,
        senderId: managerUser.id,
        content: seed.chatMessages[0],
        messageType: 'text',
        relatedClaimId: deniedClaim.id,
      },
      {
        organizationId: org.id,
        channelId: generalChannel.id,
        senderId: specialistUser.id,
        content: seed.chatMessages[1],
        messageType: 'text',
        relatedClaimId: deniedClaim.id,
      },
    ]);

    await db.insert(eSignatures).values({
      organizationId: org.id,
      documentType: 'appeal_attestation',
      documentTitle: `Appeal Attestation — ${deniedClaim.claimNumber}`,
      documentContent: `Authorized billing attestation for ${org.name}`,
      signatureData:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      signerName: `${ownerUser.firstName} ${ownerUser.lastName}`,
      signerRole: 'owner',
      signerEmail: ownerUser.email,
      relatedClaimId: deniedClaim.id,
      signedBy: ownerUser.id,
    });

    await db.insert(ocrScans).values({
      organizationId: org.id,
      fileName: `${paidClaim.claimNumber}-remittance-eob.txt`,
      fileData: makeTextAttachmentBase64(`${org.name} — Scanned Remittance`, [
        `Claim: ${paidClaim.claimNumber}`,
        `Payer: ${seed.eraPayer}`,
        `Paid: $${paidClaim.paidAmount}`,
      ]),
      mimeType: 'text/plain',
      documentType: 'eob',
      extractedData: {
        claimNumber: paidClaim.claimNumber,
        payerName: seed.eraPayer,
        paidAmount: paidClaim.paidAmount,
      },
      rawText: `Remittance Advice for ${org.name} — Claim ${paidClaim.claimNumber} Paid $${paidClaim.paidAmount}`,
      confidence: '98.50',
      status: 'completed',
      appliedToClaimId: paidClaim.id,
      uploadedBy: specialistUser.id,
    });

    await db.insert(notifications).values({
      organizationId: org.id,
      userId: ownerUser.id,
      type: 'signoff_pending',
      title: 'Appeal Sign-Off Pending',
      message: `${specialistUser.firstName} submitted ${deniedClaim.claimNumber} appeal packet for review.`,
      relatedClaimId: deniedClaim.id,
    });

    await db.insert(auditLogs).values({
      organizationId: org.id,
      userId: ownerUser.id,
      actorRole: 'owner',
      action: 'workspace_provisioned',
      entityType: 'organization',
      entityId: org.id,
      newValue: {
        organizationName: org.name,
        slug: org.slug,
        planSlug,
      },
    });
  }

    await db
      .insert(siteSettings)
      .values({
        key: 'tenant_bootstrap_version',
        value: {
          version: config.version,
          appliedAt: new Date().toISOString(),
          organizations: createdOrgs,
        },
      })
      .onConflictDoUpdate({
        target: siteSettings.key,
        set: {
          value: {
            version: config.version,
            appliedAt: new Date().toISOString(),
            organizations: createdOrgs,
          },
          updatedAt: new Date(),
        },
      });

    return {
      applied: true,
      version: config.version,
      organizationsCreated: createdOrgs,
    };
  } finally {
    await lock.release();
  }
}

export interface EnvBootstrapStatus {
  configured: boolean;
  ok: boolean;
  version: string | null;
  applied: boolean;
  error?: string;
}

export async function runEnvTenantBootstrapIfNeeded(): Promise<EnvBootstrapStatus> {
  const raw = process.env.TENANT_BOOTSTRAP_CONFIG;
  if (!raw || !raw.trim()) {
    return { configured: false, ok: true, version: null, applied: false };
  }
  try {
    const trimmed = raw.trim();
    const jsonText = trimmed.startsWith('{')
      ? trimmed
      : Buffer.from(trimmed.replace(/^b64:/, ''), 'base64').toString('utf8');
    const parsed = JSON.parse(jsonText) as TenantBootstrapConfig;
    const res = await runTenantBootstrapFromConfig(parsed);
    return {
      configured: true,
      ok: true,
      version: res.version,
      applied: res.applied,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[tenant-bootstrap] Failed to apply TENANT_BOOTSTRAP_CONFIG:', err);
    return {
      configured: true,
      ok: false,
      version: null,
      applied: false,
      error: detail.replace(/postgres(ql)?:\/\/\S+/gi, '[database-url]').slice(0, 240),
    };
  }
}
