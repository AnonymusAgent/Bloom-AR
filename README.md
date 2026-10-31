# BloomAR Manager — Medical Billing AR Management System

**Version 3.0.0** · Made with ❤️ by WebLoom

A comprehensive, enterprise-grade web application for managing Accounts Receivable, billing operations, authorization workflows, coding reviews, team communication, and performance analytics in medical billing companies.

---

## 📊 Platform Stats

| Metric | Count |
|--------|-------|
| UI Pages | 27 |
| API Routes | 57 |
| Database Tables | 40 |
| Denial Codes | 272 (225 CARC + 47 RARC) |
| User Roles | 7 |
| Sidebar Nav Items | 22 |
| Font | Inter (Google Fonts) |
| Primary Color | #2563EB |
| Nav Color | #0F2D52 (Navy) |

---

## 🚀 Features

### Core AR Management
- **Claims Management** — Full CRUD with 15 statuses, search, filter, sort, pagination, bulk assignment
- **Review Workflow** — Submit → Approve / Reject / Rework with comments and notifications
- **Denial Code Database** — 272 pre-loaded CARC/RARC codes across 27 categories, searchable
- **File Upload** — Excel (.xlsx), CSV, and PDF import with intelligent column mapping
- **Dashboard** — Role-based KPIs, financial summaries, team productivity

### Billing Operations
- **Authorization & Referral Management** — Track auth requests from pending to completion with document uploads
- **Billing Tasks** — Prior Auth, Referral, VOB, Charge Entry, Payment Posting, Custom tasks
- **Coding Queue** — Send denied claims to coding team with auto-attached documents
- **Practice Management** — Assign users to practices with responsibilities
- **Sign-off Management** — Manual submission, supervisor review and approval
- **Supervisor Panel** — Assign work, track productivity, review sign-offs

### AI & Intelligence
- **🧠 AI Denial Analysis** — Rule-based engine analyzing 9 denial categories with prioritized action recommendations, recovery potential scoring, and historical learning
- **🔍 OCR Scanner** — Extract 17 data fields from scanned EOBs, ERAs, insurance cards; review/edit before applying to claims
- **📊 Advanced Reports** — Date-range KPIs, trend charts, AR aging, insurance breakdown, user performance with export

### Communication & Collaboration
- **💬 Real-Time Chat** — SSE-powered instant messaging with automatic polling fallback
- **📎 File Sharing** — Share documents in chat with download support and file type icons
- **🔔 Notifications** — In-app and browser push notifications for assignments, reviews, messages, tasks

### Enterprise Features
- **🖊️ E-Signatures** — Canvas signature pad (mouse/touch/stylus) for appeals, agreements, authorizations
- **🏢 Multi-Tenant** — Independent organizations with data isolation, branding, and membership roles
- **🔑 External API** — RESTful v1 API with API key authentication for third-party integrations
- **📧 Email Digests** — Automated daily summary emails with pending work, overdue tasks, denied claims
- **📦 Export** — One-click CSV and Excel export for claims, authorizations, tasks, audit logs, productivity

### Security & Compliance
- JWT session authentication with secure HTTP-only cookies
- Role-based access control (RBAC) for all modules
- Complete audit trail for every critical action
- API key authentication with bcrypt hashing
- Data isolation for multi-tenant organizations

---

## 🛠 Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4, Lucide React icons |
| Database | PostgreSQL with Drizzle ORM (33 tables) |
| Auth | Custom JWT sessions, bcrypt, API keys |
| Real-time | Server-Sent Events (SSE) |
| File Processing | xlsx, csv-parser |
| Email | Nodemailer with SMTP |

---

## 📋 Prerequisites

- Node.js 18+
- PostgreSQL 14+

---

## 🔧 Installation

```bash
# 1. Clone
git clone <repository-url>
cd ar-management-system

# 2. Install dependencies
npm install

# 3. Configure environment
# Create .env.local with DATABASE_URL and JWT_SECRET (see Environment Variables below)

# 4. Push database schema
npx drizzle-kit push

# 5. Build and start
npm run build
npm start
```

### Environment Variables

```env
# Required
DATABASE_URL=your-postgresql-connection-string
JWT_SECRET=your-secure-random-secret

# Optional — Email notifications
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-password
SMTP_FROM="BloomAR Manager <noreply@example.com>"
```

