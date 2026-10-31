'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, Textarea } from '@/components/ui/Input';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { CodingReferencePanel } from '@/components/coding/CodingReferencePanel';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Info,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserCheck,
  Wand2,
  Wrench,
  X,
} from 'lucide-react';

interface CodingAuditSummary {
  score: number;
  canSubmitClean: boolean;
  errors: number;
  warnings: number;
  info: number;
  topIssueTitle: string | null;
}

interface CodingReq {
  id: string;
  claimId: string;
  claimNumber: string | null;
  accountNumber?: string | null;
  patientName: string | null;
  dateOfService?: string | null;
  diagnosisCode?: string | null;
  cptCodes?: string | null;
  provider?: string | null;
  payer?: string | null;
  insurance?: string | null;
  billedAmount?: string | null;
  paidAmount?: string | null;
  balance?: string | null;
  claimStatus?: string | null;
  status: string;
  practiceName?: string | null;
  denialReason: string | null;
  comments: string | null;
  correctionNotes: string | null;
  sentBy: string;
  assignedTo: string | null;
  senderName: string;
  assigneeName: string | null;
  documentsCount?: number;
  codingAudit?: CodingAuditSummary;
  createdAt: string;
}

interface AssignableUser {
  id: string;
  name: string;
  role: string;
}

interface QuickFix {
  label: string;
  action:
    | 'replace_icd'
    | 'add_icd'
    | 'remove_icd'
    | 'promote_icd_primary'
    | 'replace_cpt'
    | 'remove_cpt';
  targetCode?: string;
  newCode?: string;
}

interface AuditIssue {
  id: string;
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  category: string;
  title: string;
  message: string;
  affectedCode?: string;
  quickFixes: QuickFix[];
}

interface FullCodingAuditReport {
  score: number;
  canSubmitClean: boolean;
  counts: { errors: number; warnings: number; info: number };
  diagnoses: Array<{
    position: number;
    raw: string;
    code: string;
    exists: boolean;
    billable: boolean;
    description: string;
    laterality: string;
    isUnspecified: boolean;
    isManifestation: boolean;
  }>;
  procedures: Array<{
    raw: string;
    baseCode: string;
    modifiers: string[];
    validSyntax: boolean;
    codeSystem: string;
    sectionLabel: string;
  }>;
  issues: AuditIssue[];
}

function CodingStatusBadge({ status }: { status: string }) {
  const c: Record<
    string,
    { v: 'success' | 'warning' | 'danger' | 'info' | 'default' | 'purple'; l: string }
  > = {
    sent_to_coding: { v: 'info', l: 'Sent to Coding' },
    under_review: { v: 'warning', l: 'Under Review' },
    corrected: { v: 'success', l: 'Corrected' },
    returned_to_billing: { v: 'purple', l: 'Returned to Billing' },
    resubmitted: { v: 'success', l: 'Resubmitted' },
  };
  const cfg = c[status] || { v: 'default' as const, l: status };
  return <Badge variant={cfg.v}>{cfg.l}</Badge>;
}

