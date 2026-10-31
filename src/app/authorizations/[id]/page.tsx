'use client';
import React, { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ArrowLeft, CheckCircle, Upload, FileText, Download } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

function AuthStatusBadge({ status }: { status: string }) {
  const c: Record<string,{v:'success'|'warning'|'danger'|'info'|'default';l:string}> = {
    pending:{v:'warning',l:'Pending'}, in_progress:{v:'info',l:'In Progress'}, completed:{v:'success',l:'Completed'}, denied:{v:'danger',l:'Denied'}, expired:{v:'default',l:'Expired'},
  };
  const cfg = c[status] || {v:'default' as const,l:status};
  return <Badge variant={cfg.v}>{cfg.l}</Badge>;
}

export default function AuthDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [auth, setAuth] = useState<Record<string, unknown> | null>(null);
  const [docs, setDocs] = useState<Array<{id:string;fileName:string;mimeType:string;createdAt:string}>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File|null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [completeForm, setCompleteForm] = useState({ authNumber: '', dateObtained: '' });
  const router = useRouter();

  const fetchAuth = useCallback(async () => {
    try {
      const res = await fetch(`/api/authorizations/${id}`);
      const data = await res.json();
      if (res.ok) { setAuth(data.authorization); setDocs(data.documents); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchAuth(); }, [fetchAuth]);

  const handleStatusChange = async (status: string) => {
    setSaving(true);
    try {
      const body: Record<string, string> = { status };
      if (status === 'completed') { body.authNumber = completeForm.authNumber; body.dateObtained = completeForm.dateObtained || new Date().toISOString().split('T')[0]; }
      await fetch(`/api/authorizations/${id}`, { method: 'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      setShowComplete(false); fetchAuth();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const handleUpload = async () => {
    if (!uploadFile) return; setSaving(true);
    try {
      const fd = new FormData(); fd.append('file', uploadFile);
      const res = await fetch(`/api/authorizations/${id}/documents`, { method: 'POST', body: fd });
      if (res.ok) { setShowUpload(false); setUploadFile(null); fetchAuth(); }
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  if (loading) return <AppLayout title="Authorization"><div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"/></div></AppLayout>;
  if (!auth) return <AppLayout title="Authorization"><div className="text-center py-12"><p className="text-slate-500">Not found</p></div></AppLayout>;

  const a = auth as Record<string, string | null | { firstName: string; lastName: string }>;

  return (
    <AppLayout title={`Authorization: ${(a.patientName as string) || ''}`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={()=>router.back()}><ArrowLeft className="w-4 h-4 mr-2"/>Back</Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{a.patientName as string}</h1>
            <div className="flex items-center gap-2 mt-1"><AuthStatusBadge status={a.status as string}/></div>
          </div>
        </div>
        <div className="flex gap-2">
          {a.status === 'pending' && <Button variant="secondary" onClick={()=>handleStatusChange('in_progress')} loading={saving}>Start Working</Button>}
          {(a.status === 'pending' || a.status === 'in_progress') && <Button onClick={()=>setShowComplete(true)}><CheckCircle className="w-4 h-4 mr-2"/>Mark Completed</Button>}
          <Button variant="secondary" onClick={()=>setShowUpload(true)}><Upload className="w-4 h-4 mr-2"/>Upload Doc</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Authorization Details"/>
            <div className="grid grid-cols-2 gap-4">
              {[['Patient',a.patientName],['Insurance',a.insuranceName],['Auth Number',a.authNumber||'-'],['Date Obtained',a.dateObtained||'-'],['Expiration',a.expirationDate||'-'],['Service',a.serviceRequested||'-'],['CPT Codes',a.cptCodes||'-'],['Diagnosis',a.diagnosisCodes||'-']].map(([label,val])=>(
                <div key={label as string}><label className="text-sm text-slate-500">{label as string}</label><p className="font-medium">{val as string}</p></div>
              ))}
            </div>
            {a.notes && <div className="mt-4 pt-4 border-t border-slate-200"><label className="text-sm text-slate-500">Notes</label><p className="mt-1">{a.notes as string}</p></div>}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Assignment"/>
            <div><label className="text-sm text-slate-500">Assigned To</label>
              <p className="font-medium">{a.assignee ? `${(a.assignee as {firstName:string;lastName:string}).firstName} ${(a.assignee as {firstName:string;lastName:string}).lastName}` : 'Unassigned'}</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Documents"/>
            {docs.length === 0 ? <p className="text-slate-500 text-center py-4">No documents</p>
            : <div className="space-y-2">{docs.map(d=>(
              <div key={d.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <FileText className="w-5 h-5 text-slate-400"/><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{d.fileName}</p><p className="text-xs text-slate-500">{new Date(d.createdAt).toLocaleDateString()}</p></div>
                <a href={`/api/authorizations/${id}/documents/${d.id}`} download={d.fileName} className="p-1.5 text-slate-500 hover:text-blue-600 rounded" title="Download document"><Download className="w-4 h-4"/></a>
              </div>
            ))}</div>}
          </Card>
        </div>
      </div>

      <Modal isOpen={showComplete} onClose={()=>setShowComplete(false)} title="Complete Authorization">
        <div className="space-y-4">
          <Input label="Authorization Number" value={completeForm.authNumber} onChange={e=>setCompleteForm({...completeForm,authNumber:e.target.value})} placeholder="Enter auth number received"/>
          <Input label="Date Obtained" type="date" value={completeForm.dateObtained} onChange={e=>setCompleteForm({...completeForm,dateObtained:e.target.value})}/>
          <div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowComplete(false)}>Cancel</Button><Button onClick={()=>handleStatusChange('completed')} loading={saving}>Complete</Button></div>
        </div>
      </Modal>

      <Modal isOpen={showUpload} onClose={()=>setShowUpload(false)} title="Upload Document">
        <div className="space-y-4">
          <input type="file" accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg" onChange={e=>setUploadFile(e.target.files?.[0]||null)} className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700"/>
          <div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowUpload(false)}>Cancel</Button><Button onClick={handleUpload} loading={saving} disabled={!uploadFile}>Upload</Button></div>
        </div>
      </Modal>
    </AppLayout>
  );
}
