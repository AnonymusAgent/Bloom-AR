'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Input';
import { Search, SlidersHorizontal, CheckCircle, FileText, User, ChevronLeft, ChevronRight, UserPlus, Clock, AlertTriangle, BarChart3 } from 'lucide-react';
import { MedicalInlineLoader } from '@/components/ui/MedicalLoader';

interface Claim {
  id: string; claimNumber: string; patientName: string | null; dateOfService: string | null;
  insurance: string | null; provider: string | null; balance: string | null; status: string;
  priority: string | null; subStatus: string | null; workflowStatus: string | null;
  claimInsuranceStatus: string | null; assigneeName: string | null; approvedByName: string | null;
  practiceId: string | null; practiceName: string | null; practiceCode: string | null;
  workedDate: string | null; followUpDate: string | null; reworkReason: string | null;
  reworkCount: number | null; createdAt: string;
}
interface Counts { workflow: Record<string, number>; }

type MainTab = 'unworked' | 'workable' | 'pending_approval' | 'worked' | 'record' | 'details';

const RECORD_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'in_process', label: 'In Process' },
  { key: 'processed', label: 'Processed' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'denied', label: 'Denied' },
  { key: 'partial_paid', label: 'Partial Paid' },
  { key: 'closed', label: 'Closed' },
  { key: 'unworkable', label: 'Unworkable' },
];

function getAgingDays(d: string | null) { return d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000)) : 0; }
function fmt(v: string | null) { return v ? `$${parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'; }
function fmtDate(d: string | null) { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d; } }

function StatusPill({ status }: { status: string }) {
  const m: Record<string, { bg: string; tx: string; l: string }> = {
    new: { bg:'bg-slate-100',tx:'text-slate-600',l:'New' }, assigned: { bg:'bg-slate-100',tx:'text-slate-600',l:'Assigned' },
    in_progress: { bg:'bg-blue-50',tx:'text-[#2563EB]',l:'In Process' }, pending: { bg:'bg-amber-50',tx:'text-amber-700',l:'Pending' },
    submitted_for_review: { bg:'bg-blue-50',tx:'text-[#2563EB]',l:'Pending Approval' },
    approved: { bg:'bg-emerald-50',tx:'text-emerald-700',l:'Approved' }, rework_required: { bg:'bg-red-50',tx:'text-[#DC2626]',l:'Rework' },
    paid: { bg:'bg-emerald-50',tx:'text-emerald-700',l:'Paid' }, denied: { bg:'bg-red-50',tx:'text-[#DC2626]',l:'Denied' },
    closed: { bg:'bg-slate-100',tx:'text-slate-500',l:'Closed' },
  };
  const s = m[status] || { bg:'bg-slate-100',tx:'text-slate-600',l:status };
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${s.bg} ${s.tx}`}>{s.l}</span>;
}