### First-Time Setup

1. Visit `/login`
2. Click **Seed Database** to create default users and 272 denial codes
3. Login with any of the default accounts below

---

## 👥 Default Credentials

| Role | Email | Password |
|------|-------|----------|
| **Administrator** | **ali.mukhtar@medicalbilling.com** | **Ali@2026!** |
| Administrator | admin@medicalbilling.com | Admin@123 |
| Supervisor | supervisor@medicalbilling.com | Supervisor@123 |
| Manager | manager@medicalbilling.com | Manager@123 |
| Team Lead | teamlead@medicalbilling.com | TeamLead@123 |
| AR Executive | executive@medicalbilling.com | Executive@123 |
| Billing User | billing@medicalbilling.com | Billing@123 |

---

## 📁 Project Structure

```
src/
├── app/
│   ├── ai-analysis/            # AI denial analysis page
│   ├── audit-logs/             # Audit log viewer
│   ├── authorizations/         # Authorization management (list + detail)
│   ├── chat/                   # Real-time team chat
│   ├── claims/                 # Claims management (list + detail)
│   ├── coding/                 # Coding queue page
│   ├── dashboard/              # Main dashboard
│   ├── denial-codes/           # Denial code browser
│   ├── e-signatures/           # Electronic signature capture
│   ├── login/                  # Login page
│   ├── notifications/          # Notification center
│   ├── ocr/                    # OCR document scanner
│   ├── practices/              # Practice management
│   ├── productivity/           # Productivity dashboard
│   ├── reports/                # Advanced reports & export
│   ├── review/                 # Claim review queue
│   ├── signoffs/               # Sign-off management
│   ├── supervisor/             # Supervisor panel
│   ├── tasks/                  # Billing tasks (list + detail)
│   ├── upload/                 # File upload
│   ├── users/                  # User management
│   ├── work-queue/             # AR work queue
│   └── api/                    # 53 API route handlers
│       ├── ai-analysis/        # Denial analysis engine
│       ├── api-keys/           # API key management
│       ├── audit-logs/         # Audit log queries
│       ├── auth/               # Login, logout, session
│       ├── authorizations/     # Authorization CRUD + documents
│       ├── chat/               # Channels, messages, files, SSE stream
│       ├── claims/             # Claim CRUD, assign, review, submit, notes, docs
│       ├── coding/             # Coding request management
│       ├── dashboard/          # Dashboard data
│       ├── denial-codes/       # Denial code search
│       ├── email/              # Email digest system
│       ├── export/             # CSV/Excel export
│       ├── notifications/      # Notification CRUD
│       ├── ocr/                # OCR scan + apply
│       ├── organizations/      # Multi-tenant management
│       ├── practices/          # Practice CRUD + assignment
│       ├── productivity/       # Productivity metrics
│       ├── reports/            # Advanced reporting queries
│       ├── seed/               # Database seeding
│       ├── signatures/         # E-signature storage
│       ├── signoffs/           # Sign-off CRUD + review
│       ├── supervisor/         # Supervisor dashboard data
│       ├── tasks/              # Task CRUD, assign, notes, docs
│       ├── upload/             # File upload processing
│       ├── users/              # User CRUD
│       └── v1/                 # External API (versioned)
├── components/
│   ├── layout/                 # AppLayout, Sidebar, Header
│   └── ui/                     # Button, Card, Table, Modal, Badge, Input
├── db/
│   ├── index.ts                # Database connection
│   └── schema.ts               # 33 tables, 9 enums, 31 types (903 lines)
└── lib/
    ├── api-auth.ts             # API key authentication
    ├── audit.ts                # Audit logging utility
    ├── auth.ts                 # JWT session management, RBAC
    ├── cookie-config.ts        # Session cookie configuration
    ├── denial-codes-data.ts    # 272 CARC/RARC codes dataset
    ├── email.ts                # Email sending + digest templates
    ├── file-parser.ts          # Excel/CSV/PDF parsing
    └── notifications.ts        # Notification creation utility
```

---

## 🔐 Role Permissions

