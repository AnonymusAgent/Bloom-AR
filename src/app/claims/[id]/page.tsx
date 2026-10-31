'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select, Textarea } from '@/components/ui/Input';
import {
  X,
  Paperclip,
  ArrowRight,
  Send,
  FileText,
  Clock,
  User,
  ChevronDown,
  CheckCircle,
  XCircle,
  RotateCcw,
  Brain,
  AlertTriangle,
  Building2,
  Download,
  ExternalLink,
  Save,
  Plus,
} from 'lucide-react';
import { DenialCodeSearch } from '@/components/ui/DenialCodeSearch';
import { MedicalInlineLoader } from '@/components/ui/MedicalLoader';

interface UserRef {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface PracticeRef {
  id: string;
  name: string;
  code: string;
  specialty: string | null;
  npi: string | null;
}

interface ClaimDetail {
  id: string;
  claimNumber: string;
  accountNumber: string | null;
  patientName: string | null;
  dateOfService: string | null;
  cptCodes: string | null;
  diagnosisCode: string | null;
  location: string | null;
  provider: string | null;
  insurance: string | null;
  payer: string | null;
  billedAmount: string | null;
  paidAmount: string | null;
  balance: string | null;
  status: string;
  priority: string | null;
  practiceId: string | null;
  practice: PracticeRef | null;
  reviewComments: string | null;
  denialReason: string | null;
  workflowStatus: string | null;
  claimInsuranceStatus: string | null;
  subStatus: string | null;
  followUpDate: string | null;
  reworkReason: string | null;
  reworkCount: number | null;
  workedBy: string | null;
  workedDate: string | null;
  assignee: UserRef | null;
  worker: UserRef | null;
  approver: UserRef | null;
  reviewer: UserRef | null;
  teamLead: UserRef | null;
  denialCode: { id: number; code: string; codeType: string; description: string; category: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

interface Note {
  id: string;
  note: string;
  actionPerformed: string | null;
  userName: string;
  createdAt: string;
}

interface StatusHistoryItem {
  id: string;
  previousStatus: string | null;
  newStatus: string;
  reason: string | null;
  userName: string;
  createdAt: string;
}

interface DocItem {
  id: string;
  documentType: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
}

interface CurrentUser {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
}

interface PracticeOption {
  id: string;
  name: string;
  code: string;
  specialty?: string | null;
}

const CLAIM_STATUSES = [
  { value: '', label: '– Select Status –' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'pending', label: 'Pending' },
  { value: 'submitted_for_review', label: 'Ready / Processed' },
  { value: 'paid', label: 'Paid' },
  { value: 'denied', label: 'Denied' },
  { value: 'closed', label: 'Closed' },
];

const SUB_STATUSES = [
  { value: '', label: '– Select Sub-Status –' },
  { value: 'call_payer', label: 'Called Payer' },
  { value: 'appeal_filed', label: 'Appeal Filed' },
  { value: 'records_requested', label: 'Medical Records Requested' },
  { value: 'corrected_claim', label: 'Corrected Claim Submitted' },
  { value: 'patient_contacted', label: 'Patient Contacted' },
  { value: 'cob_updated', label: 'COB Updated' },
  { value: 'auth_obtained', label: 'Authorization Obtained' },
  { value: 'pending_eob', label: 'Pending EOB' },
  { value: 'follow_up', label: 'Follow Up Required' },
];

function getAging(dateStr: string | null): { days: number; bucket: string } {
  if (!dateStr) return { days: 0, bucket: '0–30' };
  const d = new Date(dateStr);
  const now = new Date();
  const days = Math.max(0, Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
  const bucket =
    days > 180
      ? '180+'
      : days > 120
      ? '120–180'
      : days > 90
      ? '90–120'
      : days > 60
      ? '60–90'
      : days > 30
      ? '30–60'
      : '0–30';
  return { days, bucket };
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return d;
  }
}

function fmt(v: string | null) {
  return v ? `$${parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—';
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    new: 'Unworked',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    pending: 'Pending',
    submitted_for_review: 'Under Review',
    approved: 'Approved',
    rework_required: 'Rework',
    paid: 'Paid',
    denied: 'Denied',
    closed: 'Closed',
    sent_to_coding: 'Coding',
    coding_review: 'Coding Review',
    coding_corrected: 'Corrected',
    returned_to_billing: 'Returned',
    resubmitted: 'Resubmitted',
  };
  return map[s] || s;
}

function workflowPillMeta(ws: string | null, status: string) {
  if (ws === 'approved' || ['approved', 'paid'].includes(status)) {
    return { label: 'Worked / Approved', cls: 'bg-emerald-100 text-emerald-700' };
  }
  if (ws === 'pending_approval' || status === 'submitted_for_review') {
    return { label: 'Pending Approval', cls: 'bg-amber-100 text-amber-800' };
  }
  if (ws === 'rework' || status === 'rework_required') {
    return { label: 'Rework Required', cls: 'bg-red-100 text-red-700' };
  }
  if (ws === 'working' || status === 'in_progress') {
    return { label: 'Working', cls: 'bg-blue-100 text-[#2563EB]' };
  }
  if (ws === 'dead') {
    return { label: 'Dead / Unworkable', cls: 'bg-slate-200 text-slate-600' };
  }
  return { label: 'Unworked', cls: 'bg-slate-100 text-slate-700' };
}

export default function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [claim, setClaim] = useState<ClaimDetail | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusHistoryItem[]>([]);
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionBanner, setActionBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  // Practices for associating/changing practice directly on claim
  const [availablePractices, setAvailablePractices] = useState<PracticeOption[]>([]);
  const [editingPractice, setEditingPractice] = useState(false);
  const [selectedPracticeId, setSelectedPracticeId] = useState('');
  const [savingPractice, setSavingPractice] = useState(false);

  // Work form state
  const [claimStatus, setClaimStatus] = useState('');
  const [subStatus, setSubStatus] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [selectedDenialCode, setSelectedDenialCode] = useState<{
    id: number;
    code: string;
    codeType: string;
    description: string;
    category: string | null;
  } | null>(null);
  const [denialReasonText, setDenialReasonText] = useState('');

  // Standalone note state
  const [quickNote, setQuickNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // Modals
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState('eob');
  const [showReview, setShowReview] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | 'rework'>('approve');
  const [reviewComments, setReviewComments] = useState('');
  const [showCoding, setShowCoding] = useState(false);
  const [codingReason, setCodingReason] = useState('');

  // Activity tab
  const [activeInfoTab, setActiveInfoTab] = useState<'notes' | 'history' | 'documents'>('notes');

  const router = useRouter();

  const fetchClaim = useCallback(async () => {
    try {
      const res = await fetch(`/api/claims/${id}`, { credentials: 'include' });
      const data = await res.json();
      if (res.status === 401) {
        setLoadError('Your session has expired. Please sign in again.');
        return;
      }
      if (!res.ok) {
        setLoadError(
          res.status === 404
            ? 'Claim not found'
            : res.status === 403
            ? 'You do not have access to this claim.'
            : data.error || 'Unable to load this claim.'
        );
        return;
      }

      setLoadError('');
      const loadedClaim: ClaimDetail = data.claim;
      setClaim(loadedClaim);
      setNotes(data.notes || []);
      setStatusHistory(data.statusHistory || []);
      setDocuments(data.documents || []);
      setSelectedPracticeId(loadedClaim.practiceId || '');

      // Pre-populate work fields from saved claim state
      if (loadedClaim.claimInsuranceStatus) {
        setClaimStatus(loadedClaim.claimInsuranceStatus);
      } else if (['denied', 'paid', 'pending', 'in_progress'].includes(loadedClaim.status)) {
        setClaimStatus(loadedClaim.status);
      }
      if (loadedClaim.subStatus) {
        const matchedSub = SUB_STATUSES.find(
          (s) => s.label === loadedClaim.subStatus || s.value === loadedClaim.subStatus
        );
        setSubStatus(matchedSub ? matchedSub.value : '');
      }
      setFollowUpDate(loadedClaim.followUpDate || '');

      if (loadedClaim.denialCode) {
        setSelectedDenialCode(loadedClaim.denialCode);
        setDenialReasonText(loadedClaim.denialReason || loadedClaim.denialCode.description || '');
      } else if (loadedClaim.denialReason) {
        setDenialReasonText(loadedClaim.denialReason);
      }
    } catch (e) {
      console.error(e);
      setLoadError('Unable to load this claim. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchClaim();
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setCurrentUser(d.user))
      .catch(console.error);
    fetch('/api/practices/my', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setAvailablePractices(d.practices || []))
      .catch(console.error);
  }, [fetchClaim]);

  const handleSavePractice = async () => {
    setSavingPractice(true);
    setActionBanner(null);
    try {
      const res = await fetch(`/api/claims/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ practiceId: selectedPracticeId || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionBanner({ type: 'err', text: data.error || 'Failed to update practice' });
        return;
      }
      setEditingPractice(false);
      setActionBanner({ type: 'ok', text: 'Practice association updated.' });
      await fetchClaim();
    } catch (e) {
      console.error(e);
      setActionBanner({ type: 'err', text: 'Network error while updating practice.' });
    } finally {
      setSavingPractice(false);
    }
  };