function splitTokens(val: string): string[] {
  return val
    .split(/[,;\n|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function applyQuickFixToStrings(
  fix: QuickFix,
  currentDx: string,
  currentCpt: string
): { nextDx: string; nextCpt: string } {
  const dxArr = splitTokens(currentDx);
  const cptArr = splitTokens(currentCpt);

  if (fix.action === 'replace_icd' && fix.targetCode && fix.newCode) {
    const idx = dxArr.findIndex((t) => t.toUpperCase() === fix.targetCode!.toUpperCase());
    if (idx >= 0) dxArr[idx] = fix.newCode;
    else dxArr.push(fix.newCode);
  } else if (fix.action === 'add_icd' && fix.newCode) {
    if (!dxArr.some((t) => t.toUpperCase() === fix.newCode!.toUpperCase())) {
      dxArr.push(fix.newCode);
    }
  } else if (fix.action === 'remove_icd' && fix.targetCode) {
    const idx = dxArr.findIndex((t) => t.toUpperCase() === fix.targetCode!.toUpperCase());
    if (idx >= 0) dxArr.splice(idx, 1);
  } else if (fix.action === 'promote_icd_primary' && fix.targetCode) {
    const idx = dxArr.findIndex((t) => t.toUpperCase() === fix.targetCode!.toUpperCase());
    if (idx > 0) {
      const [picked] = dxArr.splice(idx, 1);
      dxArr.unshift(picked);
    }
  } else if (fix.action === 'replace_cpt' && fix.targetCode && fix.newCode) {
    const idx = cptArr.findIndex((t) => t.toUpperCase() === fix.targetCode!.toUpperCase());
    if (idx >= 0) cptArr[idx] = fix.newCode;
    // Special case: replacing 20610 -> 20611 also drops bundled 76942
    if (fix.targetCode.startsWith('20610') && fix.newCode.startsWith('20611')) {
      const usIdx = cptArr.findIndex((t) => t.startsWith('76942'));
      if (usIdx >= 0) cptArr.splice(usIdx, 1);
    }
  } else if (fix.action === 'remove_cpt' && fix.targetCode) {
    const idx = cptArr.findIndex((t) => t.toUpperCase() === fix.targetCode!.toUpperCase());
    if (idx >= 0) cptArr.splice(idx, 1);
  }

  return {
    nextDx: dxArr.join(', '),
    nextCpt: cptArr.join(', '),
  };
}

const STANDALONE_PRESETS = [
  {
    label: 'Truncated M54.5 + Missing -25',
    dx: 'M54.5, M25.569',
    cpt: '99214, 20610',
    denial: 'CO-4: Procedure code inconsistent with modifier / CO-16 truncated diagnosis',
  },
  {
    label: '7th-Char Fracture + Laterality Conflict',
    dx: 'S72.001',
    cpt: '99284, 20610-LT',
    denial: 'MA130: Incomplete / invalid diagnosis code missing 7th character',
  },
  {
    label: 'Excludes1 Conflict + NCCI Lab Bundle',
    dx: 'E10.9, E11.65',
    cpt: '99214, 80053, 80048',
    denial: 'CO-97: Payment adjusted — benefit included in another service',
  },
  {
    label: 'Clean Billable Claim Example',
    dx: 'M17.11, E11.65, Z79.4',
    cpt: '99214-25, 20610-RT, J3301-JZ',
    denial: '',
  },
];

function CodingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialTab = useMemo(() => {
    const t = searchParams.get('tab');
    if (t === 'reference' || t === 'checker' || t === 'queue') return t;
    return 'queue';
  }, [searchParams]);

  const [activeTab, setActiveTab] = useState<'queue' | 'reference' | 'checker'>(initialTab);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'reference' || t === 'checker' || t === 'queue') {
      setActiveTab(t);
    }
  }, [searchParams]);

  // Queue state
  const [requests, setRequests] = useState<CodingReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [queueStats, setQueueStats] = useState({
    total: 0,
    sent_to_coding: 0,
    under_review: 0,
    corrected: 0,
    returned_to_billing: 0,
    resubmitted: 0,
    assignedToMe: 0,
  });

  // Active Workbench state
  const [activeReq, setActiveReq] = useState<CodingReq | null>(null);
  const [editDx, setEditDx] = useState('');
  const [editCpt, setEditCpt] = useState('');
  const [selectedCptIdx, setSelectedCptIdx] = useState<number>(0);
  const [editAssignee, setEditAssignee] = useState('');
  const [editStatus, setEditStatus] = useState('under_review');
  const [editNotes, setEditNotes] = useState('');
  const [inspectCode, setInspectCode] = useState<string | null>(null);
  const [workbenchAudit, setWorkbenchAudit] = useState<FullCodingAuditReport | null>(null);
  const [checkingAudit, setCheckingAudit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const workbenchRef = useRef<HTMLDivElement | null>(null);

  // Standalone Checker state
  const [checkerDx, setCheckerDx] = useState(STANDALONE_PRESETS[0].dx);
  const [checkerCpt, setCheckerCpt] = useState(STANDALONE_PRESETS[0].cpt);
  const [checkerDenial, setCheckerDenial] = useState(STANDALONE_PRESETS[0].denial);
  const [checkerReport, setCheckerReport] = useState<FullCodingAuditReport | null>(null);
  const [checkerInspectCode, setCheckerInspectCode] = useState<string | null>('M54.5');

  const openWorkbench = useCallback((req: CodingReq) => {
    setActiveReq(req);
    const dx = req.diagnosisCode || '';
    const cpt = req.cptCodes || '';
    setEditDx(dx);
    setEditCpt(cpt);
    setSelectedCptIdx(0);
    setEditAssignee(req.assignedTo || '');
    setEditStatus(req.status === 'sent_to_coding' ? 'under_review' : req.status);
    setEditNotes(req.correctionNotes || '');
    setBanner(null);
    const firstDx = splitTokens(dx)[0] || null;
    setInspectCode(firstDx);
    setTimeout(() => {
      workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, []);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter) p.set('status', statusFilter);
      if (assignedFilter) p.set('assignedTo', assignedFilter);
      if (searchText.trim()) p.set('search', searchText.trim());
      const urlClaimId = searchParams.get('claimId');
      if (urlClaimId && !searchText.trim()) p.set('claimId', urlClaimId);

      const res = await fetch(`/api/coding?${p}`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok) {
        const list: CodingReq[] = data.codingRequests || [];
        setRequests(list);
        setTotalPages(data.pagination?.totalPages || 1);
        if (data.currentUserId) setCurrentUserId(data.currentUserId);
        if (data.queueStats) setQueueStats(data.queueStats);
        if (data.assignableUsers) setAssignableUsers(data.assignableUsers);

        const urlReqId = searchParams.get('requestId');
        if (urlReqId) {
          const found = list.find((r) => r.id === urlReqId);
          if (found) openWorkbench(found);
        } else if (urlClaimId && list.length > 0 && !activeReq) {
          openWorkbench(list[0]);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, assignedFilter, searchText, searchParams, openWorkbench, activeReq]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Live Coding Error Check for active Workbench claim
  useEffect(() => {
    if (!activeReq) {
      setWorkbenchAudit(null);
      return;
    }
    const timer = setTimeout(async () => {
      setCheckingAudit(true);
      try {
        const res = await fetch('/api/coding/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            diagnosisCodes: editDx,
            cptCodes: editCpt,
            denialReason: activeReq.denialReason,
            billedAmount: activeReq.billedAmount,
            dateOfService: activeReq.dateOfService,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setWorkbenchAudit(data.report || null);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setCheckingAudit(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [activeReq, editDx, editCpt]);

  // Live Coding Error Check for Standalone Checker tab
  useEffect(() => {
    if (activeTab !== 'checker') return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/coding/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            diagnosisCodes: checkerDx,
            cptCodes: checkerCpt,
            denialReason: checkerDenial,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setCheckerReport(data.report || null);
        }
      } catch (e) {
        console.error(e);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [activeTab, checkerDx, checkerCpt, checkerDenial]);

  const handleQuickAssignMe = async (req: CodingReq) => {
    try {
      const res = await fetch(`/api/coding/${req.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          assignedTo: 'me',
          status: req.status === 'sent_to_coding' ? 'under_review' : req.status,
        }),
      });
      if (res.ok) {
        await fetchRequests();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddDiagnosisToWorkbench = (code: string, asPrimary = false) => {
    const arr = splitTokens(editDx).filter((c) => c.toUpperCase() !== code.toUpperCase());
    if (asPrimary) arr.unshift(code);
    else arr.push(code);
    setEditDx(arr.join(', '));
    setInspectCode(code);
  };

  const handleAddProcedureToWorkbench = (code: string) => {
    const arr = splitTokens(editCpt);
    arr.push(code);
    setEditCpt(arr.join(', '));
    setSelectedCptIdx(arr.length - 1);
  };

  const handleAppendModifierToWorkbench = (modifier: string) => {
    const arr = splitTokens(editCpt);
    if (arr.length === 0) return;
    const idx = Math.min(selectedCptIdx, arr.length - 1);
    const token = arr[idx];
    const parts = token.split('-').filter(Boolean);
    if (!parts.slice(1).includes(modifier.toUpperCase())) {
      parts.push(modifier.toUpperCase());
    }
    arr[idx] = parts.join('-');
    setEditCpt(arr.join(', '));
  };

  const moveDiagnosis = (index: number, dir: -1 | 1) => {
    const arr = splitTokens(editDx);
    const target = index + dir;
    if (target < 0 || target >= arr.length) return;
    const tmp = arr[index];
    arr[index] = arr[target];
    arr[target] = tmp;
    setEditDx(arr.join(', '));
  };

  const removeDiagnosisAt = (index: number) => {
    const arr = splitTokens(editDx);
    arr.splice(index, 1);
    setEditDx(arr.join(', '));
  };

  const removeProcedureAt = (index: number) => {
    const arr = splitTokens(editCpt);
    arr.splice(index, 1);
    setEditCpt(arr.join(', '));
    setSelectedCptIdx(0);
  };

  const autoDraftSummary = () => {
    if (!activeReq) return;
    const oldDx = activeReq.diagnosisCode || 'None';
    const newDx = editDx.trim() || 'None';
    const oldCpt = activeReq.cptCodes || 'None';
    const newCpt = editCpt.trim() || 'None';
    const parts: string[] = [];
    if (oldDx !== newDx) parts.push(`Updated ICD-10-CM diagnosis codes from [${oldDx}] to [${newDx}]`);
    else parts.push(`Verified FY2027 ICD-10-CM diagnosis specificity [${newDx}]`);
    if (oldCpt !== newCpt) parts.push(`Updated CPT/HCPCS & modifiers from [${oldCpt}] to [${newCpt}]`);
    else parts.push(`Verified CPT/HCPCS & NCCI modifier compliance [${newCpt}]`);
    if (workbenchAudit) {
      parts.push(
        `In-app Coding Scrubber score: ${workbenchAudit.score}/100 (${workbenchAudit.counts.errors} errors, ${workbenchAudit.counts.warnings} warnings)`
      );
    }
    setEditNotes(parts.join('. ') + '.');
  };

  const handleSaveWorkbench = async () => {
    if (!activeReq) return;
    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/coding/${activeReq.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          status: editStatus,
          assignedTo: editAssignee || null,
          correctionNotes: editNotes,
          diagnosisCode: editDx,
          cptCodes: editCpt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: 'err', text: data.error || 'Failed to save coding updates' });
        return;
      }
      setBanner({
        type: 'ok',
        text: `Saved coding updates for Claim ${activeReq.claimNumber || ''} (${editStatus.replace(/_/g, ' ')}).`,
      });
      setActiveReq((prev) =>
        prev
          ? {
              ...prev,
              status: editStatus,
              assignedTo: editAssignee || null,
              correctionNotes: editNotes,
              diagnosisCode: data.claim?.diagnosisCode ?? editDx,
              cptCodes: data.claim?.cptCodes ?? editCpt,
            }
          : null
      );
      await fetchRequests();
    } catch (e) {
      console.error(e);
      setBanner({ type: 'err', text: 'Network error while saving coding updates' });
    } finally {
      setSaving(false);
    }
  };

  const dxTokens = splitTokens(editDx);
  const cptTokens = splitTokens(editCpt);

  return (
    <AppLayout title="Coding Queue &amp; ICD-10 / CPT Studio">
      <div className="space-y-5">
        {/* Top KPI & Mode Navigation Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <button
            type="button"
            onClick={() => {
              setActiveTab('queue');
              setStatusFilter('sent_to_coding');
              setPage(1);
            }}
            className={`text-left p-3.5 rounded-xl border transition bg-white hover:border-blue-400 ${
              statusFilter === 'sent_to_coding' && activeTab === 'queue'
                ? 'border-blue-500 ring-2 ring-blue-100'
                : 'border-slate-200'
            }`}
          >
            <p className="text-xs font-medium text-slate-500">Sent to Coding</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{queueStats.sent_to_coding}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Awaiting coder pickup</p>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('queue');
              setStatusFilter('under_review');
              setPage(1);
            }}
            className={`text-left p-3.5 rounded-xl border transition bg-white hover:border-amber-400 ${
              statusFilter === 'under_review' && activeTab === 'queue'
                ? 'border-amber-500 ring-2 ring-amber-100'
                : 'border-slate-200'
            }`}
          >
            <p className="text-xs font-medium text-slate-500">Under Coding Review</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{queueStats.under_review}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Active code audit</p>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('queue');
              setStatusFilter('corrected');
              setPage(1);
            }}
            className={`text-left p-3.5 rounded-xl border transition bg-white hover:border-emerald-400 ${
              statusFilter === 'corrected' && activeTab === 'queue'
                ? 'border-emerald-500 ring-2 ring-emerald-100'
                : 'border-slate-200'
            }`}
          >
            <p className="text-xs font-medium text-slate-500">Corrected &amp; Verified</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{queueStats.corrected}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Ready for billing/resubmit</p>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('queue');
              setAssignedFilter(assignedFilter === 'me' ? '' : 'me');
              setPage(1);
            }}
            className={`text-left p-3.5 rounded-xl border transition bg-white hover:border-indigo-400 ${
              assignedFilter === 'me' && activeTab === 'queue'
                ? 'border-indigo-500 ring-2 ring-indigo-100'
                : 'border-slate-200'
            }`}
          >
            <p className="text-xs font-medium text-slate-500">Assigned to Me</p>
            <p className="text-2xl font-bold text-indigo-600 mt-1">{queueStats.assignedToMe}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Click to filter my queue</p>
          </button>

          <div className="col-span-2 lg:col-span-1 p-3.5 rounded-xl bg-gradient-to-br from-slate-900 to-indigo-950 text-white flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300">
                FY2027 ICD-10-CM
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold">
                Zero Ads
              </span>
            </div>
            <p className="text-sm font-semibold mt-1">102,966 Codes Built In</p>
            <p className="text-[11px] text-slate-300">
              Specificity • Excludes1 • NCCI • Modifiers
            </p>
          </div>
        </div>

        {/* Workspace Mode Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition ${
                activeTab === 'queue'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <ClipboardCheck className="w-4 h-4" />
              Coding Queue &amp; Workbench
              <span
                className={`px-1.5 py-0.5 rounded-full text-xs ${
                  activeTab === 'queue'
                    ? 'bg-indigo-500 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {queueStats.total}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('reference')}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition ${
                activeTab === 'reference'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              ICD-10-CM &amp; CPT Reference Lookup
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('checker')}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition ${
                activeTab === 'checker'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              Coding Error &amp; NCCI Checker
            </button>
          </div>

          {(statusFilter || assignedFilter || searchText) && activeTab === 'queue' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatusFilter('');
                setAssignedFilter('');
                setSearchText('');
                setPage(1);
              }}
            >
              Reset Queue Filters
            </Button>
          )}
        </div>

        {/* ==================== TAB 1: CODING QUEUE & IN-APP WORKBENCH ==================== */}
        {activeTab === 'queue' && (
          <div className="space-y-5">
            <Card padding="none">
              <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[230px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchText}
                    onChange={(e) => {
                      setSearchText(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search Claim #, Patient, ICD-10, CPT, Payer, or Denial..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <Select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  options={[
                    { value: '', label: 'All Statuses' },
                    { value: 'sent_to_coding', label: 'Sent to Coding' },
                    { value: 'under_review', label: 'Under Review' },
                    { value: 'corrected', label: 'Corrected' },
                    { value: 'returned_to_billing', label: 'Returned to Billing' },
                    { value: 'resubmitted', label: 'Resubmitted' },
                  ]}
                  className="w-48"
                />

                <Select
                  value={assignedFilter}
                  onChange={(e) => {
                    setAssignedFilter(e.target.value);
                    setPage(1);
                  }}
                  options={[
                    { value: '', label: 'All Assignees' },
                    { value: 'me', label: 'Assigned to Me' },
                    { value: 'unassigned', label: 'Unassigned' },
                    ...assignableUsers.map((u) => ({
                      value: u.id,
                      label: `${u.name} (${u.role.replace(/_/g, ' ')})`,
                    })),
                  ]}
                  className="w-56"
                />
              </div>

              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeader>Claim &amp; Practice</TableHeader>
                    <TableHeader>Patient &amp; Payer</TableHeader>
                    <TableHeader>Current Codes (ICD-10 / CPT)</TableHeader>
                    <TableHeader>Auto Coding Audit</TableHeader>
                    <TableHeader>Denial / Issue</TableHeader>
                    <TableHeader>Assigned Coder</TableHeader>
                    <TableHeader>Status</TableHeader>
                    <TableHeader>Workbench</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8">
                        Loading coding queue...
                      </TableCell>
                    </TableRow>
                  ) : requests.length === 0 ? (
                    <TableEmpty message="No coding requests match current filters" />
                  ) : (
                    requests.map((r) => {
                      const isSelected = activeReq?.id === r.id;
                      const dxs = splitTokens(r.diagnosisCode || '');
                      const cpts = splitTokens(r.cptCodes || '');
                      return (
                        <TableRow
                          key={r.id}
                          className={isSelected ? 'bg-indigo-50/70' : undefined}
                        >
                          <TableCell>
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  className="text-indigo-600 hover:underline font-semibold text-sm"
                                  onClick={() => openWorkbench(r)}
                                >
                                  {r.claimNumber || 'Claim'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => router.push(`/claims/${r.claimId}`)}
                                  className="text-slate-400 hover:text-indigo-600"
                                  title="Open full claim detail page"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <p className="text-xs text-slate-500 truncate max-w-[180px]">
                                {r.practiceName || 'Unassigned Practice'}
                              </p>
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="space-y-0.5">
                              <p className="text-sm font-medium text-slate-800">
                                {r.patientName || '-'}
                              </p>
                              <p className="text-xs text-slate-500">
                                {r.payer || r.insurance || 'No Payer'}
                                {r.dateOfService ? ` • DOS ${r.dateOfService}` : ''}
                              </p>
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="space-y-1 max-w-[230px]">
                              <div className="flex flex-wrap gap-1">
                                {dxs.length === 0 ? (
                                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-medium">
                                    Missing ICD-10
                                  </span>
                                ) : (
                                  dxs.slice(0, 3).map((dx) => (
                                    <button
                                      key={dx}
                                      type="button"
                                      onClick={() => {
                                        openWorkbench(r);
                                        setInspectCode(dx);
                                      }}
                                      className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 hover:bg-indigo-100"
                                      title="Inspect ICD-10-CM code in Workbench"
                                    >
                                      {dx}
                                    </button>
                                  ))
                                )}
                                {dxs.length > 3 && (
                                  <span className="text-[11px] text-slate-500">
                                    +{dxs.length - 3}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {cpts.length === 0 ? (
                                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-medium">
                                    Missing CPT
                                  </span>
                                ) : (
                                  cpts.slice(0, 3).map((c) => (
                                    <span
                                      key={c}
                                      className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700"
                                    >
                                      {c}
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell>
                            {r.codingAudit ? (
                              <div className="space-y-0.5 max-w-[190px]">
                                {r.codingAudit.errors > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">
                                    <ShieldAlert className="w-3.5 h-3.5" />
                                    {r.codingAudit.errors} Error
                                    {r.codingAudit.errors > 1 ? 's' : ''}
                                    {r.codingAudit.warnings > 0
                                      ? ` • ${r.codingAudit.warnings} Warn`
                                      : ''}
                                  </span>
                                ) : r.codingAudit.warnings > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    {r.codingAudit.warnings} Warning
                                    {r.codingAudit.warnings > 1 ? 's' : ''}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Codes Clean ({r.codingAudit.score})
                                  </span>
                                )}
                                {r.codingAudit.topIssueTitle && (
                                  <p
                                    className="text-[11px] text-slate-500 truncate"
                                    title={r.codingAudit.topIssueTitle}
                                  >
                                    {r.codingAudit.topIssueTitle}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </TableCell>

                          <TableCell>
                            <span className="text-xs text-slate-700 line-clamp-2 max-w-[200px]">
                              {r.denialReason || r.comments || '—'}
                            </span>
                          </TableCell>

                          <TableCell>
                            {r.assigneeName ? (
                              <span className="text-xs font-medium text-slate-800">
                                {r.assigneeName}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleQuickAssignMe(r)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                Assign to Me
                              </button>
                            )}
                          </TableCell>

                          <TableCell>
                            <CodingStatusBadge status={r.status} />
                          </TableCell>

                          <TableCell>
                            <Button
                              size="sm"
                              variant={isSelected ? 'primary' : 'outline'}
                              onClick={() => openWorkbench(r)}
                            >
                              <Wrench className="w-3.5 h-3.5 mr-1" />
                              {isSelected ? 'Editing' : 'Code & Check'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
                <p className="text-sm text-slate-600">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>

            {/* SPLIT-SCREEN IN-APP CLAIM CODING WORKBENCH */}
            <div ref={workbenchRef}>
              {activeReq ? (
                <div className="bg-slate-50 border-2 border-indigo-200 rounded-2xl p-4 lg:p-5 space-y-4 shadow-sm">
                  {/* Workbench Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold text-sm flex items-center gap-2">
                        <Stethoscope className="w-4 h-4" />
                        Coding Workbench: {activeReq.claimNumber || 'Claim'}
                      </div>
                      <CodingStatusBadge status={activeReq.status} />
                      {activeReq.practiceName && (
                        <span className="text-xs font-medium text-slate-600 bg-white px-2.5 py-1 rounded-md border border-slate-200">
                          {activeReq.practiceName}
                        </span>
                      )}
                      {typeof activeReq.documentsCount === 'number' && activeReq.documentsCount > 0 && (
                        <span className="text-xs text-slate-600 flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5 text-slate-400" />
                          {activeReq.documentsCount} attached doc(s)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/claims/${activeReq.claimId}`)}
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-1" />
                        Full Claim Record
                      </Button>
                      <button
                        type="button"
                        onClick={() => setActiveReq(null)}
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200"
                        title="Close Coding Workbench"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {banner && (
                    <div
                      className={`p-3 rounded-lg text-sm flex items-center justify-between ${
                        banner.type === 'ok'
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                          : 'bg-rose-50 border border-rose-200 text-rose-900'
                      }`}
                    >
                      <span>{banner.text}</span>
                      <button
                        type="button"
                        onClick={() => setBanner(null)}
                        className="text-xs underline ml-3"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}

                  {/* Split-Screen Columns: Left = Claim Code Editor & Live Scrubber | Right = Ad-Free ICD-10 / CPT Studio */}
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
                    {/* LEFT PANE */}
                    <div className="xl:col-span-6 space-y-4">
                      {/* Claim Clinical Context Card */}
                      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div>
                            <p className="text-slate-400">Patient</p>
                            <p className="font-semibold text-slate-800">
                              {activeReq.patientName || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-400">Payer</p>
                            <p className="font-semibold text-slate-800">
                              {activeReq.payer || activeReq.insurance || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-400">Date of Service</p>
                            <p className="font-semibold text-slate-800">
                              {activeReq.dateOfService || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-400">Billed / Balance</p>
                            <p className="font-semibold text-slate-800">
                              ${Number(activeReq.billedAmount || 0).toFixed(2)} / $
                              {Number(activeReq.balance || 0).toFixed(2)}
                            </p>
                          </div>
                        </div>

                        {(activeReq.denialReason || activeReq.comments) && (
                          <div className="p-3 rounded-lg bg-rose-50/80 border border-rose-200 text-xs space-y-1">
                            {activeReq.denialReason && (
                              <p className="text-rose-900">
                                <strong>Denial / Rejection Reason:</strong> {activeReq.denialReason}
                              </p>
                            )}
                            {activeReq.comments && (
                              <p className="text-slate-700">
                                <strong>Sender Comments ({activeReq.senderName}):</strong>{' '}
                                {activeReq.comments}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Editable ICD-10-CM Diagnosis Section */}
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                              ICD-10-CM Diagnosis Codes (Item 21 — Ordered Primary #1 → Secondary)
                            </label>
                            <span className="text-[11px] text-slate-400">
                              Click any code to inspect rules →
                            </span>
                          </div>

                          {dxTokens.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {dxTokens.map((tok, i) => {
                                const diagMeta = workbenchAudit?.diagnoses[i];
                                const isBad = diagMeta && (!diagMeta.exists || !diagMeta.billable);
                                return (
                                  <div
                                    key={`${tok}-${i}`}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs ${
                                      isBad
                                        ? 'bg-rose-50 border-rose-300 text-rose-900'
                                        : i === 0
                                          ? 'bg-indigo-50 border-indigo-300 text-indigo-950'
                                          : 'bg-slate-50 border-slate-300 text-slate-800'
                                    }`}
                                  >
                                    <span className="text-[10px] font-bold text-slate-400">
                                      #{i + 1}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setInspectCode(tok)}
                                      className="font-mono font-bold hover:underline"
                                      title={diagMeta?.description || 'Click to inspect in studio'}
                                    >
                                      {tok}
                                    </button>
                                    {i > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => moveDiagnosis(i, -1)}
                                        className="text-slate-400 hover:text-indigo-700"
                                        title="Move earlier in sequence"
                                      >
                                        <ArrowUp className="w-3 h-3" />
                                      </button>
                                    )}
                                    {i < dxTokens.length - 1 && (
                                      <button
                                        type="button"
                                        onClick={() => moveDiagnosis(i, 1)}
                                        className="text-slate-400 hover:text-indigo-700"
                                        title="Move later in sequence"
                                      >
                                        <ArrowDown className="w-3 h-3" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => removeDiagnosisAt(i)}
                                      className="text-slate-400 hover:text-rose-600 ml-0.5"
                                      title="Remove diagnosis"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          <input
                            type="text"
                            value={editDx}
                            onChange={(e) => setEditDx(e.target.value)}
                            placeholder="Comma-separated FY2027 ICD-10-CM codes (e.g., M54.50, E11.65, Z79.4)"
                            className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        {/* Editable CPT / HCPCS & Modifiers Section */}
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                              CPT / HCPCS Procedure Codes &amp; Modifiers (Item 24D)
                            </label>
                            <span className="text-[11px] text-slate-400">
                              Select a CPT chip to append modifiers
                            </span>
                          </div>

                          {cptTokens.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {cptTokens.map((tok, i) => (
                                <div
                                  key={`${tok}-${i}`}
                                  onClick={() => setSelectedCptIdx(i)}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer ${
                                    selectedCptIdx === i
                                      ? 'bg-indigo-600 border-indigo-600 text-white'
                                      : 'bg-slate-50 border-slate-300 text-slate-800 hover:border-indigo-300'
                                  }`}
                                >
                                  <span className="font-mono font-bold">{tok}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeProcedureAt(i);
                                    }}
                                    className={
                                      selectedCptIdx === i
                                        ? 'text-indigo-200 hover:text-white'
                                        : 'text-slate-400 hover:text-rose-600'
                                    }
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <input
                            type="text"
                            value={editCpt}
                            onChange={(e) => setEditCpt(e.target.value)}
                            placeholder="Comma-separated CPT/HCPCS with modifiers (e.g., 99214-25, 20610-RT, J3301-JZ)"
                            className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />

                          {/* Quick Modifier Bar */}
                          <div className="flex flex-wrap items-center gap-1 pt-0.5">
                            <span className="text-[11px] text-slate-500 mr-1">
                              Quick modifier on #{selectedCptIdx + 1}:
                            </span>
                            {['25', '59', 'XS', 'XE', 'RT', 'LT', '50', '26', 'TC', 'JZ', 'JW', 'KX', 'QW', '95'].map(
                              (mod) => (
                                <button
                                  key={mod}
                                  type="button"
                                  onClick={() => handleAppendModifierToWorkbench(mod)}
                                  disabled={cptTokens.length === 0}
                                  className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-indigo-100 hover:text-indigo-800 disabled:opacity-40 text-[11px] font-mono text-slate-700"
                                >
                                  +{mod}
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      </div>

                      {/* LIVE AUTOMATED CODING ERROR & NCCI AUDIT PANEL */}
                      <CodingAuditPanel
                        report={workbenchAudit}
                        loading={checkingAudit}
                        onInspectCode={(c) => setInspectCode(c)}
                        onApplyFix={(fix) => {
                          const { nextDx, nextCpt } = applyQuickFixToStrings(fix, editDx, editCpt);
                          setEditDx(nextDx);
                          setEditCpt(nextCpt);
                        }}
                      />

                      {/* Assignment, Status & Save Card */}
                      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs font-medium text-slate-700">
                                Assigned Coder
                              </label>
                              {currentUserId && editAssignee !== currentUserId && (
                                <button
                                  type="button"
                                  onClick={() => setEditAssignee(currentUserId)}
                                  className="text-[11px] text-indigo-600 hover:underline font-medium"
                                >
                                  Assign to Me
                                </button>
                              )}
                            </div>
                            <Select
                              value={editAssignee}
                              onChange={(e) => setEditAssignee(e.target.value)}
                              options={[
                                { value: '', label: 'Unassigned' },
                                ...assignableUsers.map((u) => ({
                                  value: u.id,
                                  label: `${u.name} (${u.role.replace(/_/g, ' ')})`,
                                })),
                              ]}
                            />
                          </div>

                          <Select
                            label="Coding Disposition / Status"
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value)}
                            options={[
                              { value: 'sent_to_coding', label: 'Sent to Coding (Queued)' },
                              { value: 'under_review', label: 'Under Review' },
                              { value: 'corrected', label: 'Corrected — Apply & Ready' },
                              { value: 'returned_to_billing', label: 'Return to Billing Team' },
                              { value: 'resubmitted', label: 'Resubmitted to Payer' },
                            ]}
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-medium text-slate-700">
                              Clinical Coding &amp; Correction Notes (Logged to Claim Audit Trail)
                            </label>
                            <button
                              type="button"
                              onClick={autoDraftSummary}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                            >
                              <Wand2 className="w-3 h-3" />
                              Auto-Draft Summary
                            </button>
                          </div>
                          <Textarea
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            rows={3}
                            placeholder="Document code specificity updates, modifier rationale (-25 / -XS), or chart documentation findings..."
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <span className="text-xs text-slate-500">
                            Updates claim codes, claim notes, status history, and audit log atomically.
                          </span>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="secondary"
                              onClick={() => setActiveReq(null)}
                            >
                              Close
                            </Button>
                            <Button onClick={handleSaveWorkbench} loading={saving}>
                              Save Code Corrections &amp; Update Claim
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* RIGHT PANE: EMBEDDED AD-FREE ICD-10-CM / CPT / MODIFIER STUDIO */}
                    <div className="xl:col-span-6">
                      <CodingReferencePanel
                        compact
                        inspectCode={inspectCode}
                        onAddDiagnosis={handleAddDiagnosisToWorkbench}
                        onAddProcedure={handleAddProcedureToWorkbench}
                        onAppendModifier={handleAppendModifierToWorkbench}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-5 rounded-xl bg-indigo-50/60 border border-indigo-200 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        In-App Coding Workbench &amp; Zero-Ad ICD-10-CM / CPT Lookup Ready
                      </h3>
                      <p className="text-xs text-slate-600">
                        Click <strong>&ldquo;Code &amp; Check&rdquo;</strong> on any queued claim above to open the split-screen coding workbench, or open the standalone Reference &amp; Error Checker tabs anytime.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveTab('reference')}
                    >
                      Open ICD-10-CM Lookup
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setActiveTab('checker')}
                    >
                      Run Standalone Error Checker
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== TAB 2: STANDALONE AD-FREE ICD-10-CM & CPT REFERENCE ==================== */}
        {activeTab === 'reference' && (
          <CodingReferencePanel
            inspectCode={searchParams.get('code') || 'E11.65'}
            initialQuery={searchParams.get('q') || ''}
          />
        )}

        {/* ==================== TAB 3: STANDALONE CODING ERROR & NCCI CHECKER ==================== */}
        {activeTab === 'checker' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            <div className="xl:col-span-6 space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-indigo-600" />
                      Interactive Claim Coding Error &amp; NCCI Scrubber
                    </h3>
                    <p className="text-xs text-slate-500">
                      Test any combination of ICD-10-CM, CPT/HCPCS, and modifiers against official FY2027 specificity, Excludes1, 7th-character, laterality, and NCCI bundling rules.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-slate-500 mr-1">
                    Load sample scenario:
                  </span>
                  {STANDALONE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setCheckerDx(preset.dx);
                        setCheckerCpt(preset.cpt);
                        setCheckerDenial(preset.denial);
                        const first = splitTokens(preset.dx)[0];
                        if (first) setCheckerInspectCode(first);
                      }}
                      className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-xs font-medium text-slate-700 transition"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      ICD-10-CM Diagnosis Codes (Ordered Primary #1 → Secondary)
                    </label>
                    <input
                      type="text"
                      value={checkerDx}
                      onChange={(e) => setCheckerDx(e.target.value)}
                      placeholder="e.g., M54.5, E11.65, Z79.4"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      CPT / HCPCS Procedure Codes &amp; Modifiers
                    </label>
                    <input
                      type="text"
                      value={checkerCpt}
                      onChange={(e) => setCheckerCpt(e.target.value)}
                      placeholder="e.g., 99214-25, 20610-RT, J3301-JZ"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Optional Payer Denial Code / Remark (CO-4, CO-11, CO-16, CO-50, CO-97, MA130...)
                    </label>
                    <input
                      type="text"
                      value={checkerDenial}
                      onChange={(e) => setCheckerDenial(e.target.value)}
                      placeholder="e.g., CO-97 Payment included in allowance for another service"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              <CodingAuditPanel
                report={checkerReport}
                loading={false}
                onInspectCode={(c) => setCheckerInspectCode(c)}
                onApplyFix={(fix) => {
                  const { nextDx, nextCpt } = applyQuickFixToStrings(fix, checkerDx, checkerCpt);
                  setCheckerDx(nextDx);
                  setCheckerCpt(nextCpt);
                }}
              />
            </div>

            <div className="xl:col-span-6">
              <CodingReferencePanel
                compact
                inspectCode={checkerInspectCode}
                onAddDiagnosis={(code, asPrimary) => {
                  const arr = splitTokens(checkerDx).filter(
                    (c) => c.toUpperCase() !== code.toUpperCase()
                  );
                  if (asPrimary) arr.unshift(code);
                  else arr.push(code);
                  setCheckerDx(arr.join(', '));
                }}
                onAddProcedure={(code) => {
                  const arr = splitTokens(checkerCpt);
                  arr.push(code);
                  setCheckerCpt(arr.join(', '));
                }}
                onAppendModifier={(mod) => {
                  const arr = splitTokens(checkerCpt);
                  if (arr.length === 0) return;
                  arr[0] = `${arr[0]}-${mod}`;
                  setCheckerCpt(arr.join(', '));
                }}
              />
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function CodingAuditPanel({
  report,
  loading,
  onInspectCode,
  onApplyFix,
}: {
  report: FullCodingAuditReport | null;
  loading: boolean;
  onInspectCode: (code: string) => void;
  onApplyFix: (fix: QuickFix) => void;
}) {
  if (!report) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 text-sm text-slate-500">
        {loading ? 'Running FY2027 ICD-10-CM & NCCI coding audit...' : 'Enter codes above to run live coding audit.'}
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div
        className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2 ${
          report.canSubmitClean
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-rose-50 border-rose-200'
        }`}
      >
        <div className="flex items-center gap-2.5">
          {report.canSubmitClean ? (
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-rose-600" />
          )}
          <div>
            <h4 className="text-sm font-semibold text-slate-900">
              {report.canSubmitClean
                ? 'Clean Coding Check Passed — Ready for Submission'
                : `${report.counts.errors} Coding Error${report.counts.errors > 1 ? 's' : ''} Detected — Correction Required`}
            </h4>
            <p className="text-xs text-slate-600">
              Clean-Claim Coding Score: <strong>{report.score}/100</strong> •{' '}
              {report.counts.errors} Error(s), {report.counts.warnings} Warning(s),{' '}
              {report.counts.info} Clinical Rule Note(s)
            </p>
          </div>
        </div>
        {loading && <span className="text-xs text-slate-500">Refreshing...</span>}
      </div>

      <div className="p-4 space-y-3">
        {/* Parsed Diagnosis Summary */}
        {report.diagnoses.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Validated Diagnosis Sequence
            </p>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {report.diagnoses.map((d) => (
                <div
                  key={`${d.position}-${d.raw}`}
                  className="px-3 py-1.5 text-xs flex items-center justify-between gap-2"
                >
                  <button
                    type="button"
                    onClick={() => onInspectCode(d.code)}
                    className="text-left flex items-center gap-2 min-w-0 flex-1 hover:text-indigo-700"
                  >
                    <span className="font-mono text-[10px] text-slate-400">#{d.position}</span>
                    <span className="font-mono font-bold text-indigo-700">{d.code}</span>
                    <span className="truncate text-slate-700">
                      {d.exists ? d.description : 'Unrecognized ICD-10-CM code'}
                    </span>
                  </button>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                      !d.exists
                        ? 'bg-rose-100 text-rose-800'
                        : d.billable
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {!d.exists ? 'Invalid' : d.billable ? 'Billable FY27' : 'Non-Billable Header'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Issues & 1-Click Quick Fixes */}
        {report.issues.length === 0 ? (
          <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            All ICD-10-CM codes are specific FY2027 billable codes with zero Excludes1, laterality, or NCCI bundling conflicts.
          </div>
        ) : (
          <div className="space-y-2.5">
            {report.issues.map((iss) => {
              const styles =
                iss.severity === 'error'
                  ? {
                      box: 'bg-rose-50/70 border-rose-200',
                      icon: <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />,
                      badge: 'bg-rose-100 text-rose-800',
                    }
                  : iss.severity === 'warning'
                    ? {
                        box: 'bg-amber-50/70 border-amber-200',
                        icon: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />,
                        badge: 'bg-amber-100 text-amber-800',
                      }
                    : {
                        box: 'bg-sky-50/70 border-sky-200',
                        icon: <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />,
                        badge: 'bg-sky-100 text-sky-800',
                      };
              return (
                <div key={iss.id} className={`p-3 rounded-lg border ${styles.box} space-y-2`}>
                  <div className="flex items-start gap-2">
                    {styles.icon}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${styles.badge}`}>
                          {iss.ruleId}
                        </span>
                        <span className="text-[11px] font-medium text-slate-500">
                          {iss.category}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-900 mt-0.5">{iss.title}</p>
                      <p className="text-xs text-slate-700 mt-0.5">{iss.message}</p>
                    </div>
                  </div>

                  {iss.quickFixes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pl-6">
                      {iss.quickFixes.map((qf, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => onApplyFix(qf)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white hover:bg-indigo-600 hover:text-white border border-indigo-300 text-indigo-800 text-[11px] font-semibold shadow-2xs transition"
                        >
                          <Sparkles className="w-3 h-3" />
                          {qf.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CodingPage() {
  return (
    <Suspense
      fallback={
        <AppLayout title="Coding Queue &amp; ICD-10 / CPT Studio">
          <div className="p-8 text-center text-slate-500">Loading Coding Studio...</div>
        </AppLayout>
      }
    >
      <CodingPageContent />
    </Suspense>
  );
}
