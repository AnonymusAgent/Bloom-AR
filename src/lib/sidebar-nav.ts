export interface SidebarUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isPlatformAdmin?: boolean;
}

export type NavIconKey =
  | 'dashboard'
  | 'supervisor'
  | 'claims'
  | 'authorizations'
  | 'coding'
  | 'tasks'
  | 'chat'
  | 'practices'
  | 'signoffs'
  | 'productivity'
  | 'reports'
  | 'ai'
  | 'ocr'
  | 'signatures'
  | 'patients'
  | 'payments'
  | 'era'
  | 'upload'
  | 'workQueue'
  | 'review'
  | 'users'
  | 'denialCodes'
  | 'auditLogs'
  | 'notifications'
  | 'profile'
  | 'account'
  | 'organization'
  | 'billing'
  | 'platform'
  | 'security';

export interface SidebarNavItem {
  id: string;
  href: string;
  icon: NavIconKey;
  label: string;
  roles: string[];
  platformAdminOnly?: boolean;
  /** True for deep-link sub-functions/tabs surfaced when searching */
  isSubOption?: boolean;
  /** Short context tag shown on sub-options during search (e.g. "AR Claims") */
  groupLabel?: string;
  /** Search aliases & functional keywords */
  keywords: string[];
}

export const ALL_ROLES = [
  'administrator',
  'supervisor',
  'manager',
  'senior_lead',
  'team_lead',
  'ar_executive',
  'billing_user',
];
export const LEAD_ROLES = ['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead'];
export const ADMIN_ROLES = ['administrator', 'supervisor', 'manager'];

