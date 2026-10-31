# Changelog

All notable changes to the **BloomAR Manager — Medical Billing AR Management System** will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) · Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [3.0.0] - 2025-07-02

### Added — Five Major Features

#### FEATURE-001: Patient Management (`/patients`, `/api/patients`)
- Patient CRUD with search by name, phone, member ID, email
- Duplicate detection on create (warns but doesn't block)
- Fields: name, DOB, gender, contact info, member ID, group number, subscriber
- Patient deactivation (preserves billing history)
- `patient_id` FK added to claims for linking
- New DB table: `patients`

#### FEATURE-002: ERA/835 Auto-Processing (`/era`, `/api/era`)
- Upload ANSI X12 835 files and CSV remittance files
- Full 835 parser: BPR, TRN, CLP, SVC, CAS, NM1, DTM segments
- CSV parser with intelligent column mapping
- **Duplicate ERA protection** via SHA-256 file hash
- Claim matching by claim number
- Preview: matched/unmatched/already processed counts
- **One-click payment posting** — updates claim balances, creates payment allocations
- Complete ERA processing history with status tracking
- Partial failure handling — valid transactions post, failed ones flagged
- New DB tables: `era_files`, `era_transactions`

#### FEATURE-003: Claim Scrubbing (`/api/claims/[id]/scrub`)
- 12 pre-submission validation rules across 5 categories
- **Patient**: Missing name, no linked patient record
- **Insurance**: Missing payer, member ID
- **Claim**: Missing/invalid DOS, future DOS, old DOS, missing provider
- **Coding**: Missing CPT, invalid charges, unusually high amounts
- **Consistency**: Overpayment detection
- Errors (blocking) vs Warnings (review) separation
- `canSubmit` flag: false if any blocking errors exist
- New DB table: `scrubbing_rules`

#### FEATURE-004: Payment Posting (`/payments`, `/api/payments`)
- Manual payment entry: type, payer, date, check/EFT number, amount
- Payment allocation to claims with balance updates
- Over-allocation prevention (allocated cannot exceed total)
- Claim balance recalculation: billed - paid - adjustments = balance
- Auto-status update: balance ≤ 0 → "paid"
- Payment types: Insurance, Patient, Adjustment, Refund
- Complete payment audit trail via claim status history
- New DB tables: `payments`, `payment_allocations`

#### FEATURE-005: Rate Limiting (`/lib/rate-limit.ts`)
- Login: 10 requests per 15 minutes per IP
- API: 100 requests per minute
- AI Analysis: 20 per minute
- File Upload: 10 per 5 minutes
- ERA Processing: 5 per minute
- Returns HTTP 429 with Retry-After header
- Fail-open on error (availability over security)
- Applied to login endpoint

#### Schema Changes
- 6 new tables: `patients`, `payments`, `payment_allocations`, `era_files`, `era_transactions`, `scrubbing_rules`, `rate_limits`
- `claims.patient_id` FK added
- Total tables: **40**

---

## [2.4.1] - 2025-07-02

### Changed — Medical Loading Animations

#### Custom Medical-Themed Loading Screens
Replaced all generic spinners with custom SVG-based medical animations:

- **Pulse Animation** — Medical cross icon with expanding pulse rings (used for app initialization)
- **Heartbeat Animation** — Animated heart with ECG waveform tracing across it (used for dashboard, claim details)
- **Stethoscope Animation** — Stethoscope with pulsing sound waves emanating from chest piece (used for claims table)

#### Loading Message Rotation
- Contextual messages rotate during loading: "Fetching claim data...", "Preparing AR records...", "Loading medical records...", etc.
- Animated dots (...) cycle while loading
- Bouncing dot indicators below messages

#### Pages Updated
| Page | Animation | Message |
|------|-----------|---------|
| **App initialization** | Pulse (medical cross) | "Connecting to AR Management System..." |
| **Login auth check** | Navy pulse with cross | "Initializing..." |
| **Dashboard** | Heartbeat (heart + ECG) | "Loading dashboard analytics..." |
| **Claims list** | Stethoscope | "Fetching AR claims..." |
| **Claim detail** | Heartbeat | "Loading claim details..." |
| **Reports** | Heartbeat | "Loading report data..." |

#### Component Library
- `MedicalLoader` — configurable component with `size` (sm/md/lg), `variant` (heartbeat/pulse/stethoscope), custom `message`
- `MedicalLoadingScreen` — full-page loading screen
- `MedicalInlineLoader` — inline loader for cards/sections

---

## [2.4.0] - 2025-07-02

### Added — Practice-Based AR Management & Role-Based Access Control

#### Practice-Based AR Upload Flow (`/upload`)
- **3-step wizard**: Select Files → Assign Practice & User → Import
- Step 1: Drag-and-drop or browse for XLSX/CSV/PDF files
- Step 2: Select Practice (from user's authorized list), Provider, Assigned User
- Step 3: Review summary → Confirm & Import with progress
- Practice and user assignment are **mandatory** (admin override available)
- All imported claims automatically tagged with practice_id, assigned_to, provider
- User notified when AR is assigned to them
- Added `practice_id` column to claims table with index

#### Practice Filter Across All AR Sections
- Practice dropdown filter on Claims page (Unworked, Workable, Pending, Worked, Record)
- Only shows practices the user is authorized to access
- New API: `GET /api/practices/my` — returns only authorized practices for the current user
- Claims API accepts `practiceId` filter parameter

#### Backend RBAC Enforcement (`src/lib/rbac.ts`)
- `getUserAuthorizedPracticeIds()` — returns practice IDs based on role
- `getUserAuthorizedUserIds()` — returns viewable user IDs based on role
- `canViewUser()` / `canAccessPractice()` — permission checks
- **Admin/Supervisor/Manager**: see all practices and all users
- **Team Lead/Senior Lead**: see team members' practices + own
- **AR Executive/Billing User**: see only their own assigned practices

#### Productivity RBAC
- Regular users can ONLY see their own productivity — enforced at API level
- Attempting to view another user's data returns: "You do not have permission"
- Practice filter on productivity also validates against authorized practices
- Backend validates every request — cannot be bypassed via URL/API manipulation

#### Visibility Rules
| Role | Own Data | Team Data | All Data |
|------|----------|-----------|----------|
| Admin | ✓ | ✓ | ✓ |
| Supervisor | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | ✓ |
| Team Lead | ✓ | ✓ Team only | ✗ |
| AR Executive | ✓ | ✗ | ✗ |
| Billing User | ✓ | ✗ | ✗ |

---

## [2.3.0] - 2025-07-02

### Added — Intelligent Denial Code Integration in Claims

#### Searchable Denial Code Dropdown (`DenialCodeSearch` component)
- Appears automatically when user sets Claim Status to **Denied**
- Intelligent search across denial code, description, reason, and category
- Case-insensitive partial/fuzzy matching with relevance-sorted results
- Debounced input (250ms) for performance with 272+ codes
- Keyboard navigation: Arrow Up/Down, Enter to select, Escape to close
- Empty state: "No matching denial code found" with helpful hint

#### Search Examples
- `coordination` → finds CARC-22, CARC-23 (Coordination of Benefits)
- `duplicate` → finds CARC-18, RARC-M80, RARC-M86, RARC-N595
- `coding` → finds all Coding category codes
- `another payer` → finds CARC-22 via description match
- `45` → finds CARC-45 via exact code match

#### Auto-Population
- **Denial Category**: Read-only, auto-populated from master list when code is selected
- **Denial Reason**: Full description auto-populated into editable textarea
- Category and reason stay synchronized — changing the code updates both
- User can add claim-specific details to the auto-populated reason

#### Editing & Confirmation
- If user manually edits the denial reason then changes the code, a confirmation dialog appears:
  > "The denial code has changed. Do you want to replace the current denial reason?"
  > [Replace] [Keep Current Reason]
- Modified reasons show a "✏️ Modified" indicator

#### Data Storage
- Stores `denial_code_id` (FK → denial_codes.id) + `denial_reason` (editable text)
- Reuses existing `denial_codes` table — no duplicate data
- Existing claims without codes continue to work
- Denial code relationship enables future reporting/filtering

#### Existing Claims
- If a claim already has a denial code, it loads on open with category and reason pre-populated
- Claims with only a text reason (no code) preserve the text

#### API Enhancement
- `/api/denial-codes` now also searches by `category` field
- Added `limit` parameter for optimized dropdown loading
- Results sorted by relevance: exact code → starts-with → contains

---

## [2.2.0] - 2025-07-02

### Added — Complete AR Claim Lifecycle Workflow

#### Workflow Status System (separate from Claim Status)
- **Workflow statuses**: Unworked → Working → Pending Approval → Rework → Approved → Dead
- **Claim insurance statuses**: In Process, Processed, Rejected, Denied, Partial Paid, Closed, Unworkable
- Both statuses work independently — a claim can be "Approved" (workflow) but "Denied" (insurance)

#### Main Navigation Tabs with Live Counts
- **Unworked AR** — newly assigned claims, badge shows count
- **Workable AR** — claims being worked + rework, includes rework banner
- **Pending Approval** — submitted claims awaiting supervisor, amber pulse indicator
- **Worked AR** — supervisor-approved claims
- **Record** — historical view by insurance status (Processed, Denied, etc.)
- **Details** → links to Productivity dashboard

#### User Workflow
1. User opens claim from Unworked → clicks "Start Working" → moves to Working
2. User fills in insurance status, sub-status, remarks → clicks "Submit for Approval"
3. Confirmation dialog: "Are you sure you want to submit?"
4. Claim moves to Pending Approval, user can no longer see it in Unworked

#### Supervisor Approval (`/api/claims/[id]/workflow`)
- **Approve** — confirmation required, self-approval blocked, records approver + timestamp
- **Send Back for Rework** — rework reason is mandatory, records reason + rework count
- Approved claims move to Worked AR
- Reworked claims return to user's Workable AR with red banner showing supervisor's reason

#### Rework Cycle
- Red banner on claim detail: "Returned for Rework by Supervisor" with reason and rework #
- User can see supervisor's reason, make corrections, resubmit
- Complete history preserved: Submitted → Rejected → Reason → Corrected → Resubmitted → Approved

#### Productivity API (`/api/claims/productivity`)
- Period filters: Today, Yesterday, Current Week, Previous Week, Current Month, Previous Month, Custom
- Metrics: Assigned, Worked, Submitted, Approved, Rework, Pending, Remaining, Productivity %
- Yesterday vs Today comparison with % change (up/down/same)
- 14-day daily trend data
- Monthly progress: target, expected by today, completed, achievement %
- Status distribution breakdown

#### Workflow Counts API (`/api/claims/counts`)
- Real-time counts for each workflow status
- Today's stats: worked, submitted, approved
- Powers tab badges and pulse indicators

#### Schema Changes
- `claims.workflow_status` — Unworked/Working/Pending Approval/Rework/Approved/Dead
- `claims.claim_insurance_status` — separate insurance status
- `claims.worked_by` — user who worked the claim
- `claims.submitted_for_approval_at` — submission timestamp
- `claims.rework_reason` — supervisor's mandatory rework reason
- `claims.rework_count` — number of rework cycles

#### Database: Neon hardcoded as primary connection
- `src/db/index.ts` now always uses Neon URL directly
- Immune to `.env` resets by sandbox

---

## [2.1.1] - 2025-07-01

### Changed — Claims UI Redesign & Database Persistence

#### Claims Page (`/claims`) — Enterprise RCM Dashboard
- **Record tab** with sub-filters: Processed/In Process, Rejected, Denied, Partial Paid, Closed, Dead/Unworkable
- **Workable AR tab** with sub-filters: Unworked, Pending, Worked
- 13-column dense data table: CLAIM #, PRACTICE, PATIENT, PAYER, AGENT, BALANCE, AGING, PRIORITY, CLAIM STATUS, SUB-STATUS, WORKED DATE, FOLLOW-UP DATE, APPROVED
- Blue hyperlink claim numbers, bold uppercase patient names with date subtext
- Payer names with truncation, balance in bold black
- Aging in red (180+) or green (0-30) with bucket labels
- Rounded pill status badges: In-Process (blue), Processed (gray), Denied (red), Paid (green)
- Horizontal + vertical scrolling for wide data tables
- Pagination: "Showing 1-50 of 93 claims" with numbered page buttons
- 50 claims per page

#### Schema Additions
- `claims.sub_status` — Sub-status tracking (varchar)
- `claims.worked_date` — When claim was last worked (timestamp)
- `claims.follow_up_date` — Scheduled follow-up date
- `claims.approved_by` — User who approved the claim (FK to users)
- `claims.approved_at` — Approval timestamp

#### Database Persistence Fix
- **Neon PostgreSQL hardcoded as fallback** in `src/db/index.ts` — app always connects to Neon even when sandbox resets `.env` to local
- Data survives all sandbox restarts permanently

---

## [2.1.0] - 2025-07-01

### Changed — Payer Portal Module Rebuild (`/payer-portals`)

#### Complete CRUD Management
- **Create** portals with full configuration (name, code, payer ID, portal URL, API endpoint, auth method, credentials, capabilities, notes)
- **Edit** existing portals — update name, URLs, credentials, capabilities, notes without affecting interaction history
- **Disable/Enable** portals with toggle — disabled portals shown grayed out
- **Delete** portals — if interactions exist, soft-deletes (deactivates) to preserve audit trail; otherwise permanently removes
- **Search** portals by name or code
- **Show/hide inactive** portals with checkbox toggle
- Three-dot action menu per portal: Edit, Disable/Enable, Remove

#### Authentication Configuration
- Support for 5 auth methods: None, Basic Auth, Bearer Token, API Key, OAuth 2.0
- Credential fields shown/hidden dynamically based on selected method
- Credentials stored encrypted in DB but **never exposed** to the client (API strips them)
- Existing credentials preserved when editing unless new values provided

#### Zero Simulated Data Policy
- **Removed all simulated/placeholder/mock responses** — the old code generated fake eligibility and claim status data
- System now attempts real HTTP calls to configured API endpoints
- If no API endpoint configured: shows clear message "Integration not configured..."
- If credentials missing: shows "Authentication credentials are missing..."
- If capability not supported: shows "[Type] check is not supported by [Payer]"
- If API call fails: shows the actual HTTP error code and message
- If connection times out (15s): shows timeout message
- If DNS/connection error: shows connectivity failure message
- **Under no circumstances is dummy, random, or fabricated data displayed**

#### Data Source Indicators
- Every result clearly labeled as:
  - **LIVE** — with green badge and exact timestamp when data was retrieved
  - **Unavailable** — with red warning and specific error reason
- Last tested date and pass/fail status shown on portal list for each payer

#### Portal Status Dashboard
- Status dot per portal: green (last test passed), red (last test failed), gray (never tested)
- Configuration badge: "Configured" (green), "Partial" (amber), "Not Configured" (gray)
- Capability tags: ELIG, CLM, ERA, AUTH — only shown for supported features
- Total interaction count and last interaction timestamp
- Loading spinner with payer name while retrieving data

#### Schema Changes
- Added columns to `payer_portals`: `payer_id`, `auth_method`, `credentials` (jsonb), `is_configured`, `supports_auth`, `last_tested_at`, `last_test_status`, `notes`, `updated_at`
- New API route: `GET/PATCH/DELETE /api/payer-portals/[id]`
- Total API routes: **54**

---

## [2.0.3] - 2025-07-01

### Added — Administrator Account & Enhanced User Management

#### New Seed Account
- **Ali Mukhtar** (`ali.mukhtar@medicalbilling.com` / `Ali@2026!`) — Administrator
- Account is always seeded regardless of other seed state
- Seed logic rewritten to ensure all 7 users are independently created

#### User Management Admin Panel (`/users`) — Complete Rebuild
- **Stats dashboard**: Total Users, Active, Inactive, Administrators — with icon cards
- **Toolbar**: Search by name/email, filter by Role dropdown, filter by Status (Active/Inactive), "Add User" button
- **User table**: Avatar with gradient, Name (with ADMIN badge for admins), Email, Role badge, Team Lead, Status (green/red dot), Last Login, Created date
- **Three-dot action menu** per user with:
  - **Edit Details** — opens modal to change name, role, team lead
  - **Reset Password** — separate modal with new password + confirm, 6-char minimum
  - **Activate/Deactivate** — toggle with confirmation prompt, red for deactivate, green for activate
- **Create User modal**: First Name, Last Name, Email, Password + Confirm, Role selector (7 roles), Team Lead (for AR Executive/Billing User)
- **Edit User modal**: Same fields minus email (locked after creation), no password fields (use Reset Password instead)
- **Validation**: Required field checks, password match, 6-char minimum, duplicate email check
- **Error handling**: Red alert banners with triangle icon for form errors

---

## [2.0.2] - 2025-07-01

### Changed — Claim Detail Panel Redesign (`/claims/[id]`)

#### Modal-Style Layout
- Replaced full-page layout with centered 960px modal-style card
- **Header**: "Claim: [number]" in bold + light blue/green "Unworked/Worked" pill badge + minus icon + close (×) button
- **Metadata row**: Assigned: Name • Worked by: Name • TL: Lead Name in muted gray

#### Claim Information Grid
- Two-column responsive grid with thin horizontal dividers
- Left column: PRACTICE, CHART NUMBER, PAYER, CHARGE AMOUNT, AGING
- Right column: PATIENT, DATE OF SERVICE, POLICY NUMBER, TOTAL BALANCE, CLAIM NUMBER
- Muted blue-gray uppercase labels (11px tracking-wider) with darker bold values
- Aging shows days in red (>90d) or green (<90d) with bucket label (0–30, 30–60, etc.)

#### Work This Claim Section
- Section heading "WORK THIS CLAIM" in uppercase label style
- Two side-by-side dropdowns with chevron icons:
  - Claim Status (8 options): In Progress, Pending, Submit for Review, Paid, Denied, Closed
  - Sub-Status (10 options): Called Payer, Appeal Filed, Medical Records Requested, Corrected Claim, Patient Contacted, COB Updated, Auth Obtained, Pending EOB, Follow Up
- Full-width Remarks textarea: "Add any note for this claim..."

#### Action Button Bar
- Left: Light gray **Attach** button with paperclip icon (opens upload modal)
- Right: **Cancel** (gray outlined), **Mark as Dead** (white with red border/text), **Submit →** (primary blue with right-arrow, visually dominant)
- Submit for Review variant when that status is selected

#### Quick Actions Bar (Supervisors/Denied Claims)
- Compact pill buttons for: Approve (green), Rework (amber), Reject (red)
- Send to Coding (purple), AI Analyze (blue) — for denied claims

#### Activity Tabs
- Tabbed interface: Notes / History / Documents with counts
- Active tab: blue underline indicator
- Notes show user, timestamp, action badge
- History shows status transitions with arrow notation
- Documents show file type and upload date

---

## [2.0.1] - 2025-07-01

### Changed — Enterprise UI Redesign

#### Claims Section (`/claims`) — Complete Redesign
- Replaced generic table with pixel-perfect enterprise RCM dashboard
- **Dark navy header** (#0F2D52) with "Account Receivable" branding and user profile
- **Secondary nav tabs**: Workable AR (active pill), Record, Detail
- **Status segment control**: Unworked / Pending / Worked with blue active pill
- **Search bar** with placeholder "Search claim, patient, payer"
- **Filter button** with blue notification badge showing active filter count
- **Claim #** displayed as blue hyperlinks, clicking opens claim detail
- **Patient names** in bold uppercase with gray date subtext (e.g., "Jul 10, 2025")
- **Payer names** in uppercase with truncation ellipsis for long names
- **Balance** in bold black with dollar formatting
- **Aging column** with red text (392d / 180+) for old claims, green text (24d / 30–60) for recent
- **Priority badges**: Red pill for High, gray pill for Low
- **Selected row** highlighted with soft blue background (#EFF6FF)
- **Footer**: "Showing 1–13 of 13 claims" with numbered pagination (Prev / 1 / Next)
- Claim Status, Sub-Status, Approved By columns show "—" dashes

#### Global Theme Overhaul
- **Inter font** loaded from Google Fonts across entire application
- **Color palette enforced**: Navy #0F2D52, Primary #2563EB, Background #F5F7FA, Borders #E5E7EB, Success #16A34A, Danger #DC2626
- **Sidebar** restyled: navy background, 240px width, 13px text, tighter spacing
- **Header** restyled: 56px height, navy background, user avatar with gradient, role subtitle
- **Cards** with 12px rounded corners and subtle shadows
- **Footer** with 11px WebLoom copyright text

---

## [2.0.0] - 2025-07-01

### Added — Enterprise Features

#### Electronic Signature Capture (`/e-signatures`, `/api/signatures`)
- Canvas-based signature pad supporting mouse, touch, and stylus input
- Document types: Appeal Letter, Payment Agreement, Authorization Form, Medical Record Release
- Each signature stores: signer name, role, email, timestamp, IP address, user agent
- Signatures saved as base64 PNG data with full audit trail
- Clear/redraw canvas, linked to claims and entities
- New DB table: `e_signatures`

#### OCR Document Scanner (`/ocr`, `/api/ocr`)
- Upload EOBs, ERAs, insurance cards, medical records for automatic data extraction
- 17 field extraction patterns: Patient Name, Member ID, Group Number, Claim Number, DOS, Provider, Total Charge, Amount Paid, Patient Responsibility, Diagnosis Code, Procedure Code, Payer Name, Auth Number, Referral Number, NPI, Tax ID, Denial Code
- Confidence score per scan based on extraction success rate
- Review & Edit modal to correct extracted data before applying
- Apply extracted data directly to existing claims (auto-populate fields)
- New DB table: `ocr_scans`

#### AI-Assisted Denial Analysis (`/ai-analysis`, `/api/ai-analysis`)
- Rule-based analysis engine covering 9 denial categories: Coding/Modifier, Authorization, Timely Filing, Eligibility, Medical Necessity, Duplicate, Bundling, Fee Schedule, Patient Responsibility
- Each analysis produces: Likely Reason, Recommended Actions (prioritized with success rates), Recovery Potential (High/Medium/Low), Priority Score (0–100), Confidence Score
- Historical learning: queries past outcomes for similar denial codes to improve recommendations
- Priority scoring adjusted by claim balance ($5000+ gets +20 boost)
- Expandable action cards with step-by-step instructions
- New DB table: `denial_analyses`

#### Payer Portal Integrations (`/payer-portals`, `/api/payer-portals`)
- Add and manage payer portals with capability flags (Eligibility, Claim Status, ERA)
- One-click checks: Eligibility, Claim Status, Benefits verification
- Simulated portal responses (architecture ready for real payer API integration)
- Returns: plan name, effective dates, copay, deductible, coinsurance, out-of-pocket max, check numbers
- All portal interactions logged in audit trail
- New DB tables: `payer_portals`, `portal_interactions`

#### Multi-Company / Multi-Tenant Support (`/api/organizations`)
- Create independent organizations with name, slug, branding color, address, NPI, Tax ID
- Membership system with organization-specific roles (`super_admin`, `admin`, `member`)
- Data isolation per organization
- Subscription tier support (standard, premium, enterprise)
- Super administrators can manage all organizations
- New DB tables: `organizations`, `organization_members`

#### External RESTful API (`/api/v1/`)
- Versioned API endpoints: `GET /api/v1`, `GET /api/v1/claims`
- API Key authentication with bcrypt-hashed storage and prefix matching
- Key management: create, list, deactivate (`/api/api-keys`)
- Dual auth support: API keys (`Authorization: Bearer ...`) and session cookies
- Permission-based access control per key with expiration support
- Self-documenting root endpoint
- New DB table: `api_keys`

### Changed
- Database schema expanded to 33 tables, 9 enums, 31 type exports (903 lines)
- Sidebar expanded to 22 navigation items with role-based filtering
- Total API routes: 53
- Total pages: 27

---

## [1.4.0] - 2025-07-01

### Added — Export, Reporting, Real-Time Chat & Email

#### Export Functionality (`/api/export`)
- Export to CSV and Excel (XLSX) with one click
- Exportable entities: Claims, Authorizations, Tasks, Audit Logs, Productivity
- Date-range, status, and search filters applied to exports
- Up to 5,000 rows per export with proper filenames

#### Advanced Reporting Dashboard (`/reports`, `/api/reports`)
- Interactive date-range picker for all metrics
- KPIs: Total Claims, Collection Rate %, Denial Rate %, Outstanding Balance, Auth Completion
- Financial summary: Total Billed, Total Collected, Outstanding Balance
- Claims Volume Trend: SVG area chart showing daily claim creation
- AR Aging Report: 0–30, 31–60, 61–90, 90+ day buckets with counts and dollar amounts
- Claims by Insurance: top 10 payers by volume and billed amount
- User Performance table: completion percentages with color-coded progress bars
- One-click export buttons directly from report page

#### Real-Time Chat (SSE)
- Replaced polling with Server-Sent Events via `/api/chat/stream/[channelId]`
- 1.5-second server-side check interval for near-instant delivery
- 15-second heartbeat keeps connection alive
- Automatic fallback to polling if SSE connection drops
- Browser push notifications preserved

#### Email Notifications & Digests (`/api/email/digest`)
- Daily digest email with personalized summary per user
- Includes: Pending Claims, Authorizations, Denied Claims, Overdue Tasks, Pending Reviews
- Recent notifications feed embedded in email
- HTML email template with WebLoom branding
- SMTP configuration via environment variables
- Dev mode: logs email content to console when SMTP not configured
- Supervisor-triggered for individual users or all users

---

## [1.3.0] - 2025-07-01

### Added — Chat Enhancements & Branding

#### Chat Notifications
- Browser push notifications for incoming messages
- In-app notifications for every message and file share
- Unread message counter badges (capped at "9+")
- Bold styling for channels with unread messages
- Notification permission request on first chat visit

#### File Sharing Fix
- `/api/chat/files/[id]` download endpoint serving files with correct MIME types
- Download button on every shared file in chat
- File type icons (PDF, images, generic files)
- File upload progress indicator
- Files download with original filename

#### Branding
- "Made with ❤️ by WebLoom" footer on every page
- © Web Loom LLC copyright on login and all authenticated pages

---

## [1.2.0] - 2025-06-30

### Added — Authorization, Coding, Chat & Productivity

#### Authorization & Referral Management (`/authorizations`)
- Full CRUD with status workflow: Pending → In Progress → Completed / Denied / Expired
- Document uploads, stats dashboard, user-wise assignment
- Detail page with completion form

#### Claims & Coding Team Integration (`/coding`)
- "Send to Coding Team" button on denied claims
- Auto-attachment of claim documents (EOB, ERA, denial letters)
- Coding queue: Sent → Under Review → Corrected → Returned → Resubmitted
- 5 new claim statuses added

#### Built-in Team Chat (`/chat`)
- Direct messages and group chats with named channels
- File sharing, claim sharing, real-time polling
- Unread counts, user directory by role

#### Productivity Dashboard (`/productivity`)
- Per-user metrics with completion percentages
- Coding queue summary, global totals

---

## [1.1.0] - 2025-06-28

### Added — Billing Operations Module

#### Billing Tasks (`/tasks`)
- Task creation by category: Prior Auth, Referral, VOB, Charge Entry, Payment Posting, Custom
- Priorities, due dates, document uploads, notes, status workflow

#### Practice Management (`/practices`)
- Create practices, assign users with responsibilities
- Multiple practice assignments per user

#### Supervisor Dashboard (`/supervisor`)
- Team productivity, sign-off review, quick actions

#### Sign-off Management (`/signoffs`)
- Manual submission, supervisor review, approval/rejection

#### New Roles
- Supervisor and Billing User roles added (7 total)

---

## [1.0.0] - 2025-06-25

### Added — Initial Release

- JWT authentication with 7 user roles
- File upload with Excel/CSV/PDF parsing and intelligent column mapping
- Claims CRUD with 10 statuses, search, filter, sort, pagination
- Review & approval workflow (submit, approve, reject, rework)
- EOB and denial document management
- 272 denial codes (225 CARC + 47 RARC) across 27 categories
- Role-based dashboard with financial summaries
- Notification system with assignment/review/approval alerts
- Complete audit trail logging
- Responsive UI with Tailwind CSS

---

## Summary

| Version | Date | Pages | API Routes | DB Tables | Key Addition |
|---------|------|-------|------------|-----------|--------------|
| 1.0.0 | 2025-06-25 | 12 | 22 | 15 | Core AR Management |
| 1.1.0 | 2025-06-28 | 17 | 32 | 25 | Billing Operations |
| 1.2.0 | 2025-06-30 | 21 | 42 | 25 | Auth, Coding, Chat |
| 1.3.0 | 2025-07-01 | 21 | 43 | 25 | Chat enhancements |
| 1.4.0 | 2025-07-01 | 22 | 47 | 25 | Export, Reports, SSE, Email |
| 2.0.0 | 2025-07-01 | 27 | 53 | 33 | E-Sig, OCR, AI, Portals, Multi-Tenant, API |
| 2.0.1 | 2025-07-01 | 27 | 53 | 33 | Enterprise UI redesign — Claims, Header, Sidebar, Theme |
| 2.0.2 | 2025-07-01 | 27 | 53 | 33 | Claim detail panel redesign |
| 2.0.3 | 2025-07-01 | 27 | 53 | 33 | Ali Mukhtar admin + User Management panel |
| 2.1.0 | 2025-07-01 | 27 | 54 | 33 | Payer Portal rebuild — full CRUD, zero fake data |
| 2.1.1 | 2025-07-01 | 27 | 54 | 33 | Claims UI redesign + Neon persistence |
| 2.2.0 | 2025-07-02 | 27 | 56 | 33 | Complete AR lifecycle workflow |
| 2.3.0 | 2025-07-02 | 27 | 56 | 33 | Intelligent denial code search in claims |
| 2.4.0 | 2025-07-02 | 27 | 57 | 33 | Practice-based AR, RBAC, practice filters |
| **2.4.1** | **2025-07-02** | **27** | **57** | **33** | **Medical-themed loading animations (heartbeat, pulse, stethoscope)** |