function WorkflowBadge({ ws }: { ws: string | null }) {
  const m: Record<string, { bg: string; tx: string; l: string }> = {
    unworked: { bg:'bg-slate-100',tx:'text-slate-600',l:'Unworked' },
    working: { bg:'bg-blue-50',tx:'text-[#2563EB]',l:'Working' },
    pending_approval: { bg:'bg-amber-50',tx:'text-amber-700',l:'Pending Approval' },
    rework: { bg:'bg-red-50',tx:'text-[#DC2626]',l:'Rework Required' },
    approved: { bg:'bg-emerald-50',tx:'text-emerald-700',l:'Approved' },
    dead: { bg:'bg-slate-200',tx:'text-slate-500',l:'Dead' },
  };
  const s = m[ws || 'unworked'] || { bg:'bg-slate-100',tx:'text-slate-600',l:ws || 'Unknown' };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${s.bg} ${s.tx}`}>{s.l}</span>;
}

export default function ClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [mainTab, setMainTab] = useState<MainTab>('unworked');
  const [recordFilter, setRecordFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [counts, setCounts] = useState<Counts>({ workflow: {} });
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [selectedClaims, setSelectedClaims] = useState<string[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [users, setUsers] = useState<Array<{ id: string; firstName: string; lastName: string }>>([]);
  const [assignee, setAssignee] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; role: string } | null>(null);
  const [practiceFilter, setPracticeFilter] = useState('');
  const [myPractices, setMyPractices] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const router = useRouter();

  // Fetch user's authorized practices
  useEffect(() => {
    fetch('/api/practices/my', { credentials: 'include' }).then(r => r.json()).then(d => setMyPractices(d.practices || [])).catch(console.error);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  // Fetch counts for badges
  const fetchCounts = useCallback(async () => {
    try {
      const qs = practiceFilter ? `?practiceId=${encodeURIComponent(practiceFilter)}` : '';
      const res = await fetch(`/api/claims/counts${qs}`, { credentials: 'include' });
      const d = await res.json();
      if (res.ok) setCounts(d);
    } catch {}
  }, [practiceFilter]);

  const fetchClaims = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (practiceFilter) params.set('practiceId', practiceFilter);

      // Map tab to workflow/status filter
      if (mainTab === 'unworked') params.set('workflowStatus', 'unworked');
      else if (mainTab === 'workable') params.set('workflowStatus', 'working,rework');
      else if (mainTab === 'pending_approval') params.set('workflowStatus', 'pending_approval');
      else if (mainTab === 'worked') params.set('workflowStatus', 'approved');
      else if (mainTab === 'record') {
        if (recordFilter === 'in_process') params.set('status', 'in_progress');
        else if (recordFilter === 'processed') params.set('status', 'approved,paid');
        else if (recordFilter === 'rejected') params.set('status', 'rework_required');
        else if (recordFilter === 'denied') params.set('status', 'denied');
        else if (recordFilter === 'partial_paid') params.set('status', 'paid');
        else if (recordFilter === 'closed') params.set('status', 'closed');
        else if (recordFilter === 'unworkable') params.set('workflowStatus', 'dead');
      }

      const res = await fetch(`/api/claims?${params}`, { credentials: 'include' });
      const d = await res.json();
      if (res.ok) { setClaims(d.claims); setTotal(d.pagination.total); setTotalPages(d.pagination.totalPages); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [page, mainTab, recordFilter, debouncedSearch, practiceFilter]);

  useEffect(() => { fetchClaims(); }, [fetchClaims]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  useEffect(() => {
    fetch('/api/users?isActive=true', { credentials: 'include' }).then(r => r.json()).then(d => setUsers(d.users || [])).catch(console.error);
    fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json()).then(d => setCurrentUser(d.user)).catch(console.error);
  }, []);
  useEffect(() => { setPage(1); }, [mainTab, recordFilter]);

  const isSuper = currentUser && ['administrator', 'supervisor', 'manager', 'team_lead', 'senior_lead'].includes(currentUser.role);

  const handleBulkAssign = async () => {
    if (!assignee) return; setAssigning(true);
    try {
      await fetch('/api/claims/bulk-assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claimIds: selectedClaims, assigneeId: assignee }), credentials: 'include' });
      setShowAssign(false); setSelectedClaims([]); setAssignee(''); fetchClaims(); fetchCounts();
    } catch {}
    finally { setAssigning(false); }
  };

  const wf = counts.workflow;
  const tabBadge = (n: number) => n > 0 ? <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-white/20">{n}</span> : null;

  const mainTabs: Array<{ key: MainTab; label: string; count: number; icon: React.ElementType }> = [
    { key: 'unworked', label: 'Unworked AR', count: wf.unworked || 0, icon: FileText },
    { key: 'workable', label: 'Workable AR', count: (wf.working || 0) + (wf.rework || 0), icon: CheckCircle },
    { key: 'pending_approval', label: 'Pending Approval', count: wf.pending_approval || 0, icon: Clock },
    { key: 'worked', label: 'Worked AR', count: wf.approved || 0, icon: CheckCircle },
    { key: 'record', label: 'Record', count: 0, icon: FileText },
    { key: 'details', label: 'Details', count: 0, icon: BarChart3 },
  ];

  return (
    <AppLayout title="Account Receivable">
      {/* Main Tabs */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        {mainTabs.map(t => (
          <button key={t.key} onClick={() => t.key === 'details' ? router.push('/productivity') : setMainTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium whitespace-nowrap transition-all ${
              mainTab === t.key ? 'bg-[#0F2D52] text-white shadow-sm' : 'text-[#64748B] hover:bg-[#E5E7EB]'
            }`}>
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            {t.count > 0 && tabBadge(t.count)}
            {t.key === 'pending_approval' && (wf.pending_approval || 0) > 0 && mainTab !== t.key && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Rework banner */}
      {mainTab === 'workable' && (wf.rework || 0) > 0 && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[#DC2626]" />
          <span className="text-sm text-red-800 font-medium">{wf.rework} claim(s) returned for rework by supervisor</span>
        </div>
      )}

      {/* Main Card */}
      <div className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] overflow-hidden">
        {/* Record sub-filters */}
        {mainTab === 'record' && (
          <div className="px-4 pt-3 pb-2.5 border-b border-[#E5E7EB] flex items-center gap-1 overflow-x-auto">
            {RECORD_FILTERS.map(f => (
              <button key={f.key} onClick={() => setRecordFilter(f.key)}
                className={`px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all ${
                  recordFilter === f.key ? 'bg-[#2563EB] text-white shadow-sm' : 'text-[#64748B] hover:bg-[#F1F5F9]'
                }`}>{f.label}</button>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="px-4 py-2.5 border-b border-[#E5E7EB] flex items-center justify-between gap-3">
          <form onSubmit={e => { e.preventDefault(); setPage(1); setDebouncedSearch(search.trim()); }} className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#94A3B8]" />
            <input type="text" placeholder="Search claim, patient, payer" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-md border border-[#E5E7EB] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 placeholder:text-[#94A3B8]" />
          </form>
          {/* Practice Filter */}
          {myPractices.length > 0 && (
            <select value={practiceFilter} onChange={e => { setPracticeFilter(e.target.value); setPage(1); }}
              className="px-2.5 py-1.5 rounded-md border border-[#E5E7EB] text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 max-w-[180px]">
              <option value="">All Practices</option>
              {myPractices.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          )}
          <div className="flex items-center gap-2">
            {isSuper && selectedClaims.length > 0 && (
              <Button size="sm" onClick={() => setShowAssign(true)}><UserPlus className="w-3.5 h-3.5 mr-1" />Assign ({selectedClaims.length})</Button>
            )}
            {currentUser?.role === 'administrator' && (
              <Button size="sm" variant="secondary" onClick={async () => {
                if (!confirm('Replace ALL current claims with 50 synthetic test claims (TEST-CLM-001…050)? This permanently deletes the existing claim data.')) return;
                if (!confirm('Are you sure? This cannot be undone.')) return;
                const res = await fetch('/api/claims/test-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ confirm: 'REPLACE_ALL_CLAIMS' }) });
                const d = await res.json().catch(() => ({}));
                alert(res.ok ? d.message : (d.error || 'Failed to load test claims'));
                if (res.ok) { setPage(1); fetchClaims(); fetchCounts(); }
              }}>Load 50 test claims</Button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
          <table className="min-w-[1400px] w-full">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F1F5F9] border-b border-[#E5E7EB]">
                {isSuper && <th className="w-8 px-2 py-2.5"><input type="checkbox" className="rounded border-[#D1D5DB]" checked={selectedClaims.length === claims.length && claims.length > 0} onChange={() => setSelectedClaims(selectedClaims.length === claims.length ? [] : claims.map(c => c.id))} /></th>}
                {['CLAIM #','PRACTICE','PATIENT','PAYER','AGENT','BALANCE','AGING','PRIORITY','WORKFLOW','CLAIM STATUS','SUB-STATUS','WORKED DATE','FOLLOW-UP','APPROVED BY'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={15} className="px-4 py-8"><MedicalInlineLoader message="Fetching AR claims..." /></td></tr>
              ) : claims.length === 0 ? (
                <tr><td colSpan={15} className="px-4 py-16 text-center text-[#64748B] text-sm">No claims found</td></tr>
              ) : claims.map(c => {
                const aging = getAgingDays(c.createdAt);
                const priorityLabel =
                  c.priority === 'urgent' ? 'Urgent' :
                  c.priority === 'high' ? 'High' :
                  c.priority === 'low' ? 'Low' : 'Normal';
                const isHigh = c.priority === 'high' || c.priority === 'urgent';
                const isRework = c.workflowStatus === 'rework';
                const practiceLabel = c.practiceCode && c.practiceName
                  ? `${c.practiceCode} — ${c.practiceName}`
                  : c.practiceName || '—';
                return (
                  <tr key={c.id} onClick={() => setSelectedRow(c.id)} onDoubleClick={() => router.push(`/claims/${c.id}`)}
                    className={`border-b border-[#F1F5F9] cursor-pointer transition-colors ${selectedRow === c.id ? 'bg-[#EFF6FF]' : isRework ? 'bg-red-50/30' : 'hover:bg-[#FAFBFC]'}`}>
                    {isSuper && <td className="px-2 py-2.5" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="rounded border-[#D1D5DB]" checked={selectedClaims.includes(c.id)} onChange={() => setSelectedClaims(selectedClaims.includes(c.id) ? selectedClaims.filter(x => x !== c.id) : [...selectedClaims, c.id])} />
                    </td>}
                    <td className="px-3 py-2.5"><button onClick={e => { e.stopPropagation(); router.push(`/claims/${c.id}`); }} className="text-[#2563EB] hover:underline text-[13px] font-medium max-w-[200px] truncate block text-left">{c.claimNumber}</button></td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-700 font-medium max-w-[170px] truncate" title={practiceLabel !== '—' ? practiceLabel : undefined}>{practiceLabel}</td>
                    <td className="px-3 py-2.5"><p className="text-[13px] font-bold text-slate-900 uppercase">{c.patientName || '—'}</p>{c.dateOfService && <p className="text-[11px] text-[#94A3B8]">{fmtDate(c.dateOfService)}</p>}</td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-800 max-w-[140px] truncate">{c.insurance || '—'}</td>
                    <td className="px-3 py-2.5 text-[13px] text-[#64748B]">{c.assigneeName || '—'}</td>
                    <td className="px-3 py-2.5 text-[13px] font-bold text-slate-900 whitespace-nowrap">{fmt(c.balance)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap"><span className={`text-[13px] font-bold ${aging > 180 ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>{aging}d</span><span className="text-[11px] text-[#94A3B8] ml-1">{aging > 180 ? '180+' : aging > 90 ? '90-180' : aging > 60 ? '60-90' : aging > 30 ? '30-60' : '0-30'}</span></td>
                    <td className="px-3 py-2.5"><span className={`text-[12px] font-semibold ${isHigh ? 'text-[#DC2626]' : 'text-slate-600'}`}>{priorityLabel}</span></td>
                    <td className="px-3 py-2.5"><WorkflowBadge ws={c.workflowStatus} /></td>
                    <td className="px-3 py-2.5"><StatusPill status={c.status} /></td>
                    <td className="px-3 py-2.5 text-[13px] text-[#64748B]">{c.subStatus || '—'}</td>
                    <td className="px-3 py-2.5 text-[13px] text-[#64748B] whitespace-nowrap">{fmtDate(c.workedDate)}</td>
                    <td className="px-3 py-2.5 text-[13px] text-[#64748B] whitespace-nowrap">{fmtDate(c.followUpDate)}</td>
                    <td className="px-3 py-2.5 text-[13px] text-[#64748B]">{c.approvedByName || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 flex items-center justify-between border-t border-[#E5E7EB] bg-[#FAFBFC]">
          <p className="text-[13px] text-[#64748B]">Showing <span className="font-semibold text-slate-900">{claims.length > 0 ? ((page-1)*50)+1 : 0}-{Math.min(page*50,total)}</span> of <span className="font-semibold text-slate-900">{total}</span> claims</p>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} className="px-2.5 py-1 text-[13px] text-[#64748B] hover:bg-[#F1F5F9] rounded disabled:opacity-30">Prev</button>
            {Array.from({length:Math.min(totalPages,5)},(_,i)=>i+1).map(p => (
              <button key={p} onClick={() => setPage(p)} className={`w-7 h-7 text-[13px] rounded font-medium ${page===p?'bg-[#2563EB] text-white':'text-[#64748B] hover:bg-[#F1F5F9]'}`}>{p}</button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} className="px-2.5 py-1 text-[13px] text-[#64748B] hover:bg-[#F1F5F9] rounded disabled:opacity-30">Next</button>
          </div>
        </div>
      </div>

      {/* Assign Modal */}
      <Modal isOpen={showAssign} onClose={() => setShowAssign(false)} title="Assign Claims">
        <p className="text-[#64748B] text-sm mb-4">Assign {selectedClaims.length} claim(s):</p>
        <Select label="Assignee" value={assignee} onChange={e => setAssignee(e.target.value)}
          options={[{value:'',label:'Select...'}, ...users.map(u => ({value:u.id,label:`${u.firstName} ${u.lastName}`}))]} />
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => setShowAssign(false)}>Cancel</Button>
          <Button onClick={handleBulkAssign} loading={assigning} disabled={!assignee}>Assign</Button>
        </div>
      </Modal>
    </AppLayout>
  );
}