export const SIDEBAR_NAV_ITEMS: SidebarNavItem[] = [
  // ---- Primary Sidebar Navigation ----
  {
    id: 'dashboard',
    href: '/dashboard',
    icon: 'dashboard',
    label: 'Overview',
    roles: ALL_ROLES,
    keywords: [
      'dashboard',
      'overview',
      'home',
      'summary',
      'kpi',
      'metrics',
      'financials',
      'total balance',
      'ar summary',
    ],
  },
  {
    id: 'supervisor',
    href: '/supervisor',
    icon: 'supervisor',
    label: 'Supervisor Panel',
    roles: ADMIN_ROLES,
    keywords: ['supervisor', 'team overview', 'operations', 'workload', 'team performance', 'manage team'],
  },
  {
    id: 'claims',
    href: '/claims',
    icon: 'claims',
    label: 'Workable AR',
    roles: ALL_ROLES,
    keywords: [
      'workable ar',
      'claims',
      'account receivable',
      'accounts receivable',
      'ar',
      'unworked ar',
      'worked ar',
    ],
  },
  {
    id: 'authorizations',
    href: '/authorizations',
    icon: 'authorizations',
    label: 'Authorizations',
    roles: ALL_ROLES,
    keywords: ['prior authorization', 'pa', 'precert', 'referrals', 'auths'],
  },
  {
    id: 'coding',
    href: '/coding',
    icon: 'coding',
    label: 'Coding Queue',
    roles: ALL_ROLES,
    keywords: ['coding', 'cpt', 'icd-10', 'diagnosis', 'medical coder', 'coding review'],
  },
  {
    id: 'tasks',
    href: '/tasks',
    icon: 'tasks',
    label: 'Billing Tasks',
    roles: ALL_ROLES,
    keywords: [
      'tasks',
      'to-do',
      'verification of benefits',
      'vob',
      'charge entry',
      'referral management',
    ],
  },
  {
    id: 'chat',
    href: '/chat',
    icon: 'chat',
    label: 'Team Chat',
    roles: ALL_ROLES,
    keywords: ['chat', 'messages', 'channels', 'direct message', 'team communication'],
  },
  {
    id: 'practices',
    href: '/practices',
    icon: 'practices',
    label: 'Practices',
    roles: ADMIN_ROLES,
    keywords: ['practices', 'clinics', 'facilities', 'npi', 'tax id', 'assign practice'],
  },
  {
    id: 'signoffs',
    href: '/signoffs',
    icon: 'signoffs',
    label: 'Sign-offs',
    roles: ALL_ROLES,
    keywords: ['signoffs', 'sign-offs', 'task approval', 'sign off'],
  },
  {
    id: 'productivity',
    href: '/productivity',
    icon: 'productivity',
    label: 'Productivity',
    roles: ADMIN_ROLES,
    keywords: ['productivity', 'details', 'performance', 'daily trend', 'targets', 'worked stats'],
  },
  {
    id: 'reports',
    href: '/reports',
    icon: 'reports',
    label: 'Reports & Export',
    roles: ADMIN_ROLES,
    keywords: ['reports', 'export', 'csv', 'excel', 'xlsx', 'analytics', 'aging report'],
  },
  {
    id: 'ai-analysis',
    href: '/ai-analysis',
    icon: 'ai',
    label: 'AI Denial Analysis',
    roles: ALL_ROLES,
    keywords: ['ai', 'denial analysis', 'root cause', 'appeals', 'recovery potential', 'outcomes'],
  },
  {
    id: 'ocr',
    href: '/ocr',
    icon: 'ocr',
    label: 'OCR Scanner',
    roles: ALL_ROLES,
    keywords: ['ocr', 'scanner', 'scan eob', 'document extraction', 'pdf scan'],
  },
  {
    id: 'e-signatures',
    href: '/e-signatures',
    icon: 'signatures',
    label: 'E-Signatures',
    roles: ALL_ROLES,
    keywords: ['e-signatures', 'electronic signature', 'sign document', 'consent'],
  },
  {
    id: 'patients',
    href: '/patients',
    icon: 'patients',
    label: 'Patients',
    roles: ALL_ROLES,
    keywords: ['patients', 'demographics', 'member id', 'subscriber', 'patient list'],
  },
  {
    id: 'payments',
    href: '/payments',
    icon: 'payments',
    label: 'Payments',
    roles: ALL_ROLES,
    keywords: ['payments', 'payment posting', 'allocations', 'checks', 'eft', 'remittance'],
  },
  {
    id: 'era',
    href: '/era',
    icon: 'era',
    label: 'ERA Processing',
    roles: ADMIN_ROLES,
    keywords: ['era', '835', 'electronic remittance advice', 'auto post'],
  },
  {
    id: 'upload',
    href: '/upload',
    icon: 'upload',
    label: 'Upload Files',
    roles: [...ADMIN_ROLES, 'senior_lead'],
    keywords: ['upload', 'import claims', 'import ar', 'excel', 'csv', 'batch upload'],
  },
  {
    id: 'work-queue',
    href: '/work-queue',
    icon: 'workQueue',
    label: 'Work Queue',
    roles: ['ar_executive', 'billing_user'],
    keywords: ['work queue', 'my claims', 'assigned claims', 'start working'],
  },
  {
    id: 'review',
    href: '/review',
    icon: 'review',
    label: 'Review',
    roles: LEAD_ROLES,
    keywords: ['review queue', 'approve claims', 'rework', 'reject', 'supervisor review'],
  },
  {
    id: 'users',
    href: '/users',
    icon: 'users',
    label: 'Users',
    roles: ['administrator'],
    keywords: ['users', 'staff', 'team members', 'roles', 'create user', 'permissions'],
  },
  {
    id: 'denial-codes',
    href: '/denial-codes',
    icon: 'denialCodes',
    label: 'Denial Codes',
    roles: ALL_ROLES,
    keywords: ['denial codes', 'carc', 'rarc', 'reason codes', 'remark codes'],
  },
  {
    id: 'audit-logs',
    href: '/audit-logs',
    icon: 'auditLogs',
    label: 'Audit Logs',
    roles: ADMIN_ROLES,
    keywords: ['audit logs', 'security log', 'compliance', 'activity history'],
  },
  {
    id: 'notifications',
    href: '/notifications',
    icon: 'notifications',
    label: 'Notifications',
    roles: ALL_ROLES,
    keywords: ['notifications', 'alerts', 'inbox', 'unread'],
  },
  {
    id: 'profile',
    href: '/profile',
    icon: 'profile',
    label: 'My Profile & Settings',
    roles: ALL_ROLES,
    keywords: ['profile', 'my profile', 'personal info', 'inactivity lock', 'notification settings'],
  },
  {
    id: 'account-settings',
    href: '/settings/account',
    icon: 'account',
    label: 'Account Settings',
    roles: ALL_ROLES,
    keywords: ['account settings', 'security', 'sessions', 'preferences', 'my organizations'],
  },
  {
    id: 'organization-settings',
    href: '/settings/organization',
    icon: 'organization',
    label: 'Organization Settings',
    roles: ALL_ROLES,
    keywords: ['organization', 'workspace', 'custom domains', 'dns', 'team invitations', 'invite member'],
  },
  {
    id: 'billing-plan',
    href: '/settings/billing',
    icon: 'billing',
    label: 'Billing & Plan',
    roles: ALL_ROLES,
    keywords: ['billing', 'subscription', 'plan', 'pricing', 'upgrade', 'trial'],
  },
  {
    id: 'platform-admin',
    href: '/admin/platform',
    icon: 'platform',
    label: 'Website & Platform Admin',
    roles: ALL_ROLES,
    platformAdminOnly: true,
    keywords: ['platform admin', 'website cms', 'plans', 'leads inbox', 'system domains'],
  },

  // ---- Deep-Linked Sub-Options (Surfaced When Searching) ----
  {
    id: 'sub-claims-unworked',
    href: '/claims?tab=unworked',
    icon: 'claims',
    label: 'Unworked AR',
    groupLabel: 'AR Claims',
    isSubOption: true,
    roles: ALL_ROLES,
    keywords: ['unworked ar', 'new claims', 'fresh claims', 'unassigned ar'],
  },
  {
    id: 'sub-claims-workable',
    href: '/claims?tab=workable',
    icon: 'claims',
    label: 'Workable AR Queue',
    groupLabel: 'AR Claims',
    isSubOption: true,
    roles: ALL_ROLES,
    keywords: ['workable ar', 'working claims', 'rework required', 'active claims'],
  },
  {
    id: 'sub-claims-pending-approval',
    href: '/claims?tab=pending_approval',
    icon: 'review',
    label: 'Pending Approval AR',
    groupLabel: 'AR Claims',
    isSubOption: true,
    roles: ALL_ROLES,
    keywords: ['pending approval', 'submitted for review', 'awaiting supervisor'],
  },
  {
    id: 'sub-claims-worked',
    href: '/claims?tab=worked',
    icon: 'signoffs',
    label: 'Worked AR',
    groupLabel: 'AR Claims',
    isSubOption: true,
    roles: ALL_ROLES,
    keywords: ['worked ar', 'approved claims', 'completed ar'],
  },
  {
    id: 'sub-claims-denied',
    href: '/claims?tab=record&filter=denied',
    icon: 'ai',
    label: 'Denied Claims Record',
    groupLabel: 'AR Claims',
    isSubOption: true,
    roles: ALL_ROLES,
    keywords: ['denied claims', 'record denied', 'rejected claims', 'denials list'],
  },
  {
    id: 'sub-claims-paid',
    href: '/claims?tab=record&filter=processed',
    icon: 'payments',
    label: 'Processed / Paid Claims',
    groupLabel: 'AR Claims',
    isSubOption: true,
    roles: ALL_ROLES,
    keywords: ['paid claims', 'processed claims', 'record paid'],
  },
  {
    id: 'sub-claims-unworkable',
    href: '/claims?tab=record&filter=unworkable',
    icon: 'claims',
    label: 'Dead / Unworkable Claims',
    groupLabel: 'AR Claims',
    isSubOption: true,
    roles: ALL_ROLES,
    keywords: ['dead claims', 'unworkable', 'closed ar'],
  },
  {
    id: 'sub-account-security',
    href: '/settings/account?tab=security',
    icon: 'security',
    label: 'Security, Password & Sessions',
    groupLabel: 'Account',
    isSubOption: true,
    roles: ALL_ROLES,
    keywords: ['change password', 'active sessions', 'sign out devices', 'security'],
  },
  {
    id: 'sub-account-preferences',
    href: '/settings/account?tab=preferences',
    icon: 'account',
    label: 'Display & Timezone Preferences',
    groupLabel: 'Account',
    isSubOption: true,
    roles: ALL_ROLES,
    keywords: ['timezone', 'date format', 'rows per page', 'preferences'],
  },
  {
    id: 'sub-platform-website',
    href: '/admin/platform?tab=website',
    icon: 'platform',
    label: 'Website Content Editor',
    groupLabel: 'Platform',
    isSubOption: true,
    roles: ALL_ROLES,
    platformAdminOnly: true,
    keywords: ['edit website', 'cms', 'homepage', 'faq editor', 'brand name'],
  },
  {
    id: 'sub-platform-leads',
    href: '/admin/platform?tab=leads',
    icon: 'notifications',
    label: 'Sales & Contact Leads Inbox',
    groupLabel: 'Platform',
    isSubOption: true,
    roles: ALL_ROLES,
    platformAdminOnly: true,
    keywords: ['leads', 'contact requests', 'demo requests'],
  },
];