| Feature | Admin | Supervisor | Manager | Sr. Lead | Team Lead | AR Exec | Billing |
|---------|:-----:|:----------:|:-------:|:--------:|:---------:|:-------:|:-------:|
| Manage Users | ✓ | | | | | | |
| Upload Files | ✓ | ✓ | ✓ | ✓ | | | |
| Assign Claims/Tasks | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| Assign Practices | ✓ | ✓ | ✓ | | | | |
| Review Claims | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| Review Sign-offs | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| View Reports | ✓ | ✓ | ✓ | | | | |
| View Audit Logs | ✓ | ✓ | ✓ | | | | |
| Manage Organizations | ✓ | | | | | | |
| Manage API Keys | ✓ | | | | | | |
| Team Chat | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| E-Signatures | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| OCR Scanner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| AI Analysis | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Work Claims | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## 🗄️ Database Schema (33 Tables)

| Table | Purpose |
|-------|---------|
| `users` | User accounts with 7 roles |
| `sessions` | JWT session management |
| `claims` | AR claim records (15 statuses) |
| `claim_notes` | Claim activity notes |
| `claim_documents` | EOBs, denial letters, appeals |
| `claim_status_history` | Claim status audit trail |
| `authorizations` | Authorization request tracking |
| `auth_documents` | Authorization proof documents |
| `coding_requests` | Coding team workflow |
| `coding_documents` | Coding-related documents |
| `billing_tasks` | Billing task management |
| `task_documents` | Task file attachments |
| `task_notes` | Task activity notes |
| `task_status_history` | Task status changes |
| `practices` | Medical practice records |
| `user_practice_assignments` | User-to-practice mapping |
| `user_responsibilities` | User responsibility tracking |
| `signoffs` | Sign-off records |
| `chat_channels` | Chat channel definitions |
| `chat_members` | Channel membership |
| `chat_messages` | Messages and shared files |
| `notifications` | User notification queue |
| `audit_logs` | System-wide audit trail |
| `denial_codes` | 272 CARC/RARC codes |
| `uploaded_files` | Bulk file import tracking |
| `e_signatures` | Electronic signature records |
| `ocr_scans` | OCR extraction results |
| `denial_analyses` | AI denial analysis results |
| `organizations` | Multi-tenant organizations |
| `organization_members` | Org membership |
| `api_keys` | External API authentication |

---

## 🔌 External API

**Base URL:** `/api/v1`

### Authentication
```
Authorization: Bearer armgr_<your-api-key>
```

### Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1` | API documentation & available endpoints |
| GET | `/api/v1/claims` | List claims with pagination and search |
| GET | `/api/v1/claims?search=...` | Search claims by number or patient |

API keys are managed at `/api/api-keys` (admin only). Keys are bcrypt-hashed; the raw key is shown only once at creation.

---

## 🔮 Future Roadmap

### High Priority
| Feature | Why It Matters | Complexity |
|---------|---------------|------------|
| **Patient Management Module** | No dedicated patient CRUD — claims use text names, not linked records | Medium |
| **ERA/835 Auto-Processing** | Automates payment posting from electronic remittance files | High |
| **Claim Scrubbing Rules** | Pre-submission validation to catch coding/billing errors | Medium |
| **Payment Posting Workflow** | Structured payment entry with EOB/ERA reconciliation | Medium |
| **Rate Limiting** | Brute-force protection on login and sensitive endpoints | Low |

### Medium Priority
| Feature | Why It Matters | Complexity |
|---------|---------------|------------|
| Batch Claim Operations | Bulk status updates, reassignment for efficiency | Medium |
| Custom Report Builder | Drag-and-drop report creation for managers | High |
| Automated Follow-up Reminders | Task-based alerts for overdue AR follow-ups | Low |
| Claim Aging Alerts | Notifications when claims exceed thresholds | Low |
| N+1 Query Optimization | JOIN-based queries instead of per-row lookups | Medium |
| Production OCR (Google Vision) | Real document scanning vs pattern matching | Medium |

### Low Priority
| Feature | Complexity |
|---------|------------|
| Two-factor authentication | Low |
| ML denial prediction model | High |
| Mobile PWA | Medium |
| OAuth2 for external API | Medium |
| WebSocket chat (replace SSE) | Medium |
| Clearinghouse integration | High |
| Workflow automation rules | High |

---

## 📄 License

Proprietary software for medical billing companies.

---

Made with ❤️ by WebLoom · © 2025 Web Loom LLC. All rights reserved.