  const callWorkflow = async (
    action: string,
    extra?: Record<string, unknown>,
    successMsg?: string
  ) => {
    setSaving(true);
    setActionBanner(null);
    try {
      const body: Record<string, unknown> = { action, remarks, ...extra };
      if (claimStatus) body.claimInsuranceStatus = claimStatus;
      body.subStatus = subStatus ? SUB_STATUSES.find((s) => s.value === subStatus)?.label || subStatus : '';
      body.followUpDate = followUpDate || null;
      if (selectedDenialCode) body.denialCodeId = selectedDenialCode.id;
      if (denialReasonText) body.denialReason = denialReasonText;

      const res = await fetch(`/api/claims/${id}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionBanner({ type: 'err', text: d.error || 'Action failed' });
        return false;
      }
      setRemarks('');
      if (successMsg) setActionBanner({ type: 'ok', text: successMsg });
      await fetchClaim();
      return true;
    } catch (e) {
      console.error(e);
      setActionBanner({ type: 'err', text: 'Network error while saving claim action.' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProgress = async () => {
    await callWorkflow('save_progress', undefined, 'Progress saved on this claim.');
  };

  const handleSubmitWork = async () => {
    if (!claimStatus) {
      setActionBanner({ type: 'err', text: 'Please select a Claim Status before submitting for approval.' });
      return;
    }
    if (!confirm('Are you sure you want to submit this claim for supervisor approval?')) return;
    await callWorkflow('submit_for_approval', undefined, 'Claim submitted for supervisor approval.');
  };

  const handleStartWorking = async () => {
    await callWorkflow('start_working', undefined, 'Claim moved to Working status.');
  };

  const handleMarkDead = async () => {
    if (!confirm('Are you sure you want to mark this claim as dead/unworkable?')) return;
    await callWorkflow('mark_dead', undefined, 'Claim marked as dead/unworkable.');
  };

  const handleAddQuickNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickNote.trim()) return;
    setAddingNote(true);
    try {
      const res = await fetch(`/api/claims/${id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ note: quickNote.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionBanner({ type: 'err', text: data.error || 'Failed to add note' });
        return;
      }
      setQuickNote('');
      await fetchClaim();
    } catch (err) {
      console.error(err);
    } finally {
      setAddingNote(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setSaving(true);
    setActionBanner(null);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      fd.append('documentType', uploadType);
      const res = await fetch(`/api/claims/${id}/documents`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionBanner({ type: 'err', text: data.error || 'Failed to attach document' });
        return;
      }
      setShowUpload(false);
      setUploadFile(null);
      setActiveInfoTab('documents');
      setActionBanner({ type: 'ok', text: `Attached "${uploadFile.name}".` });
      await fetchClaim();
    } catch (e) {
      console.error(e);
      setActionBanner({ type: 'err', text: 'Failed to attach document.' });
    } finally {
      setSaving(false);
    }
  };

  const handleReview = async () => {
    if (reviewAction === 'approve') {
      if (!confirm('Are you sure you want to approve this claim?')) return;
      const ok = await callWorkflow('approve', { remarks: reviewComments }, 'Claim approved.');
      if (ok) {
        setShowReview(false);
        setReviewComments('');
      }
    } else if (reviewAction === 'rework') {
      if (!reviewComments.trim()) {
        alert('Rework reason is mandatory');
        return;
      }
      const ok = await callWorkflow(
        'send_back_rework',
        { reworkReason: reviewComments },
        'Claim returned for rework.'
      );
      if (ok) {
        setShowReview(false);
        setReviewComments('');
      }
    } else {
      if (!reviewComments.trim()) {
        alert('Rejection reason is mandatory');
        return;
      }
      const ok = await callWorkflow(
        'send_back_rework',
        { reworkReason: reviewComments },
        'Claim returned for rework.'
      );
      if (ok) {
        setShowReview(false);
        setReviewComments('');
      }
    }
  };

  const handleSendToCoding = async () => {
    setSaving(true);
    setActionBanner(null);
    try {
      const res = await fetch('/api/coding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ claimId: id, denialReason: codingReason }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionBanner({ type: 'err', text: d.error || 'Failed to send to coding' });
        return;
      }
      setShowCoding(false);
      setCodingReason('');
      setActionBanner({ type: 'ok', text: 'Claim sent to Coding queue.' });
      await fetchClaim();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  // AI Analysis state
  const [analysisResult, setAnalysisResult] = useState<
    Record<string, string | string[] | number | boolean | null> | null
  >(null);
  const [analysisError, setAnalysisError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalysisError('');
    setAnalysisResult(null);
    try {
      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ claimId: id }),
      });
      const data = await res.json();
      if (res.ok && data.analysis) {
        setAnalysisResult(data.analysis as Record<string, string | string[] | number | boolean | null>);
      } else {
        setAnalysisError(data.error || 'Analysis failed. Please try again.');
      }
    } catch {
      setAnalysisError('Network error. Please check your connection and try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (!claim) return;
    const claimIsDenied =
      !['paid', 'closed', 'approved'].includes(claim.status) &&
      (claim.status === 'denied' || claim.claimInsuranceStatus === 'denied' || !!claim.denialReason);
    if (claimIsDenied) {
      fetch(`/api/ai-analysis?claimId=${id}&limit=1`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (d.analyses?.length > 0 && d.analyses[0].analysisResult) {
            setAnalysisResult(
              d.analyses[0].analysisResult as Record<string, string | string[] | number | boolean | null>
            );
          }
        })
        .catch(() => {});
    }
  }, [claim, id]);

