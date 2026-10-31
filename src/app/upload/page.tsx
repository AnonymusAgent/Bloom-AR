'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  X,
  ArrowRight,
  ArrowLeft,
  Building2,
  User,
  Table,
  Layers,
  ShieldAlert,
  Sparkles,
  AlertTriangle,
  RefreshCw,
  Eye,
  Check,
} from 'lucide-react';
import { CanonicalFieldDefinition, WorkbookInspection } from '@/lib/file-parser';

interface Practice {
  id: string;
  name: string;
  code: string;
  specialty: string | null;
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface CurrentUser {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
}

type Step = 'select' | 'mapping' | 'assignment' | 'importing' | 'completed';

const CANONICAL_FIELD_OPTIONS: { key: string; label: string; required?: boolean }[] = [
  { key: 'ignore', label: '— Ignore (or store as extra data) —' },
  { key: 'claimNumber', label: 'Claim Number *', required: true },
  { key: 'patientName', label: 'Patient / Member Name *', required: true },
  { key: 'billedAmount', label: 'Billed Amount ($) *', required: true },
  { key: 'balance', label: 'Outstanding Balance ($)' },
  { key: 'paidAmount', label: 'Paid Amount ($)' },
  { key: 'dateOfService', label: 'Date of Service (DOS)' },
  { key: 'insurance', label: 'Insurance / Payer Name' },
  { key: 'payer', label: 'Payer ID' },
  { key: 'provider', label: 'Rendering Provider' },
  { key: 'accountNumber', label: 'Account / Chart #' },
  { key: 'cptCodes', label: 'CPT / Procedure Code' },
  { key: 'diagnosisCode', label: 'Diagnosis (ICD-10)' },
  { key: 'status', label: 'Claim Status' },
  { key: 'denialReason', label: 'Denial Reason / CARC' },
  { key: 'location', label: 'Location / Facility' },
];

export default function UploadPage() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  const [step, setStep] = useState<Step>('select');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inspection states
  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<WorkbookInspection | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [canonicalFields, setCanonicalFields] = useState<CanonicalFieldDefinition[]>([]);

  // Practice & Assignment states
  const [practices, setPractices] = useState<Practice[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedPractice, setSelectedPractice] = useState('');
  const [allowUnlinkedPractice, setAllowUnlinkedPractice] = useState(false);
  const [showQuickPractice, setShowQuickPractice] = useState(false);
  const [newPracticeName, setNewPracticeName] = useState('');
  const [newPracticeCode, setNewPracticeCode] = useState('');
  const [newPracticeSpecialty, setNewPracticeSpecialty] = useState('');
  const [creatingPractice, setCreatingPractice] = useState(false);
  const [providerOverride, setProviderOverride] = useState('');
  const [assignedUser, setAssignedUser] = useState('');