export function isItemAuthorizedForUser(item: SidebarNavItem, user: SidebarUser): boolean {
  if (!item.roles.includes(user.role)) return false;
  if (item.platformAdminOnly && !user.isPlatformAdmin) return false;
  return true;
}

/**
 * Filter sidebar items for a user and optional search query.
 * - Empty query: returns standard primary navigation items only (preserves clean layout).
 * - Non-empty query: searches all authorized primary items + deep-link sub-options,
 *   supporting multi-word token matching and relevance ranking.
 */
export function filterSidebarItems(user: SidebarUser, rawQuery: string): SidebarNavItem[] {
  const authorized = SIDEBAR_NAV_ITEMS.filter((item) => isItemAuthorizedForUser(item, user));
  const q = rawQuery.trim().toLowerCase();

  if (!q) {
    return authorized.filter((item) => !item.isSubOption);
  }

  const tokens = q.split(/\s+/).filter(Boolean);

  const scored: Array<{ item: SidebarNavItem; score: number }> = [];

  for (const item of authorized) {
    const labelLower = item.label.toLowerCase();
    const groupLower = (item.groupLabel || '').toLowerCase();
    const keywordsJoined = item.keywords.join(' ').toLowerCase();
    const haystack = `${labelLower} ${groupLower} ${keywordsJoined}`;

    // Every query token must appear somewhere in label, groupLabel, or keywords
    if (!tokens.every((tok) => haystack.includes(tok))) {
      continue;
    }

    let score = 0;
    if (labelLower === q) score += 120;
    else if (labelLower.startsWith(q)) score += 90;
    else if (labelLower.includes(q)) score += 70;

    if (item.keywords.some((k) => k.toLowerCase() === q)) score += 80;
    else if (item.keywords.some((k) => k.toLowerCase().startsWith(q))) score += 55;
    else if (keywordsJoined.includes(q)) score += 35;

    // Slight boost for primary items when tied so main destinations appear cleanly first
    if (!item.isSubOption) score += 10;

    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
