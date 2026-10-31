import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Node 22+ can import TypeScript directly with --experimental-strip-types or we can verify via tsx / dynamic import
import { filterSidebarItems, SIDEBAR_NAV_ITEMS } from '../src/lib/sidebar-nav.ts';

const repoRoot = process.cwd();

const arExecUser = {
  id: 'u-exec',
  email: 'exec@example.test',
  firstName: 'Alex',
  lastName: 'Agent',
  role: 'ar_executive',
  isPlatformAdmin: false,
};

const orgAdminUser = {
  id: 'u-admin',
  email: 'admin@example.test',
  firstName: 'Morgan',
  lastName: 'Admin',
  role: 'administrator',
  isPlatformAdmin: false,
};

const platformAdminUser = {
  id: 'u-plat',
  email: 'plat@example.test',
  firstName: 'Taylor',
  lastName: 'Platform',
  role: 'administrator',
  isPlatformAdmin: true,
};

test('empty search returns only authorized primary sidebar items without sub-option clutter', () => {
  const execDefault = filterSidebarItems(arExecUser, '');
  assert.ok(execDefault.length > 0);
  assert.ok(execDefault.every((i) => !i.isSubOption), 'Default list must not include sub-options');
  assert.ok(execDefault.some((i) => i.href === '/dashboard' && i.label === 'Overview'));
  assert.ok(execDefault.some((i) => i.href === '/claims' && i.label === 'Workable AR'));
  assert.ok(execDefault.some((i) => i.href === '/work-queue'));

  // Restricted admin routes hidden from AR Executive
  assert.ok(!execDefault.some((i) => i.href === '/users'));
  assert.ok(!execDefault.some((i) => i.href === '/practices'));
  assert.ok(!execDefault.some((i) => i.href === '/audit-logs'));
  assert.ok(!execDefault.some((i) => i.href === '/admin/platform'));

  // Org admin without platform flag sees /users & /practices, NOT /admin/platform
  const orgAdminDefault = filterSidebarItems(orgAdminUser, '   ');
  assert.ok(orgAdminDefault.some((i) => i.href === '/users'));
  assert.ok(orgAdminDefault.some((i) => i.href === '/practices'));
  assert.ok(!orgAdminDefault.some((i) => i.href === '/admin/platform'));

  // Platform admin sees /admin/platform
  const platDefault = filterSidebarItems(platformAdminUser, '');
  assert.ok(platDefault.some((i) => i.href === '/admin/platform'));
});

test('searching "overview" and "dashboard" surfaces Overview (/dashboard) at the top', () => {
  const execOverview = filterSidebarItems(arExecUser, 'overview');
  assert.ok(execOverview.length >= 1);
  assert.equal(execOverview[0].href, '/dashboard');
  assert.equal(execOverview[0].label, 'Overview');
  assert.ok(!execOverview.some((i) => i.href === '/supervisor'), 'AR exec should not see Supervisor Panel');

  const adminOverview = filterSidebarItems(orgAdminUser, 'overview');
  assert.equal(adminOverview[0].href, '/dashboard');
  assert.ok(adminOverview.some((i) => i.href === '/supervisor'), 'Admin should also see Supervisor Panel (team overview)');

  const dashAlias = filterSidebarItems(arExecUser, 'dashboard');
  assert.ok(dashAlias.some((i) => i.href === '/dashboard'));
});

test('searching "workable ar" and AR sub-tabs surfaces primary and deep-linked tab options', () => {
  const workable = filterSidebarItems(arExecUser, 'workable ar');
  assert.ok(workable.some((i) => i.href === '/claims' && i.label === 'Workable AR'));
  assert.ok(workable.some((i) => i.href === '/claims?tab=workable'));

  const unworked = filterSidebarItems(arExecUser, 'unworked ar');
  assert.ok(unworked.some((i) => i.href === '/claims?tab=unworked'));

  const pending = filterSidebarItems(arExecUser, 'pending approval');
  assert.ok(pending.some((i) => i.href === '/claims?tab=pending_approval'));

  const worked = filterSidebarItems(arExecUser, 'worked ar');
  assert.ok(worked.some((i) => i.href === '/claims?tab=worked'));

  const denied = filterSidebarItems(arExecUser, 'denied claims');
  assert.ok(denied.some((i) => i.href === '/claims?tab=record&filter=denied'));
});

test('multi-word & keyword search finds functional destinations while enforcing role boundaries', () => {
  // Password / security sub-option
  const pw = filterSidebarItems(arExecUser, 'change password');
  assert.ok(pw.some((i) => i.href === '/settings/account?tab=security'));

  // 835 ERA processing: visible to admin, hidden from ar_executive
  assert.equal(filterSidebarItems(arExecUser, '835').length, 0);
  assert.ok(filterSidebarItems(orgAdminUser, '835').some((i) => i.href === '/era'));

  // Platform CMS: hidden from non-platform admin, visible to platform admin
  assert.equal(filterSidebarItems(orgAdminUser, 'website cms').length, 0);
  assert.ok(filterSidebarItems(platformAdminUser, 'website cms').some((i) => i.href.startsWith('/admin/platform')));

  // Non-existent option returns empty array cleanly
  assert.deepEqual(filterSidebarItems(platformAdminUser, 'xyznonexistentfunction'), []);
});

test('Sidebar component and deep-linked pages wire search UI and ?tab= query handling', () => {
  assert.ok(SIDEBAR_NAV_ITEMS.length >= 30);

  const sidebarSrc = fs.readFileSync(path.join(repoRoot, 'src/components/layout/Sidebar.tsx'), 'utf8');
  assert.match(sidebarSrc, /filterSidebarItems/);
  assert.match(sidebarSrc, /Search sidebar options/);
  assert.match(sidebarSrc, /ArrowDown/);
  assert.match(sidebarSrc, /ArrowUp/);

  const claimsSrc = fs.readFileSync(path.join(repoRoot, 'src/app/claims/page.tsx'), 'utf8');
  assert.match(claimsSrc, /useSearchParams/);
  assert.match(claimsSrc, /Suspense/);
  assert.match(claimsSrc, /searchParams\.get\('tab'\)/);
});
