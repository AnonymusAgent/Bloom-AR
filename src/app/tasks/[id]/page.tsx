'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import {
  ArrowLeft, Save, Upload, FileText, Clock, User, CheckCircle, Send, Download,
} from 'lucide-react';

interface TaskDetail {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  priority: string | null;
  patientName: string | null;
  insuranceName: string | null;
  memberId: string | null;
  authNumber: string | null;
  referralNumber: string | null;
  serviceDate: string | null;
  expirationDate: string | null;
  dueDate: string | null;
  notes: string | null;
  result: string | null;
  assignee: { id: string; firstName: string; lastName: string } | null;
  practice: { id: string; name: string; code: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface Note {
  id: string;
  note: string;
  isSupervisorComment: boolean;
  userName: string;
  createdAt: string;
}

interface Document {
  id: string;
  documentType: string;
  fileName: string;
  status: string;
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

function TaskStatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple'; label: string }> = {
    new: { variant: 'info', label: 'New' },
    assigned: { variant: 'purple', label: 'Assigned' },
    in_progress: { variant: 'warning', label: 'In Progress' },
    pending: { variant: 'default', label: 'Pending' },
    completed: { variant: 'success', label: 'Completed' },
    submitted_for_signoff: { variant: 'info', label: 'Pending Sign-off' },
    signed_off: { variant: 'success', label: 'Signed Off' },
    rejected: { variant: 'danger', label: 'Rejected' },
  };
  const c = config[status] || { variant: 'default' as const, label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState('authorization');
  const [currentUser, setCurrentUser] = useState<{ id: string; role: string } | null>(null);
  const router = useRouter();

  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${resolvedParams.id}`);
      const data = await res.json();
      if (res.ok) {
        setTask(data.task);
        setNotes(data.notes);
        setDocuments(data.documents);
        setStatusHistory(data.statusHistory);
      }
    } catch (error) {
      console.error('Failed to fetch task:', error);
    } finally {
      setLoading(false);
    }
  }, [resolvedParams.id]);

  useEffect(() => {
    fetchTask();
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => setCurrentUser(data.user))
      .catch(console.error);
  }, [fetchTask]);

  const handleSaveNote = async () => {
    if (!newNote.trim()) return;
    try {
      const res = await fetch(`/api/tasks/${resolvedParams.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: newNote }),
      });
      if (res.ok) {
        const data = await res.json();
        setNotes([data.note, ...notes]);
        setNewNote('');
      }
    } catch (error) {
      console.error('Failed to save note:', error);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${resolvedParams.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        fetchTask();
      }
    } catch (error) {
      console.error('Failed to update status:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitSignoff = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/signoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'task',
          entityId: resolvedParams.id,
          taskId: resolvedParams.id,
        }),
      });
      if (res.ok) {
        fetchTask();
      }
    } catch (error) {
      console.error('Failed to submit signoff:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleUploadDocument = async () => {
    if (!uploadFile) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('documentType', uploadType);

      const res = await fetch(`/api/tasks/${resolvedParams.id}/documents`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        setShowUploadModal(false);
        setUploadFile(null);
        fetchTask();
      }
    } catch (error) {
      console.error('Failed to upload document:', error);
    } finally {
      setSaving(false);
    }
  };

  const isSupervisor = currentUser && ['administrator', 'supervisor', 'manager', 'senior_lead', 'team_lead'].includes(currentUser.role);
  const canWork = task?.assignee?.id === currentUser?.id || isSupervisor;

  if (loading) {
    return (
      <AppLayout title="Task Details">
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (!task) {
    return (
      <AppLayout title="Task Details">
        <div className="text-center py-12">
          <p className="text-slate-500">Task not found</p>
          <Button onClick={() => router.back()} className="mt-4">Go Back</Button>
        </div>
      </AppLayout>
    );
  }

  const categoryLabels: Record<string, string> = {
    prior_authorization: 'Prior Authorization',
    referral_management: 'Referral Management',
    verification_of_benefits: 'Verification of Benefits',
    charge_entry: 'Charge Entry',
    payment_posting: 'Payment Posting',
    custom: 'Custom Task',
  };

  return (
    <AppLayout title={task.title}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{task.title}</h1>
            <div className="flex items-center gap-2 mt-1">
              <TaskStatusBadge status={task.status} />
              <Badge variant="default">{categoryLabels[task.category]}</Badge>
              {task.priority && task.priority !== 'normal' && (
                <Badge variant={task.priority === 'urgent' ? 'danger' : task.priority === 'high' ? 'warning' : 'default'}>
                  {task.priority}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {canWork && task.status === 'assigned' && (
            <Button variant="secondary" onClick={() => handleStatusChange('in_progress')} loading={saving}>
              Start Working
            </Button>
          )}
          {canWork && task.status === 'in_progress' && (
            <Button variant="secondary" onClick={() => handleStatusChange('completed')} loading={saving}>
              <CheckCircle className="w-4 h-4 mr-2" />
              Mark Complete
            </Button>
          )}
          {canWork && task.status === 'completed' && (
            <Button onClick={handleSubmitSignoff} loading={saving}>
              <Send className="w-4 h-4 mr-2" />
              Submit for Sign-off
            </Button>
          )}
          <Button variant="secondary" onClick={() => setShowUploadModal(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Document
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader title="Task Information" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-500">Patient Name</label>
                <p className="font-medium">{task.patientName || '-'}</p>
              </div>
              <div>
                <label className="text-sm text-slate-500">Insurance</label>
                <p className="font-medium">{task.insuranceName || '-'}</p>
              </div>
              <div>
                <label className="text-sm text-slate-500">Member ID</label>
                <p className="font-medium">{task.memberId || '-'}</p>
              </div>
              <div>
                <label className="text-sm text-slate-500">Service Date</label>
                <p className="font-medium">{task.serviceDate || '-'}</p>
              </div>
              {task.category === 'prior_authorization' && (
                <>
                  <div>
                    <label className="text-sm text-slate-500">Auth Number</label>
                    <p className="font-medium">{task.authNumber || '-'}</p>
                  </div>
                  <div>
                    <label className="text-sm text-slate-500">Expiration Date</label>
                    <p className="font-medium">{task.expirationDate || '-'}</p>
                  </div>
                </>
              )}
              {task.category === 'referral_management' && (
                <div>
                  <label className="text-sm text-slate-500">Referral Number</label>
                  <p className="font-medium">{task.referralNumber || '-'}</p>
                </div>
              )}
              <div>
                <label className="text-sm text-slate-500">Due Date</label>
                <p className="font-medium">{task.dueDate || '-'}</p>
              </div>
            </div>
            {task.description && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <label className="text-sm text-slate-500">Description</label>
                <p className="mt-1">{task.description}</p>
              </div>
            )}
            {task.result && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <label className="text-sm text-slate-500">Result</label>
                <p className="mt-1">{task.result}</p>
              </div>
            )}
          </Card>

          {/* Notes Section */}
          <Card>
            <CardHeader title="Notes & Activity" />
            {canWork && (
              <div className="mb-4 space-y-3">
                <Textarea
                  placeholder="Add a note..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows={3}
                />
                <Button onClick={handleSaveNote} disabled={!newNote.trim()}>
                  <Save className="w-4 h-4 mr-2" />
                  Save Note
                </Button>
              </div>
            )}
            <div className="space-y-4 mt-4">
              {notes.length === 0 ? (
                <p className="text-slate-500 text-center py-4">No notes yet</p>
              ) : (
                notes.map((note) => (
                  <div key={note.id} className={`p-4 rounded-lg ${note.isSupervisorComment ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <User className="w-4 h-4 text-slate-400" />
                      <span className="font-medium text-slate-900">{note.userName}</span>
                      {note.isSupervisorComment && <Badge variant="warning" size="sm">Supervisor</Badge>}
                      <span className="text-slate-400">•</span>
                      <span className="text-sm text-slate-500">{new Date(note.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-slate-700">{note.note}</p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Assignment" />
            <div className="space-y-3">
              <div>
                <label className="text-sm text-slate-500">Assigned To</label>
                <p className="font-medium">
                  {task.assignee ? `${task.assignee.firstName} ${task.assignee.lastName}` : 'Unassigned'}
                </p>
              </div>
              {task.practice && (
                <div>
                  <label className="text-sm text-slate-500">Practice</label>
                  <p className="font-medium">{task.practice.name}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader title="Documents" />
            {documents.length === 0 ? (
              <p className="text-slate-500 text-center py-4">No documents</p>
            ) : (
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                    <FileText className="w-5 h-5 text-slate-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{doc.fileName}</p>
                      <p className="text-xs text-slate-500">{doc.documentType}</p>
                    </div>
                    <Badge variant={doc.status === 'approved' ? 'success' : doc.status === 'rejected' ? 'danger' : 'default'} size="sm">
                      {doc.status}
                    </Badge>
                    <a
                      href={`/api/tasks/${resolvedParams.id}/documents/${doc.id}`}
                      download={doc.fileName}
                      className="p-1.5 text-slate-500 hover:text-blue-600 rounded"
                      title="Download document"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Status History */}
          <Card>
            <CardHeader title="Status History" />
            <div className="space-y-3">
              {statusHistory.map((item) => (
                <div key={item.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <Clock className="w-4 h-4 text-slate-400" />
                    <div className="w-px h-full bg-slate-200" />
                  </div>
                  <div className="pb-4">
                    <div className="flex items-center gap-2">
                      {item.previousStatus && (
                        <>
                          <TaskStatusBadge status={item.previousStatus} />
                          <span className="text-slate-400">→</span>
                        </>
                      )}
                      <TaskStatusBadge status={item.newStatus} />
                    </div>
                    <p className="text-sm text-slate-600 mt-1">{item.userName}</p>
                    <p className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Upload Modal */}
      <Modal isOpen={showUploadModal} onClose={() => setShowUploadModal(false)} title="Upload Document">
        <div className="space-y-4">
          <Select
            label="Document Type"
            value={uploadType}
            onChange={(e) => setUploadType(e.target.value)}
            options={[
              { value: 'authorization', label: 'Authorization Letter' },
              { value: 'referral', label: 'Referral Form' },
              { value: 'benefits', label: 'Benefits Summary' },
              { value: 'eob', label: 'EOB' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">File</label>
            <input
              type="file"
              accept=".pdf,.xlsx,.xls,.csv"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            <p className="text-xs text-slate-500 mt-1">Supported: PDF, XLSX, XLS, CSV</p>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowUploadModal(false)}>Cancel</Button>
            <Button onClick={handleUploadDocument} loading={saving} disabled={!uploadFile}>Upload</Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
