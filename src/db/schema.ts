import {
  pgTable,
  text,
  varchar,
  integer,
  decimal,
  timestamp,
  boolean,
  uuid,
  pgEnum,
  jsonb,
  date,
  serial,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const userRoleEnum = pgEnum('user_role', [
  'administrator',
  'supervisor',
  'manager',
  'senior_lead',
  'team_lead',
  'ar_executive',
  'billing_user',
]);

export const claimStatusEnum = pgEnum('claim_status', [
  'new',
  'assigned',
  'in_progress',
  'pending',
  'submitted_for_review',
  'approved',
  'rework_required',
  'paid',
  'denied',
  'closed',
  'sent_to_coding',
  'coding_review',
  'coding_corrected',
  'returned_to_billing',
  'resubmitted',
]);

// Authorization status enum
export const authStatusEnum = pgEnum('auth_status', [
  'pending',
  'in_progress',
  'completed',
  'denied',
  'expired',
]);

// Coding request status enum
export const codingStatusEnum = pgEnum('coding_status', [
  'sent_to_coding',
  'under_review',
  'corrected',
  'returned_to_billing',
  'resubmitted',
]);

export const notificationTypeEnum = pgEnum('notification_type', [
  'new_assignment',
  'claim_submitted',
  'review_completed',
  'claim_approved',
  'claim_rejected',
  'rework_requested',
  'task_assigned',
  'practice_assigned',
  'document_approved',
  'document_rejected',
  'signoff_pending',
  'signoff_approved',
  'signoff_rejected',
  'supervisor_comment',
  'system',
]);

// Task category enum
export const taskCategoryEnum = pgEnum('task_category', [
  'prior_authorization',
  'referral_management',
  'verification_of_benefits',
  'charge_entry',
  'payment_posting',
  'custom',
]);

// Task status enum
export const taskStatusEnum = pgEnum('task_status', [
  'new',
  'assigned',
  'in_progress',
  'pending',
  'completed',
  'submitted_for_signoff',
  'signed_off',
  'rejected',
]);

// Sign-off status enum
export const signoffStatusEnum = pgEnum('signoff_status', [
  'pending',
  'approved',
  'rejected',
]);

// User responsibility enum
export const responsibilityEnum = pgEnum('responsibility', [
  'accounts_receivable',
  'charge_entry',
  'payment_posting',
  'prior_authorization',
  'referral_management',
  'verification_of_benefits',
  'full_practice_management',
]);

// Users table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  role: userRoleEnum('role').notNull().default('ar_executive'),
  isActive: boolean('is_active').notNull().default(true),
  teamLeadId: uuid('team_lead_id'),
  phone: varchar('phone', { length: 50 }),
  avatarUrl: text('avatar_url'),
  preferences: jsonb('preferences'),
  emailVerifiedAt: timestamp('email_verified_at'),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  accountStatus: varchar('account_status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at'),
});

// User relations
export const usersRelations = relations(users, ({ one, many }) => ({
  teamLead: one(users, {
    fields: [users.teamLeadId],
    references: [users.id],
    relationName: 'teamMembers',
  }),
  teamMembers: many(users, { relationName: 'teamMembers' }),
  assignedClaims: many(claims),
  claimNotes: many(claimNotes),
  auditLogs: many(auditLogs),
  notifications: many(notifications),
}));