  if (loading) {
    return (
      <AppLayout title="Claim">
        <MedicalInlineLoader message="Loading claim details..." />
      </AppLayout>
    );
  }

  if (!claim) {
    return (
      <AppLayout title="Claim">
        <div className="flex flex-col items-center py-20">
          <p className="text-[#64748B] mb-4">{loadError || 'Claim not found'}</p>
          {loadError.includes('session') && (
            <button
              onClick={() => router.push('/login')}
              className="text-[#2563EB] hover:underline text-sm mb-3"
            >
              Sign in again
            </button>
          )}
          <button onClick={() => router.back()} className="text-[#2563EB] hover:underline text-sm">
            ← Go back
          </button>
        </div>
      </AppLayout>
    );
  }

  const aging = getAging(claim.createdAt);
  const canReview = Boolean(
    currentUser &&
      ['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead'].includes(currentUser.role)
  );
  const canEditPractice = Boolean(
    currentUser && ['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead'].includes(currentUser.role)
  );
  const canWork = Boolean(currentUser && (claim.assignee?.id === currentUser.id || canReview));
  const wfPill = workflowPillMeta(claim.workflowStatus, claim.status);
  const isDenied =
    !['paid', 'closed', 'approved'].includes(claim.status) &&
    (claim.status === 'denied' ||
      claim.claimInsuranceStatus === 'denied' ||
      claim.claimInsuranceStatus === 'rejected' ||
      !!claim.denialReason);
  const genClaimNum =
    claim.claimNumber ||
    `${(claim.patientName || 'UNK').replace(/\s/g, '-')}-${claim.dateOfService || 'NODATE'}`;

