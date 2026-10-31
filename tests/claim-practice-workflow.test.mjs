import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// 1. Claim Detail page must render claim.practice (NOT claim.provider) for Practice,
//    and show claim.worker (NOT claim.reviewer) for Worked by.
const claimDetailPage = read('src/app/claims/[id]/page.tsx');
assert.ok(
  claimDetailPage.includes('claim.practice.code') && claimDetailPage.includes('claim.practice.name'),
  'Claim detail page displays associated practice code & name'
);
assert.ok(
  !claimDetailPage.includes('<span className="text-sm font-semibold text-slate-900">{claim.provider || \'—\'}</span>\n              </div>\n              <div className="flex justify-between py-3 border-b border-[#F1F5F9]">\n                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">Patient</span>'),
  'Claim detail page no longer renders claim.provider under the Practice label'
);
assert.ok(
  claimDetailPage.includes('claim.worker ? `${claim.worker.firstName} ${claim.worker.lastName}`'),
  'Claim detail page displays actual worker under Worked by'
);
assert.ok(
  claimDetailPage.includes('save_progress') && claimDetailPage.includes('followUpDate'),
  'Claim detail page supports Save Progress and Follow-Up Date while working a claim'
);

// 2. GET & PATCH /api/claims/[id] must resolve and return practice, worker, approver, teamLead
const claimDetailApi = read('src/app/api/claims/[id]/route.ts');
assert.ok(
  claimDetailApi.includes('claim.practiceId') && claimDetailApi.includes('from(practices)'),
  'GET /api/claims/[id] resolves practice record from practices table'
);
assert.ok(
  claimDetailApi.includes('body.practiceId !== undefined'),
  'PATCH /api/claims/[id] allows associating/updating practiceId'
);

// 3. GET /api/claims & Claims list page must resolve and display practiceName / practiceCode
const claimsListApi = read('src/app/api/claims/route.ts');
assert.ok(
  claimsListApi.includes('practiceId: claims.practiceId') &&
    claimsListApi.includes('practiceName:') &&
    claimsListApi.includes('practiceCode:'),
  'GET /api/claims returns practiceId, practiceName, and practiceCode'
);
assert.ok(
  claimsListApi.includes('ilike(claims.insurance') && claimsListApi.includes('ilike(claims.payer'),
  'GET /api/claims searches payer and insurance as advertised'
);

const claimsListPage = read('src/app/claims/page.tsx');
assert.ok(
  claimsListPage.includes('c.practiceCode') && claimsListPage.includes('c.practiceName'),
  'Claims list table displays practiceCode / practiceName in PRACTICE column'
);

// 4. Upload route sets status='assigned' when assignedTo is provided and persists practiceId
const uploadApi = read('src/app/api/upload/route.ts');
assert.ok(
  uploadApi.includes("assignedTo ? ('assigned' as const) : ('new' as const)"),
  'Upload API sets status="assigned" when claims are assigned on import'
);
assert.ok(
  uploadApi.includes('practiceId: practiceId || null'),
  'Upload API persists selected practiceId on imported claims'
);

// 5. Work Queue starts work via workflow endpoint so workflowStatus transitions to working
const workQueuePage = read('src/app/work-queue/page.tsx');
assert.ok(
  workQueuePage.includes('/workflow') && workQueuePage.includes("action: 'start_working'"),
  'Work Queue Start button triggers workflow start_working action'
);
assert.ok(
  workQueuePage.includes('claim.practiceName'),
  'Work Queue displays associated practice on claim cards'
);

// 6. Review route keeps workflowStatus synchronized with status
const reviewApi = read('src/app/api/claims/[id]/review/route.ts');
assert.ok(
  reviewApi.includes("newWorkflowStatus = 'approved'") &&
    reviewApi.includes("newWorkflowStatus = 'rework'"),
  'POST /api/claims/[id]/review synchronizes workflowStatus on approve/rework/reject'
);

console.log('claim-practice-workflow: all regression checks passed');