  // Import Execution states
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string>('');
  const [importResult, setImportResult] = useState<{
    success: boolean;
    recordsProcessed?: number;
    skippedRows?: number;
    duplicatesInFile?: number;
    practice?: { id: string; name: string; code: string } | null;
    warnings?: string[];
    error?: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Check user role on mount
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setCurrentUser(data.user);
          const authorizedRoles = ['administrator', 'supervisor', 'manager', 'senior_lead'];
          setIsAuthorized(authorizedRoles.includes(data.user.role));
        }
      })
      .catch(console.error)
      .finally(() => setCheckingAuth(false));

    // Load available practices and active billing users
    fetch('/api/practices/my', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setPractices(d.practices || []))
      .catch(console.error);

    fetch('/api/users?isActive=true', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const permitted = (d.users || []).filter((u: UserOption) =>
          ['ar_executive', 'billing_user', 'team_lead'].includes(u.role)
        );
        setUsers(permitted);
      })
      .catch(console.error);
  }, []);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = (file: File) => {
    setErrorMessage(null);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      setErrorMessage('Please select a valid Excel (.xlsx, .xls) or CSV file.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setErrorMessage('File size exceeds the 25MB limit. Please choose a smaller file.');
      return;
    }
    setSelectedFile(file);
  };

  // Inspect the workbook
  const analyzeWorkbook = async (fileToInspect: File, sheetOverride?: string) => {
    setInspecting(true);
    setErrorMessage(null);
    try {
      const fd = new FormData();
      fd.append('file', fileToInspect);
      if (sheetOverride) {
        fd.append('sheetName', sheetOverride);
      }

      const res = await fetch('/api/upload/inspect', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to inspect file');
      }

      const ins: WorkbookInspection = data.inspection;
      setInspection(ins);
      setSelectedSheet(ins.selectedSheet);
      setCanonicalFields(data.canonicalFields || []);

      // Initialize mapping from suggested mappings
      const initialMap: Record<string, string> = {};
      ins.headers.forEach((h) => {
        initialMap[h] = ins.suggestedMapping[h] || 'ignore';
      });
      setColumnMapping(initialMap);
      setStep('mapping');
    } catch (err: any) {
      setErrorMessage(err.message || 'Error analyzing Excel file.');
    } finally {
      setInspecting(false);
    }
  };

  const handleSheetChange = (sheet: string) => {
    setSelectedSheet(sheet);
    if (selectedFile) {
      analyzeWorkbook(selectedFile, sheet);
    }
  };

  const handleMappingChange = (originalHeader: string, targetKey: string) => {
    setColumnMapping((prev) => ({
      ...prev,
      [originalHeader]: targetKey,
    }));
  };

  // Execute Final Import
  const handleFinalImport = async () => {
    if (!selectedFile) return;
    setStep('importing');
    setImporting(true);
    setImportProgress('Sending file to ingestion pipeline...');
    setErrorMessage(null);

    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      if (selectedPractice) fd.append('practiceId', selectedPractice);
      if (providerOverride) fd.append('provider', providerOverride);
      if (assignedUser) fd.append('assignedTo', assignedUser);
      if (selectedSheet) fd.append('sheetName', selectedSheet);
      if (inspection?.headerRowIndex !== undefined) {
        fd.append('headerRowIndex', String(inspection.headerRowIndex));
      }
      fd.append('columnMapping', JSON.stringify(columnMapping));

      setImportProgress('Validating rows and committing claim batches to Neon DB...');
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to process import.');
      }

      setImportResult({
        success: true,
        recordsProcessed: data.recordsProcessed,
        skippedRows: data.skippedRows,
        duplicatesInFile: data.duplicatesInFile,
        practice: data.practice || null,
        warnings: data.warnings,
      });
      setStep('completed');
    } catch (err: any) {
      console.error('Import error:', err);
      setImportResult({
        success: false,
        error: err.message || 'Import failed unexpectedly.',
      });
      setStep('completed');
    } finally {
      setImporting(false);
    }
  };

  const handleQuickCreatePractice = async () => {
    if (!newPracticeName.trim() || !newPracticeCode.trim()) return;
    setCreatingPractice(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/practices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newPracticeName.trim(),
          code: newPracticeCode.trim().toUpperCase(),
          specialty: newPracticeSpecialty.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to create practice.');
        return;
      }
      const created: Practice = data.practice;
      setPractices((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedPractice(created.id);
      setAllowUnlinkedPractice(false);
      setShowQuickPractice(false);
      setNewPracticeName('');
      setNewPracticeCode('');
      setNewPracticeSpecialty('');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create practice.');
    } finally {
      setCreatingPractice(false);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setInspection(null);
    setColumnMapping({});
    setSelectedPractice('');
    setAllowUnlinkedPractice(false);
    setProviderOverride('');
    setAssignedUser('');
    setImportResult(null);
    setErrorMessage(null);
    setStep('select');
  };

  const fmtSize = (b: number) =>
    b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;

  if (checkingAuth) {
    return (
      <AppLayout title="Upload AR Files">
        <div className="flex flex-col items-center justify-center min-h-[350px]">
          <div className="w-8 h-8 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-slate-500 text-sm">Verifying permissions...</p>
        </div>
      </AppLayout>
    );
  }

  // RESTRICTED ACCESS SCREEN
  if (!isAuthorized) {
    return (
      <AppLayout title="Upload AR Files">
        <div className="max-w-2xl mx-auto my-12">
          <Card>
            <div className="p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto shadow-inner">
                <ShieldAlert className="w-8 h-8" />
              </div>

              <div>
                <h2 className="text-xl font-bold text-slate-900">Upload Permission Restricted</h2>
                <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
                  Your current account role (
                  <span className="font-semibold text-slate-800 uppercase">
                    {currentUser?.role?.replace(/_/g, ' ') || 'User'}
                  </span>
                  ) does not have authorization to upload AR batches or import claim spreadsheets.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 text-left max-w-md mx-auto space-y-2">
                <p className="font-semibold text-slate-800">Who can upload AR files?</p>
                <ul className="list-disc pl-4 space-y-1 text-slate-500">
                  <li>System Administrators</li>
                  <li>Operations Supervisors</li>
                  <li>Account Managers</li>
                  <li>Senior Team Leads</li>
                </ul>
                <p className="text-slate-400 pt-1">
                  If you need to upload AR files for your assigned practices, please contact your supervisor.
                </p>
              </div>

              <div className="pt-4 flex items-center justify-center gap-3">
                <Link href="/claims">
                  <Button variant="secondary">View Workable Claims</Button>
                </Link>
                <Link href="/dashboard">
                  <Button>Return to Dashboard</Button>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const mappedFieldValues = Object.values(columnMapping).filter((v) => v !== 'ignore');
  const hasClaimOrPatient =
    mappedFieldValues.includes('claimNumber') ||
    mappedFieldValues.includes('patientName') ||
    mappedFieldValues.includes('accountNumber');

  return (
    <AppLayout title="Upload AR Files">
      <div className="max-w-5xl mx-auto space-y-6 pb-12">
        {/* Progress Step Indicator */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {[
            { key: 'select', label: '1. Select File', icon: FileText },
            { key: 'mapping', label: '2. Intelligent Mapping & Preview', icon: Table },
            { key: 'assignment', label: '3. Practice & Assignment', icon: Building2 },
            { key: 'completed', label: '4. Summary', icon: CheckCircle },
          ].map((s, i) => {
            const Icon = s.icon;
            const isCurrent = step === s.key || (step === 'importing' && s.key === 'completed');
            const isDone =
              (step === 'mapping' && i < 1) ||
              (step === 'assignment' && i < 2) ||
              (step === 'completed' && i < 3);

            return (
              <React.Fragment key={s.key}>
                {i > 0 && (
                  <div
                    className={`flex-1 h-0.5 min-w-[20px] ${
                      isDone || isCurrent ? 'bg-[#2563EB]' : 'bg-[#E5E7EB]'
                    }`}
                  />
                )}
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                    isCurrent
                      ? 'bg-[#2563EB] text-white shadow-sm'
                      : isDone
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {s.label}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Global Error Banner */}
        {errorMessage && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 flex items-start justify-between gap-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">Upload Notice</p>
                <p className="text-xs text-red-700 mt-0.5">{errorMessage}</p>
              </div>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* STEP 1: SELECT FILE */}
        {step === 'select' && (
          <Card>
            <CardHeader
              title="Select AR Spreadsheet File"
              subtitle="Upload Microsoft Excel (.xlsx, .xls) or CSV files containing accounts receivable records."
            />

            <div
              className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all ${
                dragActive ? 'border-[#2563EB] bg-blue-50/70 scale-[0.99]' : 'border-[#CBD5E1] hover:border-slate-400 bg-white'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="w-16 h-16 rounded-2xl bg-blue-50 text-[#2563EB] flex items-center justify-center mx-auto mb-4 shadow-sm">
                <Upload className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-800 mb-1">
                Drag and drop your Excel or CSV file here
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Supports XLSX, XLS, and CSV files up to 25 MB with automatic column detection.
              </p>
              <Button
                variant="secondary"
                size="md"
                onClick={() => fileInputRef.current?.click()}
              >
                Browse Local Files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileInput}
                className="hidden"
              />
            </div>

            {/* Selected File Card */}
            {selectedFile && (
              <div className="mt-6 p-4 rounded-xl border border-blue-200 bg-blue-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-white rounded-lg border border-blue-200 text-[#2563EB] shadow-sm">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{selectedFile.name}</p>
                    <p className="text-xs text-slate-500">
                      {fmtSize(selectedFile.size)} • Ready for automated structure inspection
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedFile(null)}
                  >
                    Change File
                  </Button>
                  <Button
                    size="sm"
                    loading={inspecting}
                    onClick={() => analyzeWorkbook(selectedFile)}
                  >
                    <Sparkles className="w-4 h-4 mr-1.5" />
                    Inspect & Map Columns
                  </Button>
                </div>
              </div>
            )}

            {/* Accepted columns guide */}
            <div className="mt-6 pt-5 border-t border-[#E5E7EB]">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-[#2563EB]" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Intelligent Field Detection & Synonyms
                </h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                The ingestion engine recognizes standard industry variants (e.g. <i>DOS</i>,{' '}
                <i>Patient Name</i>, <i>Billed</i>, <i>Balance</i>, <i>CARC</i>, <i>CPT</i>). If your
                spreadsheet contains custom column labels, you will be able to review and map them in
                the next step before any data is inserted.
              </p>
            </div>
          </Card>
        )}

        {/* STEP 2: INTELLIGENT MAPPING & PREVIEW */}
        {step === 'mapping' && inspection && (
          <div className="space-y-6">
            {/* Sheet & File Header */}
            <Card>
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Table className="w-5 h-5 text-[#2563EB]" />
                    Spreadsheet Inspection: {inspection.fileName}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Found <b>{inspection.totalDataRows}</b> data rows across{' '}
                    <b>{inspection.headers.length}</b> columns (header row: index{' '}
                    {inspection.headerRowIndex + 1}).
                  </p>
                </div>

                {/* Multi-sheet selector */}
                {inspection.sheets.length > 1 && (
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-[#E5E7EB]">
                    <Layers className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-medium text-slate-600">Worksheet:</span>
                    <select
                      value={selectedSheet}
                      onChange={(e) => handleSheetChange(e.target.value)}
                      className="text-xs font-semibold bg-white border border-[#E5E7EB] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {inspection.sheets.map((sh) => (
                        <option key={sh} value={sh}>
                          {sh}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Warnings Banner if any */}
              {inspection.warnings.length > 0 && (
                <div className="mt-4 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    {inspection.warnings.map((w, idx) => (
                      <p key={idx}>{w}</p>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* Column Mapping Table */}
            <Card>
              <CardHeader
                title="Review & Adjust Column Mappings"
                subtitle="Verify how columns from your spreadsheet map to BloomAR Manager claims fields. Unmapped columns are safely stored as additional reference data."
              />

              <div className="overflow-x-auto border border-[#E5E7EB] rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-[#E5E7EB]">
                      <th className="py-2.5 px-3">Excel Column Header</th>
                      <th className="py-2.5 px-3">Sample Values from File</th>
                      <th className="py-2.5 px-3">Map to AR Field</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {inspection.headers.map((header) => {
                      const currentMapped = columnMapping[header] || 'ignore';
                      const samples = inspection.columnSamples[header] || [];
                      const isMapped = currentMapped !== 'ignore';

                      return (
                        <tr
                          key={header}
                          className={`hover:bg-slate-50 transition-colors ${
                            isMapped ? 'bg-blue-50/20' : ''
                          }`}
                        >
                          <td className="py-2.5 px-3 font-semibold text-slate-800 max-w-[200px] truncate">
                            {header}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 max-w-[240px]">
                            {samples.length > 0 ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {samples.map((s, idx) => (
                                  <span
                                    key={idx}
                                    className="px-1.5 py-0.5 rounded bg-slate-100 text-[11px] text-slate-600 font-mono"
                                  >
                                    {s}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="italic text-slate-400">Blank</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={currentMapped}
                              onChange={(e) => handleMappingChange(header, e.target.value)}
                              className={`w-full max-w-xs px-2.5 py-1.5 rounded-lg text-xs border focus:outline-none focus:ring-2 ${
                                isMapped
                                  ? 'border-blue-300 bg-white font-medium text-blue-900 focus:ring-blue-500/20'
                                  : 'border-[#E5E7EB] bg-slate-50 text-slate-600'
                              }`}
                            >
                              {CANONICAL_FIELD_OPTIONS.map((opt) => (
                                <option key={opt.key} value={opt.key}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {isMapped ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                                <Check className="w-3 h-3 text-emerald-600" /> Mapped
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">
                                Additional Data
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Requirement Check notice */}
              {!hasClaimOrPatient && (
                <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                  <b>Mapping Recommendation:</b> At least one column should be mapped to{' '}
                  <b>Claim Number</b>, <b>Patient Name</b>, or <b>Account Number</b> to ensure claims
                  can be identified in the work queue.
                </div>
              )}
            </Card>

            {/* Live Sample Preview Table */}
            <Card>
              <CardHeader
                title="Sample Records Preview (First 10 Rows)"
                subtitle="Preview how your spreadsheet data will be formatted prior to database insertion."
              />

              <div className="overflow-x-auto border border-[#E5E7EB] rounded-xl max-h-[300px]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100 border-b border-[#E5E7EB] shadow-sm">
                    <tr>
                      <th className="py-2 px-3 text-slate-500 font-medium">#</th>
                      {inspection.headers.map((h) => (
                        <th key={h} className="py-2 px-3 text-slate-700 font-semibold whitespace-nowrap">
                          {h}
                          {columnMapping[h] && columnMapping[h] !== 'ignore' && (
                            <span className="block text-[10px] text-blue-600 font-mono font-normal">
                              → {columnMapping[h]}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {inspection.sampleRows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50">
                        <td className="py-2 px-3 text-slate-400 font-mono">{rIdx + 1}</td>
                        {inspection.headers.map((h) => (
                          <td key={h} className="py-2 px-3 text-slate-700 whitespace-nowrap max-w-[200px] truncate">
                            {String(row[h] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center pt-4">
                <Button variant="secondary" onClick={() => setStep('select')}>
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back to Files
                </Button>
                <Button onClick={() => setStep('assignment')}>
                  Continue to Practice & Assignment <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* STEP 3: PRACTICE & USER ASSIGNMENT */}
        {step === 'assignment' && (
          <Card>
            <CardHeader
              title="Practice & User Assignment"
              subtitle="Associate the imported claims with an authorized practice and assign the initial workload."
            />

            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-slate-700">
                    Target Practice *
                  </label>
                  {currentUser && ['administrator', 'supervisor', 'manager'].includes(currentUser.role) && (
                    <button
                      type="button"
                      onClick={() => setShowQuickPractice((v) => !v)}
                      className="text-xs font-semibold text-[#2563EB] hover:underline"
                    >
                      {showQuickPractice ? 'Cancel' : '+ Create New Practice'}
                    </button>
                  )}
                </div>

                {showQuickPractice && (
                  <div className="mb-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                    <p className="text-xs font-semibold text-slate-700">Quick Create Medical Practice</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <Input
                        value={newPracticeCode}
                        onChange={(e) => setNewPracticeCode(e.target.value)}
                        placeholder="Code (e.g. SUNRISE)"
                      />
                      <Input
                        value={newPracticeName}
                        onChange={(e) => setNewPracticeName(e.target.value)}
                        placeholder="Practice Name *"
                      />
                      <Input
                        value={newPracticeSpecialty}
                        onChange={(e) => setNewPracticeSpecialty(e.target.value)}
                        placeholder="Specialty (optional)"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={handleQuickCreatePractice}
                        loading={creatingPractice}
                        disabled={!newPracticeName.trim() || !newPracticeCode.trim()}
                      >
                        Save & Select Practice
                      </Button>
                    </div>
                  </div>
                )}

                <select
                  value={selectedPractice}
                  onChange={(e) => {
                    setSelectedPractice(e.target.value);
                    if (e.target.value) setAllowUnlinkedPractice(false);
                  }}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  required
                >
                  <option value="">-- Select Medical Practice --</option>
                  {practices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name} {p.specialty ? `(${p.specialty})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  Claims will be linked to this practice across Claims, Work Queue, Review, and Reports.
                </p>

                {!selectedPractice && currentUser?.role === 'administrator' && (
                  <label className="mt-2 inline-flex items-center gap-2 text-xs text-amber-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowUnlinkedPractice}
                      onChange={(e) => setAllowUnlinkedPractice(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Import without linking to a practice (Administrator override)
                  </label>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Default Rendering Provider (Optional)
                </label>
                <Input
                  value={providerOverride}
                  onChange={(e) => setProviderOverride(e.target.value)}
                  placeholder="Physician name or NPI (if not already in spreadsheet)"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Assign Claims to Billing Specialist / AR Executive (Optional)
                </label>
                <select
                  value={assignedUser}
                  onChange={(e) => setAssignedUser(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                >
                  <option value="">-- Unassigned (Hold in General Workable AR Queue) --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} ({u.role.replace(/_/g, ' ')})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  Assigned user will receive an automated notification and claim queue update upon completion.
                </p>
              </div>

              {/* Review Summary Box */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200">
                <h4 className="text-xs font-bold uppercase tracking-wider text-blue-900 mb-3 flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-[#2563EB]" /> Ready for AR Ingestion
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-blue-600 block">File</span>
                    <span className="font-semibold text-slate-900 truncate block">
                      {selectedFile?.name}
                    </span>
                  </div>
                  <div>
                    <span className="text-blue-600 block">Estimated Rows</span>
                    <span className="font-semibold text-slate-900">
                      {inspection?.totalDataRows} claims
                    </span>
                  </div>
                  <div>
                    <span className="text-blue-600 block">Practice</span>
                    <span className="font-semibold text-slate-900">
                      {practices.find((p) => p.id === selectedPractice)?.name || (
                        <span className="text-amber-600">Please select</span>
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-blue-600 block">Assigned To</span>
                    <span className="font-semibold text-slate-900">
                      {users.find((u) => u.id === assignedUser)
                        ? `${users.find((u) => u.id === assignedUser)?.firstName} ${
                            users.find((u) => u.id === assignedUser)?.lastName
                          }`
                        : 'Unassigned Queue'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3">
                <Button variant="secondary" onClick={() => setStep('mapping')}>
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back to Column Mapping
                </Button>
                <Button
                  onClick={handleFinalImport}
                  disabled={!selectedPractice && !(currentUser?.role === 'administrator' && allowUnlinkedPractice)}
                >
                  Confirm & Import Claims <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* STEP 4: IMPORTING PROGRESS & COMPLETED SUMMARY */}
        {(step === 'importing' || step === 'completed') && (
          <Card>
            {importing && (
              <div className="py-12 text-center space-y-4">
                <div className="w-12 h-12 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">Importing AR Records</h3>
                  <p className="text-xs text-slate-500 mt-1">{importProgress}</p>
                </div>
              </div>
            )}

            {step === 'completed' && importResult && (
              <div className="space-y-6">
                <div
                  className={`p-6 rounded-2xl border text-center ${
                    importResult.success
                      ? 'bg-emerald-50/70 border-emerald-200'
                      : 'bg-red-50/70 border-red-200'
                  }`}
                >
                  <div
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 ${
                      importResult.success
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {importResult.success ? (
                      <CheckCircle className="w-8 h-8" />
                    ) : (
                      <AlertCircle className="w-8 h-8" />
                    )}
                  </div>

                  <h3 className="text-xl font-bold text-slate-900">
                    {importResult.success ? 'AR Batch Successfully Imported' : 'Import Processing Error'}
                  </h3>
                  <p className="text-xs text-slate-600 mt-1 max-w-lg mx-auto">
                    {importResult.success
                      ? `Successfully parsed and recorded ${importResult.recordsProcessed} claim(s) from "${selectedFile?.name}"${
                          importResult.practice
                            ? ` under ${importResult.practice.code} — ${importResult.practice.name}`
                            : ''
                        }.`
                      : importResult.error}
                  </p>

                  {importResult.success && (
                    <div className="grid grid-cols-3 gap-3 max-w-md mx-auto mt-4 text-xs">
                      <div className="p-3 bg-white rounded-xl border border-emerald-100">
                        <span className="text-slate-400 block">Imported</span>
                        <span className="text-base font-bold text-emerald-700">
                          {importResult.recordsProcessed}
                        </span>
                      </div>
                      <div className="p-3 bg-white rounded-xl border border-emerald-100">
                        <span className="text-slate-400 block">Skipped / Blank</span>
                        <span className="text-base font-bold text-slate-700">
                          {importResult.skippedRows ?? 0}
                        </span>
                      </div>
                      <div className="p-3 bg-white rounded-xl border border-emerald-100">
                        <span className="text-slate-400 block">Duplicates Resolved</span>
                        <span className="text-base font-bold text-slate-700">
                          {importResult.duplicatesInFile ?? 0}
                        </span>
                      </div>
                    </div>
                  )}

                  {importResult.warnings && importResult.warnings.length > 0 && (
                    <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 text-left max-w-md mx-auto space-y-1">
                      <p className="font-semibold text-amber-900">Batch Notices:</p>
                      {importResult.warnings.map((w, i) => (
                        <p key={i}>• {w}</p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <Button variant="secondary" onClick={resetForm}>
                    <RefreshCw className="w-4 h-4 mr-2" /> Upload Another File
                  </Button>
                  <Link href="/claims">
                    <Button>
                      View Workable AR Claims <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