// Uploaded files table
export const uploadedFiles = pgTable('uploaded_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  fileType: varchar('file_type', { length: 50 }).notNull(),
  fileSize: integer('file_size').notNull(),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  totalRecords: integer('total_records').default(0),
  processedRecords: integer('processed_records').default(0),
  status: varchar('status', { length: 50 }).notNull().default('processing'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const uploadedFilesRelations = relations(uploadedFiles, ({ one, many }) => ({
  uploader: one(users, {
    fields: [uploadedFiles.uploadedBy],
    references: [users.id],
  }),
  claims: many(claims),
}));

// Claims table
export const claims = pgTable('claims', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimNumber: varchar('claim_number', { length: 100 }).notNull(),
  accountNumber: varchar('account_number', { length: 100 }),
  patientName: varchar('patient_name', { length: 255 }),
  dateOfService: date('date_of_service'),
  cptCodes: text('cpt_codes'),
  diagnosisCode: varchar('diagnosis_code', { length: 100 }),
  location: varchar('location', { length: 255 }),
  provider: varchar('provider', { length: 255 }),
  insurance: varchar('insurance', { length: 255 }),
  payer: varchar('payer', { length: 255 }),
  billedAmount: decimal('billed_amount', { precision: 12, scale: 2 }),
  paidAmount: decimal('paid_amount', { precision: 12, scale: 2 }),
  balance: decimal('balance', { precision: 12, scale: 2 }),
  status: claimStatusEnum('status').notNull().default('new'),
  priority: varchar('priority', { length: 20 }).default('normal'),
  patientId: uuid('patient_id').references(() => patients.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  practiceId: uuid('practice_id').references(() => practices.id),
  uploadedFileId: uuid('uploaded_file_id').references(() => uploadedFiles.id),
  assignedTo: uuid('assigned_to').references(() => users.id),
  assignedBy: uuid('assigned_by').references(() => users.id),
  assignedAt: timestamp('assigned_at'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  reviewComments: text('review_comments'),
  denialCodeId: integer('denial_code_id').references(() => denialCodes.id),
  denialReason: text('denial_reason'),
  subStatus: varchar('sub_status', { length: 100 }),
  workflowStatus: varchar('workflow_status', { length: 50 }).notNull().default('unworked'),
  claimInsuranceStatus: varchar('claim_insurance_status', { length: 50 }),
  workedDate: timestamp('worked_date'),
  workedBy: uuid('worked_by').references(() => users.id),
  submittedForApprovalAt: timestamp('submitted_for_approval_at'),
  followUpDate: date('follow_up_date'),
  reworkReason: text('rework_reason'),
  reworkCount: integer('rework_count').default(0),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  additionalData: jsonb('additional_data'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const claimsRelations = relations(claims, ({ one, many }) => ({
  uploadedFile: one(uploadedFiles, {
    fields: [claims.uploadedFileId],
    references: [uploadedFiles.id],
  }),
  assignee: one(users, {
    fields: [claims.assignedTo],
    references: [users.id],
  }),
  assigner: one(users, {
    fields: [claims.assignedBy],
    references: [users.id],
  }),
  reviewer: one(users, {
    fields: [claims.reviewedBy],
    references: [users.id],
  }),
  denialCode: one(denialCodes, {
    fields: [claims.denialCodeId],
    references: [denialCodes.id],
  }),
  notes: many(claimNotes),
  documents: many(claimDocuments),
  statusHistory: many(claimStatusHistory),
}));

// Claim notes table
export const claimNotes = pgTable('claim_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimId: uuid('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  note: text('note').notNull(),
  actionPerformed: varchar('action_performed', { length: 255 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const claimNotesRelations = relations(claimNotes, ({ one }) => ({
  claim: one(claims, {
    fields: [claimNotes.claimId],
    references: [claims.id],
  }),
  user: one(users, {
    fields: [claimNotes.userId],
    references: [users.id],
  }),
}));

// Claim documents (EOB, denial letters, etc.)
export const claimDocuments = pgTable('claim_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimId: uuid('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  documentType: varchar('document_type', { length: 50 }).notNull(),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  fileData: text('file_data').notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const claimDocumentsRelations = relations(claimDocuments, ({ one }) => ({
  claim: one(claims, {
    fields: [claimDocuments.claimId],
    references: [claims.id],
  }),
  uploader: one(users, {
    fields: [claimDocuments.uploadedBy],
    references: [users.id],
  }),
}));

// Claim status history
export const claimStatusHistory = pgTable('claim_status_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimId: uuid('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  previousStatus: claimStatusEnum('previous_status'),
  newStatus: claimStatusEnum('new_status').notNull(),
  changedBy: uuid('changed_by').notNull().references(() => users.id),
  reason: text('reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const claimStatusHistoryRelations = relations(claimStatusHistory, ({ one }) => ({
  claim: one(claims, {
    fields: [claimStatusHistory.claimId],
    references: [claims.id],
  }),
  user: one(users, {
    fields: [claimStatusHistory.changedBy],
    references: [users.id],
  }),
}));

// Denial codes (CARC and RARC codes)
export const denialCodes = pgTable('denial_codes', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  codeType: varchar('code_type', { length: 10 }).notNull(),
  description: text('description').notNull(),
  category: varchar('category', { length: 100 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Audit logs
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: varchar('entity_id', { length: 100 }),
  previousValue: jsonb('previous_value'),
  newValue: jsonb('new_value'),
  ipAddress: varchar('ip_address', { length: 50 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

// Notifications
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  relatedClaimId: uuid('related_claim_id').references(() => claims.id, { onDelete: 'set null' }),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  claim: one(claims, {
    fields: [notifications.relatedClaimId],
    references: [claims.id],
  }),
}));

// Sessions table for auth
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

// Practices table
export const practices = pgTable('practices', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  address: text('address'),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  npi: varchar('npi', { length: 20 }),
  taxId: varchar('tax_id', { length: 20 }),
  specialty: varchar('specialty', { length: 100 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const practicesRelations = relations(practices, ({ many }) => ({
  userAssignments: many(userPracticeAssignments),
  tasks: many(billingTasks),
  claims: many(claims),
}));

// User Practice Assignments
export const userPracticeAssignments = pgTable('user_practice_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  assignedBy: uuid('assigned_by').notNull().references(() => users.id),
  responsibilities: text('responsibilities').array(),
  isPrimary: boolean('is_primary').notNull().default(false),
  startDate: date('start_date'),
  endDate: date('end_date'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const userPracticeAssignmentsRelations = relations(userPracticeAssignments, ({ one }) => ({
  user: one(users, {
    fields: [userPracticeAssignments.userId],
    references: [users.id],
  }),
  practice: one(practices, {
    fields: [userPracticeAssignments.practiceId],
    references: [practices.id],
  }),
  assigner: one(users, {
    fields: [userPracticeAssignments.assignedBy],
    references: [users.id],
    relationName: 'practiceAssigner',
  }),
}));

// User Responsibilities
export const userResponsibilities = pgTable('user_responsibilities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  responsibility: responsibilityEnum('responsibility').notNull(),
  assignedBy: uuid('assigned_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const userResponsibilitiesRelations = relations(userResponsibilities, ({ one }) => ({
  user: one(users, {
    fields: [userResponsibilities.userId],
    references: [users.id],
  }),
  assigner: one(users, {
    fields: [userResponsibilities.assignedBy],
    references: [users.id],
    relationName: 'responsibilityAssigner',
  }),
}));

// Billing Tasks
export const billingTasks = pgTable('billing_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  category: taskCategoryEnum('category').notNull(),
  status: taskStatusEnum('status').notNull().default('new'),
  priority: varchar('priority', { length: 20 }).default('normal'),
  practiceId: uuid('practice_id').references(() => practices.id),
  claimId: uuid('claim_id').references(() => claims.id),
  patientName: varchar('patient_name', { length: 255 }),
  patientDob: date('patient_dob'),
  insuranceName: varchar('insurance_name', { length: 255 }),
  memberId: varchar('member_id', { length: 100 }),
  authNumber: varchar('auth_number', { length: 100 }),
  referralNumber: varchar('referral_number', { length: 100 }),
  serviceDate: date('service_date'),
  expirationDate: date('expiration_date'),
  assignedTo: uuid('assigned_to').references(() => users.id),
  assignedBy: uuid('assigned_by').references(() => users.id),
  assignedAt: timestamp('assigned_at'),
  completedAt: timestamp('completed_at'),
  completedBy: uuid('completed_by').references(() => users.id),
  dueDate: date('due_date'),
  notes: text('notes'),
  result: text('result'),
  additionalData: jsonb('additional_data'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const billingTasksRelations = relations(billingTasks, ({ one, many }) => ({
  practice: one(practices, {
    fields: [billingTasks.practiceId],
    references: [practices.id],
  }),
  claim: one(claims, {
    fields: [billingTasks.claimId],
    references: [claims.id],
  }),
  assignee: one(users, {
    fields: [billingTasks.assignedTo],
    references: [users.id],
  }),
  assigner: one(users, {
    fields: [billingTasks.assignedBy],
    references: [users.id],
    relationName: 'taskAssigner',
  }),
  completer: one(users, {
    fields: [billingTasks.completedBy],
    references: [users.id],
    relationName: 'taskCompleter',
  }),
  documents: many(taskDocuments),
  notes: many(taskNotes),
  signoffs: many(signoffs),
}));

// Task Documents
export const taskDocuments = pgTable('task_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => billingTasks.id, { onDelete: 'cascade' }),
  documentType: varchar('document_type', { length: 50 }).notNull(),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  fileData: text('file_data').notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  fileSize: integer('file_size'),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  status: varchar('status', { length: 20 }).default('pending'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  reviewComments: text('review_comments'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const taskDocumentsRelations = relations(taskDocuments, ({ one }) => ({
  task: one(billingTasks, {
    fields: [taskDocuments.taskId],
    references: [billingTasks.id],
  }),
  uploader: one(users, {
    fields: [taskDocuments.uploadedBy],
    references: [users.id],
  }),
  reviewer: one(users, {
    fields: [taskDocuments.reviewedBy],
    references: [users.id],
    relationName: 'documentReviewer',
  }),
}));

// Task Notes
export const taskNotes = pgTable('task_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => billingTasks.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  note: text('note').notNull(),
  isSupervisorComment: boolean('is_supervisor_comment').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const taskNotesRelations = relations(taskNotes, ({ one }) => ({
  task: one(billingTasks, {
    fields: [taskNotes.taskId],
    references: [billingTasks.id],
  }),
  user: one(users, {
    fields: [taskNotes.userId],
    references: [users.id],
  }),
}));

// Sign-offs
export const signoffs = pgTable('signoffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  taskId: uuid('task_id').references(() => billingTasks.id, { onDelete: 'cascade' }),
  claimId: uuid('claim_id').references(() => claims.id, { onDelete: 'cascade' }),
  status: signoffStatusEnum('status').notNull().default('pending'),
  submittedBy: uuid('submitted_by').notNull().references(() => users.id),
  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
  submissionNotes: text('submission_notes'),
  isAutomatic: boolean('is_automatic').notNull().default(false),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  reviewNotes: text('review_notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const signoffsRelations = relations(signoffs, ({ one }) => ({
  task: one(billingTasks, {
    fields: [signoffs.taskId],
    references: [billingTasks.id],
  }),
  claim: one(claims, {
    fields: [signoffs.claimId],
    references: [claims.id],
  }),
  submitter: one(users, {
    fields: [signoffs.submittedBy],
    references: [users.id],
  }),
  reviewer: one(users, {
    fields: [signoffs.reviewedBy],
    references: [users.id],
    relationName: 'signoffReviewer',
  }),
}));

// Task Status History
export const taskStatusHistory = pgTable('task_status_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => billingTasks.id, { onDelete: 'cascade' }),
  previousStatus: taskStatusEnum('previous_status'),
  newStatus: taskStatusEnum('new_status').notNull(),
  changedBy: uuid('changed_by').notNull().references(() => users.id),
  reason: text('reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const taskStatusHistoryRelations = relations(taskStatusHistory, ({ one }) => ({
  task: one(billingTasks, {
    fields: [taskStatusHistory.taskId],
    references: [billingTasks.id],
  }),
  user: one(users, {
    fields: [taskStatusHistory.changedBy],
    references: [users.id],
  }),
}));

// ==================== AUTHORIZATION REFERRALS ====================
export const authorizations = pgTable('authorizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientName: varchar('patient_name', { length: 255 }).notNull(),
  insuranceName: varchar('insurance_name', { length: 255 }).notNull(),
  authNumber: varchar('auth_number', { length: 100 }),
  status: authStatusEnum('status').notNull().default('pending'),
  dateObtained: date('date_obtained'),
  expirationDate: date('expiration_date'),
  serviceRequested: text('service_requested'),
  cptCodes: text('cpt_codes'),
  diagnosisCodes: text('diagnosis_codes'),
  notes: text('notes'),
  claimId: uuid('claim_id').references(() => claims.id, { onDelete: 'set null' }),
  practiceId: uuid('practice_id').references(() => practices.id, { onDelete: 'set null' }),
  assignedTo: uuid('assigned_to').references(() => users.id),
  assignedBy: uuid('assigned_by').references(() => users.id),
  assignedAt: timestamp('assigned_at'),
  completedAt: timestamp('completed_at'),
  completedBy: uuid('completed_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const authorizationsRelations = relations(authorizations, ({ one, many }) => ({
  claim: one(claims, { fields: [authorizations.claimId], references: [claims.id] }),
  practice: one(practices, { fields: [authorizations.practiceId], references: [practices.id] }),
  assignee: one(users, { fields: [authorizations.assignedTo], references: [users.id] }),
  documents: many(authDocuments),
}));

export const authDocuments = pgTable('auth_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  authId: uuid('auth_id').notNull().references(() => authorizations.id, { onDelete: 'cascade' }),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  fileData: text('file_data').notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  fileSize: integer('file_size'),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const authDocumentsRelations = relations(authDocuments, ({ one }) => ({
  authorization: one(authorizations, { fields: [authDocuments.authId], references: [authorizations.id] }),
  uploader: one(users, { fields: [authDocuments.uploadedBy], references: [users.id] }),
}));

// ==================== CODING REQUESTS ====================
export const codingRequests = pgTable('coding_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimId: uuid('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  status: codingStatusEnum('status').notNull().default('sent_to_coding'),
  denialReason: text('denial_reason'),
  comments: text('comments'),
  correctionNotes: text('correction_notes'),
  sentBy: uuid('sent_by').notNull().references(() => users.id),
  assignedTo: uuid('assigned_to').references(() => users.id),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const codingRequestsRelations = relations(codingRequests, ({ one, many }) => ({
  claim: one(claims, { fields: [codingRequests.claimId], references: [claims.id] }),
  sender: one(users, { fields: [codingRequests.sentBy], references: [users.id] }),
  documents: many(codingDocuments),
}));

export const codingDocuments = pgTable('coding_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  codingRequestId: uuid('coding_request_id').notNull().references(() => codingRequests.id, { onDelete: 'cascade' }),
  documentType: varchar('document_type', { length: 50 }).notNull(),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  fileData: text('file_data').notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const codingDocumentsRelations = relations(codingDocuments, ({ one }) => ({
  codingRequest: one(codingRequests, { fields: [codingDocuments.codingRequestId], references: [codingRequests.id] }),
}));

// ==================== CHAT MESSAGES ====================
export const chatChannels = pgTable('chat_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }),
  channelType: varchar('channel_type', { length: 20 }).notNull().default('direct'),
  department: varchar('department', { length: 100 }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const chatChannelsRelations = relations(chatChannels, ({ one, many }) => ({
  creator: one(users, { fields: [chatChannels.createdBy], references: [users.id] }),
  members: many(chatMembers),
  messages: many(chatMessages),
}));

export const chatMembers = pgTable('chat_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => chatChannels.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadAt: timestamp('last_read_at'),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
});

export const chatMembersRelations = relations(chatMembers, ({ one }) => ({
  channel: one(chatChannels, { fields: [chatMembers.channelId], references: [chatChannels.id] }),
  user: one(users, { fields: [chatMembers.userId], references: [users.id] }),
}));

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => chatChannels.id, { onDelete: 'cascade' }),
  senderId: uuid('sender_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  messageType: varchar('message_type', { length: 20 }).notNull().default('text'),
  fileName: varchar('file_name', { length: 500 }),
  fileData: text('file_data'),
  fileMimeType: varchar('file_mime_type', { length: 100 }),
  relatedClaimId: uuid('related_claim_id').references(() => claims.id, { onDelete: 'set null' }),
  isEdited: boolean('is_edited').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  channel: one(chatChannels, { fields: [chatMessages.channelId], references: [chatChannels.id] }),
  sender: one(users, { fields: [chatMessages.senderId], references: [users.id] }),
  claim: one(claims, { fields: [chatMessages.relatedClaimId], references: [claims.id] }),
}));

// ==================== E-SIGNATURES ====================
export const eSignatures = pgTable('e_signatures', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentType: varchar('document_type', { length: 100 }).notNull(),
  documentTitle: varchar('document_title', { length: 500 }).notNull(),
  documentContent: text('document_content'),
  signatureData: text('signature_data').notNull(),
  signerName: varchar('signer_name', { length: 255 }).notNull(),
  signerRole: varchar('signer_role', { length: 100 }),
  signerEmail: varchar('signer_email', { length: 255 }),
  signedAt: timestamp('signed_at').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 50 }),
  userAgent: text('user_agent'),
  relatedClaimId: uuid('related_claim_id').references(() => claims.id, { onDelete: 'set null' }),
  relatedEntityType: varchar('related_entity_type', { length: 50 }),
  relatedEntityId: uuid('related_entity_id'),
  signedBy: uuid('signed_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ==================== OCR SCANS ====================
export const ocrScans = pgTable('ocr_scans', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  fileData: text('file_data').notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  documentType: varchar('document_type', { length: 100 }),
  extractedData: jsonb('extracted_data'),
  rawText: text('raw_text'),
  confidence: decimal('confidence', { precision: 5, scale: 2 }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  appliedToClaimId: uuid('applied_to_claim_id').references(() => claims.id, { onDelete: 'set null' }),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ==================== AI DENIAL ANALYSIS ====================
export const denialAnalyses = pgTable('denial_analyses', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimId: uuid('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  denialCodeId: integer('denial_code_id').references(() => denialCodes.id),
  denialCode: varchar('denial_code', { length: 20 }),
  analysisResult: jsonb('analysis_result'),
  likelyReason: text('likely_reason'),
  recommendedActions: jsonb('recommended_actions'),
  recoveryPotential: varchar('recovery_potential', { length: 20 }),
  priorityScore: integer('priority_score'),
  confidenceScore: decimal('confidence_score', { precision: 5, scale: 2 }),
  historicalMatchCount: integer('historical_match_count'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  actionTaken: text('action_taken'),
  outcome: varchar('outcome', { length: 50 }),
  analyzedBy: uuid('analyzed_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ==================== MULTI-TENANT / ORGANIZATIONS ====================
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  logoUrl: varchar('logo_url', { length: 500 }),
  primaryColor: varchar('primary_color', { length: 7 }),
  address: text('address'),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  taxId: varchar('tax_id', { length: 20 }),
  npi: varchar('npi', { length: 20 }),
  subscriptionTier: varchar('subscription_tier', { length: 20 }).default('standard'),
  orgType: varchar('org_type', { length: 50 }),
  country: varchar('country', { length: 100 }),
  timezone: varchar('timezone', { length: 100 }),
  ownerUserId: uuid('owner_user_id'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  onboardingStep: integer('onboarding_step').notNull().default(0),
  onboardingComplete: boolean('onboarding_complete').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  settings: jsonb('settings'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgRole: varchar('org_role', { length: 50 }).notNull().default('member'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ==================== API KEYS ====================
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: varchar('key_prefix', { length: 10 }).notNull(),
  permissions: jsonb('permissions'),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ==================== PATIENTS ====================
export const patients = pgTable('patients', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  middleName: varchar('middle_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  dateOfBirth: date('date_of_birth'),
  gender: varchar('gender', { length: 20 }),
  address: text('address'),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 50 }),
  zip: varchar('zip', { length: 20 }),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  memberId: varchar('member_id', { length: 100 }),
  groupNumber: varchar('group_number', { length: 100 }),
  subscriberName: varchar('subscriber_name', { length: 255 }),
  relationshipToSubscriber: varchar('relationship_to_subscriber', { length: 50 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ==================== PAYMENTS ====================
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentType: varchar('payment_type', { length: 50 }).notNull(),
  payerName: varchar('payer_name', { length: 255 }),
  paymentDate: date('payment_date').notNull(),
  checkNumber: varchar('check_number', { length: 100 }),
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
  allocatedAmount: decimal('allocated_amount', { precision: 12, scale: 2 }).default('0'),
  unallocatedAmount: decimal('unallocated_amount', { precision: 12, scale: 2 }),
  eraFileId: uuid('era_file_id'),
  notes: text('notes'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  postedBy: uuid('posted_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const paymentAllocations = pgTable('payment_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  claimId: uuid('claim_id').notNull().references(() => claims.id),
  insurancePayment: decimal('insurance_payment', { precision: 12, scale: 2 }).default('0'),
  contractualAdjustment: decimal('contractual_adjustment', { precision: 12, scale: 2 }).default('0'),
  otherAdjustment: decimal('other_adjustment', { precision: 12, scale: 2 }).default('0'),
  patientResponsibility: decimal('patient_responsibility', { precision: 12, scale: 2 }).default('0'),
  denialAmount: decimal('denial_amount', { precision: 12, scale: 2 }).default('0'),
  carcCode: varchar('carc_code', { length: 20 }),
  rarcCode: varchar('rarc_code', { length: 20 }),
  remarks: text('remarks'),
  postedBy: uuid('posted_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ==================== ERA/835 FILES ====================
export const eraFiles = pgTable('era_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  fileHash: varchar('file_hash', { length: 64 }).notNull().unique(),
  fileData: text('file_data').notNull(),
  payerName: varchar('payer_name', { length: 255 }),
  paymentDate: date('payment_date'),
  checkNumber: varchar('check_number', { length: 100 }),
  totalPayment: decimal('total_payment', { precision: 12, scale: 2 }),
  totalClaims: integer('total_claims').default(0),
  matchedClaims: integer('matched_claims').default(0),
  unmatchedClaims: integer('unmatched_claims').default(0),
  postedClaims: integer('posted_claims').default(0),
  status: varchar('status', { length: 20 }).notNull().default('uploaded'),
  processedAt: timestamp('processed_at'),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const eraTransactions = pgTable('era_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  eraFileId: uuid('era_file_id').notNull().references(() => eraFiles.id, { onDelete: 'cascade' }),
  claimId: uuid('claim_id').references(() => claims.id),
  claimNumber: varchar('claim_number', { length: 100 }),
  patientName: varchar('patient_name', { length: 255 }),
  dateOfService: date('date_of_service'),
  cptCode: varchar('cpt_code', { length: 20 }),
  billedAmount: decimal('billed_amount', { precision: 12, scale: 2 }),
  allowedAmount: decimal('allowed_amount', { precision: 12, scale: 2 }),
  paidAmount: decimal('paid_amount', { precision: 12, scale: 2 }),
  contractualAdjustment: decimal('contractual_adjustment', { precision: 12, scale: 2 }),
  patientResponsibility: decimal('patient_responsibility', { precision: 12, scale: 2 }),
  otherAdjustment: decimal('other_adjustment', { precision: 12, scale: 2 }),
  carcCode: varchar('carc_code', { length: 20 }),
  rarcCode: varchar('rarc_code', { length: 20 }),
  remarkText: text('remark_text'),
  matchStatus: varchar('match_status', { length: 20 }).notNull().default('unmatched'),
  postStatus: varchar('post_status', { length: 20 }).notNull().default('pending'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ==================== CLAIM SCRUBBING ====================
export const scrubbingRules = pgTable('scrubbing_rules', {
  id: serial('id').primaryKey(),
  ruleName: varchar('rule_name', { length: 255 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 50 }).notNull(),
  severity: varchar('severity', { length: 20 }).notNull().default('error'),
  fieldToCheck: varchar('field_to_check', { length: 100 }).notNull(),
  validationType: varchar('validation_type', { length: 50 }).notNull(),
  validationValue: text('validation_value'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ==================== RATE LIMITING ====================
export const rateLimits = pgTable('rate_limits', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 255 }).notNull(),
  endpoint: varchar('endpoint', { length: 255 }).notNull(),
  count: integer('count').notNull().default(1),
  windowStart: timestamp('window_start').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
});

// ==================== SAAS: PLANS / SUBSCRIPTIONS / DOMAINS / INVITES / TOKENS / LEADS ====================
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  monthlyPriceCents: integer('monthly_price_cents').notNull().default(0),
  annualPriceCents: integer('annual_price_cents').notNull().default(0),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  trialDays: integer('trial_days').notNull().default(14),
  features: jsonb('features'),
  limits: jsonb('limits'),
  stripeMonthlyPriceId: varchar('stripe_monthly_price_id', { length: 255 }),
  stripeAnnualPriceId: varchar('stripe_annual_price_id', { length: 255 }),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').references(() => plans.id),
  billingProvider: varchar('billing_provider', { length: 50 }),
  externalCustomerId: varchar('external_customer_id', { length: 255 }),
  externalSubscriptionId: varchar('external_subscription_id', { length: 255 }),
  status: varchar('status', { length: 30 }).notNull().default('trialing'),
  billingInterval: varchar('billing_interval', { length: 10 }).notNull().default('monthly'),
  trialEnd: timestamp('trial_end'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const organizationDomains = pgTable('organization_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  hostname: varchar('hostname', { length: 255 }).notNull().unique(),
  isSubdomain: boolean('is_subdomain').notNull().default(false),
  verificationStatus: varchar('verification_status', { length: 20 }).notNull().default('pending'),
  verificationTokenHash: text('verification_token_hash'),
  verificationTokenPlain: varchar('verification_token_plain', { length: 100 }),
  hostingStatus: varchar('hosting_status', { length: 30 }).notNull().default('not_configured'),
  tlsStatus: varchar('tls_status', { length: 30 }).notNull().default('unknown'),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const organizationInvitations = pgTable('organization_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  orgRole: varchar('org_role', { length: 50 }).notNull().default('member'),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  revokedAt: timestamp('revoked_at'),
  invitedBy: uuid('invited_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 30 }).notNull(), // email_verification | password_reset
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: varchar('type', { length: 20 }).notNull().default('contact'), // contact | sales | demo
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  organization: varchar('organization', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  message: text('message'),
  status: varchar('status', { length: 20 }).notNull().default('new'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
export const processedWebhooks = pgTable('processed_webhooks', {
  id: varchar('id', { length: 255 }).primaryKey(), // provider event id (idempotency)
  provider: varchar('provider', { length: 50 }).notNull(),
  type: varchar('type', { length: 100 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
export const siteSettings = pgTable('site_settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export type SiteSetting = typeof siteSettings.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type OrganizationDomain = typeof organizationDomains.$inferSelect;

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Claim = typeof claims.$inferSelect;
export type NewClaim = typeof claims.$inferInsert;
export type ClaimNote = typeof claimNotes.$inferSelect;
export type ClaimDocument = typeof claimDocuments.$inferSelect;
export type DenialCode = typeof denialCodes.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type UploadedFile = typeof uploadedFiles.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type ClaimStatusHistory = typeof claimStatusHistory.$inferSelect;
export type Practice = typeof practices.$inferSelect;
export type NewPractice = typeof practices.$inferInsert;
export type BillingTask = typeof billingTasks.$inferSelect;
export type NewBillingTask = typeof billingTasks.$inferInsert;
export type TaskDocument = typeof taskDocuments.$inferSelect;
export type TaskNote = typeof taskNotes.$inferSelect;
export type Signoff = typeof signoffs.$inferSelect;
export type UserPracticeAssignment = typeof userPracticeAssignments.$inferSelect;
export type UserResponsibility = typeof userResponsibilities.$inferSelect;
export type Authorization = typeof authorizations.$inferSelect;
export type CodingRequest = typeof codingRequests.$inferSelect;
export type ChatChannel = typeof chatChannels.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type EraFile = typeof eraFiles.$inferSelect;
export type EraTransaction = typeof eraTransactions.$inferSelect;
export type ScrubbingRule = typeof scrubbingRules.$inferSelect;
export type ESignature = typeof eSignatures.$inferSelect;
export type OcrScan = typeof ocrScans.$inferSelect;
export type DenialAnalysis = typeof denialAnalyses.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