  const practiceDisplay = claim.practice
    ? `${claim.practice.code} — ${claim.practice.name}`
    : null;
  const approvedUser = claim.approver || claim.reviewer;

  return (
    <AppLayout title={`Claim: ${claim.claimNumber}`}>
      <div className="max-w-[960px] mx-auto">
        {actionBanner && (
          <div
            className={`mb-4 px-4 py-3 rounded-lg border text-sm flex items-center justify-between ${
              actionBanner.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <span>{actionBanner.text}</span>
            <button
              onClick={() => setActionBanner(null)}
              className="text-xs opacity-70 hover:opacity-100 ml-3"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ============ MODAL-STYLE CARD ============ */}
        <div className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] overflow-hidden">
          {/* ---- Header ---- */}
          <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-lg font-bold text-slate-900">Claim: {claim.claimNumber}</h1>
                <span
                  className={`inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-xs font-semibold ${wfPill.cls}`}
                >
                  {wfPill.label}
                </span>
                {claim.practice ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                    <Building2 className="w-3.5 h-3.5" />
                    {claim.practice.code} — {claim.practice.name}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                    <Building2 className="w-3.5 h-3.5" />
                    No Practice Linked
                  </span>
                )}
              </div>
              <p className="text-[13px] text-[#64748B] mt-1.5 flex flex-wrap items-center gap-y-1">
                <span>
                  Assigned:{' '}
                  <span className="text-slate-700 font-medium">
                    {claim.assignee ? `${claim.assignee.firstName} ${claim.assignee.lastName}` : '—'}
                  </span>
                </span>
                <span className="mx-2">•</span>
                <span>
                  Worked by:{' '}
                  <span className="text-slate-700 font-medium">
                    {claim.worker ? `${claim.worker.firstName} ${claim.worker.lastName}` : '—'}
                  </span>
                </span>
                <span className="mx-2">•</span>
                <span>
                  Approved by:{' '}
                  <span className="text-slate-700 font-medium">
                    {approvedUser ? `${approvedUser.firstName} ${approvedUser.lastName}` : '—'}
                  </span>
                </span>
                <span className="mx-2">•</span>
                <span>
                  TL:{' '}
                  <span className="text-slate-700 font-medium">
                    {claim.teamLead ? `${claim.teamLead.firstName} ${claim.teamLead.lastName}` : '—'}
                  </span>
                </span>
              </p>
            </div>
            <button
              onClick={() => router.back()}
              className="p-1.5 rounded-md hover:bg-[#F5F7FA] text-[#64748B] hover:text-slate-900 transition-colors flex-shrink-0"
              title="Back"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ---- Claim Information Grid ---- */}
          <div className="px-6 py-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-0">
              {/* Row 1: Practice & Patient */}
              <div className="flex items-center justify-between py-3 border-b border-[#F1F5F9] gap-3">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider flex-shrink-0">
                  Practice
                </span>
                {editingPractice ? (
                  <div className="flex items-center gap-1.5 flex-1 justify-end">
                    <select
                      value={selectedPracticeId}
                      onChange={(e) => setSelectedPracticeId(e.target.value)}
                      className="px-2.5 py-1 rounded-md border border-[#CBD5E1] text-xs text-slate-900 bg-white max-w-[210px]"
                    >
                      <option value="">-- Unassigned --</option>
                      {availablePractices.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} — {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleSavePractice}
                      disabled={savingPractice}
                      className="px-2.5 py-1 rounded bg-[#2563EB] text-white text-xs font-semibold hover:bg-[#1d4ed8] disabled:opacity-50"
                    >
                      {savingPractice ? '...' : 'Save'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingPractice(false);
                        setSelectedPracticeId(claim.practiceId || '');
                      }}
                      className="px-2 py-1 rounded border border-[#E5E7EB] text-xs text-[#64748B] hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-right min-w-0">
                    <div className="truncate">
                      <span className="text-sm font-semibold text-slate-900">
                        {practiceDisplay || '—'}
                      </span>
                      {claim.practice?.specialty && (
                        <span className="block text-[11px] text-[#64748B]">
                          {claim.practice.specialty}
                        </span>
                      )}
                    </div>
                    {canEditPractice && availablePractices.length > 0 && (
                      <button
                        onClick={() => setEditingPractice(true)}
                        className="text-[11px] font-medium text-[#2563EB] hover:underline flex-shrink-0"
                      >
                        {claim.practice ? 'Change' : 'Assign'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-between py-3 border-b border-[#F1F5F9]">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  Patient
                </span>
                <span className="text-sm font-semibold text-slate-900 uppercase">
                  {claim.patientName || '—'}
                </span>
              </div>

              {/* Row 2: Rendering Provider & Date of Service */}
              <div className="flex justify-between py-3 border-b border-[#F1F5F9]">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  Rendering Provider
                </span>
                <span className="text-sm font-semibold text-slate-900">
                  {claim.provider || '—'}
                </span>
              </div>

              <div className="flex justify-between py-3 border-b border-[#F1F5F9]">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  Date of Service
                </span>
                <span className="text-sm font-semibold text-slate-900">
                  {fmtDate(claim.dateOfService)}
                </span>
              </div>

              {/* Row 3: Payer & Chart / Account Number */}
              <div className="flex justify-between py-3 border-b border-[#F1F5F9]">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  Payer
                </span>
                <span className="text-sm font-semibold text-slate-900 uppercase">
                  {claim.insurance || claim.payer || '—'}
                </span>
              </div>

              <div className="flex justify-between py-3 border-b border-[#F1F5F9]">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  Account / Chart #
                </span>
                <span className="text-sm font-semibold text-slate-900">
                  {claim.accountNumber || '—'}
                </span>
              </div>

              {/* Row 4: CPT / Diagnosis & Follow-Up Date */}
              <div className="flex justify-between py-3 border-b border-[#F1F5F9]">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  CPT / ICD-10
                </span>
                <span className="text-sm font-semibold text-slate-900">
                  {[claim.cptCodes, claim.diagnosisCode].filter(Boolean).join(' • ') || '—'}
                </span>
              </div>

              <div className="flex justify-between py-3 border-b border-[#F1F5F9]">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  Follow-Up Date
                </span>
                <span className="text-sm font-semibold text-slate-900">
                  {fmtDate(claim.followUpDate)}
                </span>
              </div>

              {/* Row 5: Charge Amount & Total Balance */}
              <div className="flex justify-between py-3 border-b border-[#F1F5F9]">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  Charge Amount
                </span>
                <span className="text-sm font-bold text-slate-900">{fmt(claim.billedAmount)}</span>
              </div>

              <div className="flex justify-between py-3 border-b border-[#F1F5F9]">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  Total Balance
                </span>
                <span className="text-sm font-bold text-slate-900">{fmt(claim.balance)}</span>
              </div>

              {/* Row 6: Aging & Claim Number */}
              <div className="flex justify-between py-3">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  Aging
                </span>
                <div className="text-right">
                  <span
                    className={`text-sm font-bold ${
                      aging.days > 90 ? 'text-[#DC2626]' : 'text-[#16A34A]'
                    }`}
                  >
                    {aging.days}d
                  </span>
                  <span className="text-[11px] text-[#64748B] ml-1.5">{aging.bucket}</span>
                </div>
              </div>

              <div className="flex justify-between py-3">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  Claim Number
                </span>
                <span className="text-sm font-semibold text-slate-900">{genClaimNum}</span>
              </div>
            </div>
          </div>

          {/* ---- REWORK REASON BANNER ---- */}
          {claim.reworkReason && claim.workflowStatus === 'rework' && (
            <div className="px-6 py-4 border-t border-red-200 bg-red-50">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-[#DC2626] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-900">Returned for Rework by Supervisor</p>
                  <p className="text-sm text-red-800 mt-1">{claim.reworkReason}</p>
                  <p className="text-[11px] text-red-600 mt-1">
                    Rework #{claim.reworkCount || 1} — please address the issues and resubmit.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ---- START WORKING BUTTON (for unworked claims) ---- */}
          {(claim.workflowStatus === 'unworked' || !claim.workflowStatus) && canWork && (
            <div className="px-6 py-4 border-t border-[#E5E7EB] bg-[#FAFBFC]">
              <Button onClick={handleStartWorking} loading={saving} className="w-full">
                <CheckCircle className="w-4 h-4 mr-2" />
                Start Working on This Claim
              </Button>
            </div>
          )}

          {/* ---- WORK THIS CLAIM (when working or rework) ---- */}
          {canWork && (claim.workflowStatus === 'working' || claim.workflowStatus === 'rework') && (
            <div className="px-6 py-5 border-t border-[#E5E7EB] bg-[#FAFBFC]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">
                  Work This Claim
                </h3>
                {claim.practice && (
                  <span className="text-xs font-medium text-slate-600">
                    Practice: <strong className="text-slate-900">{claim.practice.code} — {claim.practice.name}</strong>
                  </span>
                )}
              </div>

              {/* Status, Sub-Status, Follow-Up Date */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="relative">
                  <label className="block text-[11px] font-semibold text-[#64748B] uppercase tracking-wider mb-1.5">
                    Claim Status *
                  </label>
                  <div className="relative">
                    <select
                      value={claimStatus}
                      onChange={(e) => setClaimStatus(e.target.value)}
                      className="w-full appearance-none px-3.5 py-2.5 pr-10 rounded-lg border border-[#E5E7EB] bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                    >
                      {CLAIM_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B] pointer-events-none" />
                  </div>
                </div>

                <div className="relative">
                  <label className="block text-[11px] font-semibold text-[#64748B] uppercase tracking-wider mb-1.5">
                    Sub-Status
                  </label>
                  <div className="relative">
                    <select
                      value={subStatus}
                      onChange={(e) => setSubStatus(e.target.value)}
                      className="w-full appearance-none px-3.5 py-2.5 pr-10 rounded-lg border border-[#E5E7EB] bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                    >
                      {SUB_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B] pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#64748B] uppercase tracking-wider mb-1.5">
                    Follow-Up Date
                  </label>
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  />
                </div>
              </div>

              {/* Denial Code Section — shown when status is Denied */}
              {claimStatus === 'denied' && (
                <div className="mb-4 p-4 bg-red-50/50 border border-red-100 rounded-lg">
                  <DenialCodeSearch
                    selectedCode={selectedDenialCode}
                    onSelect={setSelectedDenialCode}
                    onReasonChange={setDenialReasonText}
                    initialReason={denialReasonText}
                  />
                </div>
              )}

              {/* Remarks */}
              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-[#64748B] uppercase tracking-wider mb-1.5">
                  Remarks / Call Notes
                </label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                  placeholder="Document payer call reference #, rep name, or action taken..."
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm text-slate-900 placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] resize-none"
                />
              </div>

              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  onClick={() => setShowUpload(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E5E7EB] bg-white text-sm text-[#64748B] hover:bg-[#F5F7FA] hover:text-slate-900 transition-colors"
                >
                  <Paperclip className="w-4 h-4" />
                  Attach Document
                </button>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={handleMarkDead}
                    disabled={saving}
                    className="px-3.5 py-2 rounded-lg border border-[#DC2626] bg-white text-sm text-[#DC2626] hover:bg-red-50 transition-colors font-medium disabled:opacity-50"
                  >
                    Mark as Dead
                  </button>
                  <button
                    onClick={handleSaveProgress}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#CBD5E1] bg-white text-sm font-medium text-slate-700 hover:bg-[#F5F7FA] transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    Save Progress
                  </button>
                  <button
                    onClick={handleSubmitWork}
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-semibold hover:bg-[#1d4ed8] transition-colors shadow-sm disabled:opacity-50"
                  >
                    {saving ? 'Submitting...' : 'Submit for Approval'} <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ---- AI DENIAL ANALYSIS RESULTS (inline) ---- */}
          {isDenied && (
            <div className="px-6 py-5 border-t border-[#E5E7EB]">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-purple-600" />
                  <h3 className="text-[13px] font-bold text-slate-900 uppercase tracking-wider">
                    AI Denial Analysis
                  </h3>
                </div>
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
                >
                  {analyzing ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Brain className="w-3.5 h-3.5" />
                      {analysisResult ? 'Re-analyze' : 'Analyze Denial'}
                    </>
                  )}
                </button>
              </div>

              {analysisError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 mb-3">
                  <AlertTriangle className="w-4 h-4 inline mr-1.5" />
                  {analysisError}
                </div>
              )}

              {analysisResult !== null && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        analysisResult.severity === 'Critical'
                          ? 'bg-red-100 text-red-700'
                          : analysisResult.severity === 'High'
                          ? 'bg-red-50 text-red-600'
                          : analysisResult.severity === 'Medium'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      Severity: {String(analysisResult.severity)}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        analysisResult.confidence === 'High'
                          ? 'bg-emerald-50 text-emerald-700'
                          : analysisResult.confidence === 'Medium'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      AI Confidence: {String(analysisResult.confidence)}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        analysisResult.recoveryPotential === 'high'
                          ? 'bg-emerald-50 text-emerald-700'
                          : analysisResult.recoveryPotential === 'medium'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-red-50 text-red-600'
                      }`}
                    >
                      Recovery: {String(analysisResult.recoveryPotential)}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700">
                      {String(analysisResult.denialCategory)}
                    </span>
                  </div>

                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-[11px] font-bold text-red-700 uppercase mb-1">Denial Reason</p>
                    <p className="text-sm text-red-900">{String(analysisResult.denialReason)}</p>
                  </div>

                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-[11px] font-bold text-amber-700 uppercase mb-1">Root Cause</p>
                    <p className="text-sm text-amber-900">{String(analysisResult.rootCause)}</p>
                  </div>

                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-[11px] font-bold text-blue-700 uppercase mb-1">
                      Recommended Action
                    </p>
                    <p className="text-sm text-blue-900">{String(analysisResult.recommendedAction)}</p>
                  </div>

                  {(() => {
                    const steps = (analysisResult.nextSteps || []) as string[];
                    if (!steps.length) return null;
                    return (
                      <div className="p-3 bg-[#F5F7FA] border border-[#E5E7EB] rounded-lg">
                        <p className="text-[11px] font-bold text-[#64748B] uppercase mb-2">
                          Next Steps
                        </p>
                        <ol className="space-y-1.5">
                          {steps.map((step: string, i: number) => (
                            <li key={i} className="flex gap-2 text-sm text-slate-700">
                              <span className="w-5 h-5 rounded-full bg-[#2563EB] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                                {i + 1}
                              </span>
                              {String(step)}
                            </li>
                          ))}
                        </ol>
                      </div>
                    );
                  })()}

                  {(analysisResult.requiredInformation as unknown as string[] | undefined)?.length ? (
                    <div className="p-3 bg-[#F5F7FA] border border-[#E5E7EB] rounded-lg">
                      <p className="text-[11px] font-bold text-[#64748B] uppercase mb-2">
                        Required Information
                      </p>
                      <ul className="space-y-1">
                        {((analysisResult.requiredInformation || []) as string[]).map(
                          (info: string, i: number) => (
                            <li key={i} className="text-sm text-slate-700 flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
                              {String(info)}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {!!analysisResult.resubmitRecommendation && (
                      <div className="p-2.5 bg-[#F5F7FA] rounded-lg">
                        <p className="text-[10px] font-bold text-[#64748B] uppercase mb-1">
                          Resubmission
                        </p>
                        <p className="text-[12px] text-slate-700">
                          {String(analysisResult.resubmitRecommendation)}
                        </p>
                      </div>
                    )}
                    {!!analysisResult.payerFollowUp && (
                      <div className="p-2.5 bg-[#F5F7FA] rounded-lg">
                        <p className="text-[10px] font-bold text-[#64748B] uppercase mb-1">
                          Payer Follow-Up
                        </p>
                        <p className="text-[12px] text-slate-700">
                          {String(analysisResult.payerFollowUp)}
                        </p>
                      </div>
                    )}
                  </div>

                  <p className="text-[10px] text-[#94A3B8] italic mt-2">
                    {String(
                      analysisResult.disclaimer ||
                        'AI-generated analysis. Verify recommendations against payer policies before acting.'
                    )}
                  </p>
                  {analysisResult.analyzedAt && (
                    <p className="text-[10px] text-[#94A3B8]">
                      Last analyzed: {new Date(String(analysisResult.analyzedAt)).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {!analysisResult && !analysisError && !analyzing && (
                <p className="text-sm text-[#64748B] text-center py-4">
                  Click &ldquo;Analyze Denial&rdquo; to get AI-powered recommendations for this denied claim.
                </p>
              )}
            </div>
          )}

          {/* ---- Quick Actions for Supervisors / Denied ---- */}
          {((canReview && claim.workflowStatus === 'pending_approval') || isDenied) && (
            <div className="px-6 py-3 border-t border-[#E5E7EB] bg-[#F8FAFC] flex items-center gap-2 flex-wrap">
              {canReview && claim.workflowStatus === 'pending_approval' && (
                <>
                  <button
                    onClick={() => {
                      setReviewAction('approve');
                      setShowReview(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      setReviewAction('rework');
                      setShowReview(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Rework
                  </button>
                  <button
                    onClick={() => {
                      setReviewAction('reject');
                      setShowReview(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </>
              )}
              {isDenied && claim.status !== 'sent_to_coding' && (
                <>
                  <button
                    onClick={() => {
                      setCodingReason(claim.denialReason || '');
                      setShowCoding(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-50 text-purple-700 text-xs font-medium hover:bg-purple-100 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send to Coding
                  </button>
                  <button
                    onClick={handleAnalyze}
                    disabled={saving || analyzing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors disabled:opacity-50"
                  >
                    <Brain className="w-3.5 h-3.5" />
                    AI Analyze
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* ============ ACTIVITY TABS ============ */}
        <div className="mt-5 bg-white rounded-xl shadow-sm border border-[#E5E7EB] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] pr-4">
            <div className="flex">
              {(['notes', 'history', 'documents'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveInfoTab(t)}
                  className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeInfoTab === t
                      ? 'border-[#2563EB] text-[#2563EB]'
                      : 'border-transparent text-[#64748B] hover:text-slate-900'
                  }`}
                >
                  {t === 'notes'
                    ? `Notes (${notes.length})`
                    : t === 'history'
                    ? `History (${statusHistory.length})`
                    : `Documents (${documents.length})`}
                </button>
              ))}
            </div>
            {activeInfoTab === 'documents' && canWork && (
              <button
                onClick={() => setShowUpload(true)}
                className="flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline"
              >
                <Plus className="w-3.5 h-3.5" />
                Attach File
              </button>
            )}
          </div>

          <div className="p-5 max-h-[450px] overflow-y-auto">
            {activeInfoTab === 'notes' && (
              <div className="space-y-4">
                {canWork && (
                  <form onSubmit={handleAddQuickNote} className="flex gap-2">
                    <input
                      type="text"
                      value={quickNote}
                      onChange={(e) => setQuickNote(e.target.value)}
                      placeholder="Add a quick note to this claim..."
                      className="flex-1 px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm text-slate-900 placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                    />
                    <Button type="submit" size="sm" loading={addingNote} disabled={!quickNote.trim()}>
                      Add Note
                    </Button>
                  </form>
                )}
                {notes.length === 0 ? (
                  <p className="text-sm text-[#64748B] text-center py-6">No notes yet</p>
                ) : (
                  <div className="space-y-3">
                    {notes.map((n) => (
                      <div
                        key={n.id}
                        className="p-3 bg-[#F8FAFC] rounded-lg border border-[#F1F5F9]"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <User className="w-3.5 h-3.5 text-[#64748B]" />
                          <span className="text-sm font-medium text-slate-900">{n.userName}</span>
                          <span className="text-[11px] text-[#64748B]">
                            {new Date(n.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700 ml-5">{n.note}</p>
                        {n.actionPerformed && (
                          <span className="ml-5 mt-1 inline-block text-[11px] px-2 py-0.5 bg-blue-50 text-[#2563EB] rounded-full font-medium">
                            {n.actionPerformed}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeInfoTab === 'history' &&
              (statusHistory.length === 0 ? (
                <p className="text-sm text-[#64748B] text-center py-6">No history</p>
              ) : (
                <div className="space-y-3">
                  {statusHistory.map((h) => (
                    <div key={h.id} className="flex items-start gap-3">
                      <Clock className="w-4 h-4 text-[#64748B] mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="flex items-center gap-2">
                          {h.previousStatus && (
                            <>
                              <span className="text-xs px-2 py-0.5 bg-gray-100 text-[#64748B] rounded-full">
                                {statusLabel(h.previousStatus)}
                              </span>
                              <span className="text-[#64748B]">→</span>
                            </>
                          )}
                          <span className="text-xs px-2 py-0.5 bg-blue-50 text-[#2563EB] rounded-full font-medium">
                            {statusLabel(h.newStatus)}
                          </span>
                        </div>
                        <p className="text-[12px] text-[#64748B] mt-1">
                          {h.userName} • {new Date(h.createdAt).toLocaleString()}
                        </p>
                        {h.reason && <p className="text-sm text-slate-600 mt-0.5">{h.reason}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}

            {activeInfoTab === 'documents' &&
              (documents.length === 0 ? (
                <p className="text-sm text-[#64748B] text-center py-6">No documents</p>
              ) : (
                <div className="space-y-2">
                  {documents.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-3 p-3 bg-[#F8FAFC] rounded-lg border border-[#F1F5F9]"
                    >
                      <FileText className="w-4 h-4 text-[#64748B] flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{d.fileName}</p>
                        <p className="text-[11px] text-[#64748B]">
                          {d.documentType.toUpperCase()} •{' '}
                          {new Date(d.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={`/api/claims/${claim.id}/documents/${d.id}?inline=1`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-[#2563EB] bg-blue-50 hover:bg-blue-100"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View
                        </a>
                        <a
                          href={`/api/claims/${claim.id}/documents/${d.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-slate-700 bg-white border border-[#E5E7EB] hover:bg-slate-50"
                        >
                          <Download className="w-3 h-3" />
                          Download
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ============ MODALS ============ */}

      {/* Upload */}
      <Modal isOpen={showUpload} onClose={() => setShowUpload(false)} title="Attach Document">
        <div className="space-y-4">
          <Select
            label="Document Type"
            value={uploadType}
            onChange={(e) => setUploadType(e.target.value)}
            options={[
              { value: 'eob', label: 'EOB' },
              { value: 'denial', label: 'Denial Letter' },
              { value: 'appeal', label: 'Appeal' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <div>
            <label className="block text-[11px] font-semibold text-[#64748B] uppercase tracking-wider mb-1.5">
              File
            </label>
            <input
              type="file"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-[#2563EB] file:font-medium file:text-sm hover:file:bg-blue-100"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowUpload(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpload} loading={saving} disabled={!uploadFile}>
              Upload
            </Button>
          </div>
        </div>
      </Modal>

      {/* Review */}
      <Modal
        isOpen={showReview}
        onClose={() => setShowReview(false)}
        title={`${reviewAction.charAt(0).toUpperCase() + reviewAction.slice(1)} Claim`}
      >
        <div className="space-y-4">
          <div
            className={`p-3 rounded-lg ${
              reviewAction === 'approve'
                ? 'bg-emerald-50'
                : reviewAction === 'rework'
                ? 'bg-amber-50'
                : 'bg-red-50'
            }`}
          >
            <p className="text-sm font-medium">
              {reviewAction === 'approve'
                ? '✓ Approve this claim'
                : reviewAction === 'rework'
                ? '↻ Request rework'
                : '✕ Reject this claim'}
            </p>
          </div>
          <Textarea
            label={reviewAction === 'approve' ? 'Comments (Optional)' : 'Comments (Required)'}
            value={reviewComments}
            onChange={(e) => setReviewComments(e.target.value)}
            placeholder={
              reviewAction === 'approve'
                ? 'Optional approval comments...'
                : 'Explain what needs to be reworked...'
            }
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowReview(false)}>
              Cancel
            </Button>
            <Button onClick={handleReview} loading={saving}>
              {reviewAction.charAt(0).toUpperCase() + reviewAction.slice(1)}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Send to Coding */}
      <Modal
        isOpen={showCoding}
        onClose={() => setShowCoding(false)}
        title="Send to Coding Team"
      >
        <div className="space-y-4">
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            All existing documents will be auto-attached.
          </div>
          <Textarea
            label="Denial Reason"
            value={codingReason}
            onChange={(e) => setCodingReason(e.target.value)}
            placeholder="Describe the coding issue..."
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCoding(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendToCoding} loading={saving}>
              Send to Coding
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
