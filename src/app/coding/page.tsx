'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, Textarea } from '@/components/ui/Input';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell, TableEmpty } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

interface CodingReq {
  id: string; claimId: string; claimNumber: string|null; patientName: string|null; status: string;
  practiceName?: string|null;
  denialReason: string|null; comments: string|null; correctionNotes: string|null;
  senderName: string; assigneeName: string|null; createdAt: string;
}

function CodingStatusBadge({ status }: { status: string }) {
  const c: Record<string,{v:'success'|'warning'|'danger'|'info'|'default'|'purple';l:string}> = {
    sent_to_coding:{v:'info',l:'Sent to Coding'}, under_review:{v:'warning',l:'Under Review'},
    corrected:{v:'success',l:'Corrected'}, returned_to_billing:{v:'purple',l:'Returned'},
    resubmitted:{v:'success',l:'Resubmitted'},
  };
  const cfg = c[status] || {v:'default' as const,l:status};
  return <Badge variant={cfg.v}>{cfg.l}</Badge>;
}

export default function CodingPage() {
  const [requests, setRequests] = useState<CodingReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showUpdate, setShowUpdate] = useState(false);
  const [selected, setSelected] = useState<CodingReq|null>(null);
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateNotes, setUpdateNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({page:String(page),limit:'20'});
      if (status) p.set('status', status);
      const res = await fetch(`/api/coding?${p}`);
      const data = await res.json();
      if (res.ok) { setRequests(data.codingRequests); setTotalPages(data.pagination.totalPages); }
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [page, status]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleUpdate = async () => {
    if (!selected || !updateStatus) return; setSaving(true);
    try {
      await fetch(`/api/coding/${selected.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ status:updateStatus, correctionNotes:updateNotes }) });
      setShowUpdate(false); setSelected(null); setUpdateNotes(''); fetchRequests();
    } catch(e) { console.error(e); }
    finally { setSaving(false); }
  };

  return (
    <AppLayout title="Coding Queue">
      <Card padding="none">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4">
          <Select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}} options={[
            {value:'',label:'All Statuses'},{value:'sent_to_coding',label:'Sent to Coding'},{value:'under_review',label:'Under Review'},
            {value:'corrected',label:'Corrected'},{value:'returned_to_billing',label:'Returned to Billing'},{value:'resubmitted',label:'Resubmitted'},
          ]} className="w-48" />
        </div>
        <Table>
          <TableHead><TableRow>
            <TableHeader>Claim #</TableHeader><TableHeader>Practice</TableHeader><TableHeader>Patient</TableHeader><TableHeader>Denial Reason</TableHeader>
            <TableHeader>Sent By</TableHeader><TableHeader>Status</TableHeader><TableHeader>Date</TableHeader><TableHeader>Actions</TableHeader>
          </TableRow></TableHead>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={8} className="text-center py-8">Loading...</TableCell></TableRow>
            : requests.length===0 ? <TableEmpty message="No coding requests"/>
            : requests.map(r=>(
              <TableRow key={r.id}>
                <TableCell><button className="text-blue-600 hover:underline font-medium" onClick={()=>router.push(`/claims/${r.claimId}`)}>{r.claimNumber||'-'}</button></TableCell>
                <TableCell className="text-slate-700 font-medium">{r.practiceName||'-'}</TableCell>
                <TableCell>{r.patientName||'-'}</TableCell>
                <TableCell><span className="text-sm text-slate-600 line-clamp-2">{r.denialReason||'-'}</span></TableCell>
                <TableCell>{r.senderName}</TableCell>
                <TableCell><CodingStatusBadge status={r.status}/></TableCell>
                <TableCell className="text-slate-500">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={()=>{setSelected(r);setUpdateStatus(r.status==='sent_to_coding'?'under_review':'corrected');setShowUpdate(true);}}>Update</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
          <p className="text-sm text-slate-600">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}><ChevronLeft className="w-4 h-4"/></Button>
            <Button variant="outline" size="sm" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}><ChevronRight className="w-4 h-4"/></Button>
          </div>
        </div>
      </Card>

      <Modal isOpen={showUpdate} onClose={()=>setShowUpdate(false)} title="Update Coding Request">
        {selected && <div className="space-y-4">
          <div className="p-4 bg-slate-50 rounded-lg"><p className="text-sm text-slate-500">Claim</p><p className="font-semibold">{selected.claimNumber}</p>
            {selected.denialReason && <p className="text-sm text-slate-600 mt-2">{selected.denialReason}</p>}</div>
          <Select label="Status" value={updateStatus} onChange={e=>setUpdateStatus(e.target.value)} options={[
            {value:'under_review',label:'Under Review'},{value:'corrected',label:'Corrected'},{value:'returned_to_billing',label:'Return to Billing'},{value:'resubmitted',label:'Resubmitted'},
          ]}/>
          <Textarea label="Notes" value={updateNotes} onChange={e=>setUpdateNotes(e.target.value)} placeholder="Add correction notes..." rows={4}/>
          <div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowUpdate(false)}>Cancel</Button><Button onClick={handleUpdate} loading={saving}>Update</Button></div>
        </div>}
      </Modal>
    </AppLayout>
  );
}
