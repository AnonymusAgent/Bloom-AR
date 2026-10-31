'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileCheck2,
  FolderTree,
  Info,
  Layers,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  XCircle,
} from 'lucide-react';

interface ICD10CodeSummary {
  code: string;
  normalizedCode: string;
  description: string;
  billable: boolean;
}

interface ICD10NoteItem {
  sourceCode: string;
  text: string;
  referencedCodes: string[];
}

interface ICD10Detail {
  code: string;
  normalizedCode: string;
  exists: boolean;
  billable: boolean;
  fiscalYear: number;
  effectiveDate: string;
  description: string;
  chapter: { num: string; desc: string; range: string } | null;
  section: { id: string; desc: string; ch: string } | null;
  ancestors: ICD10CodeSummary[];
  children: ICD10CodeSummary[];
  billableDescendants: ICD10CodeSummary[];
  siblings: ICD10CodeSummary[];
  notes: {
    includes: ICD10NoteItem[];
    excludes1: ICD10NoteItem[];
    excludes2: ICD10NoteItem[];
    codeFirst: ICD10NoteItem[];
    useAdditionalCode: ICD10NoteItem[];
    sevenChrDef: Record<string, string>;
    sevenChrSource: string | null;
  };
  clinicalAttributes: {
    laterality: 'right' | 'left' | 'bilateral' | 'unspecified' | 'none';
    isUnspecified: boolean;
    isManifestation: boolean;
    requires7thChar: boolean;
    encounterType: 'initial' | 'subsequent' | 'sequela' | null;
    specificAlternatives: ICD10CodeSummary[];
  };
}

interface SearchICD10Item {
  code: string;
  normalizedCode: string;
  description: string;
  billable: boolean;
  chapterNum: string | null;
  sectionId: string | null;
  laterality: string;
}

interface ProcedureCodeInfo {
  code: string;
  codeSystem: 'CPT' | 'HCPCS';
  category: string;
  shortDescriptor: string;
  clinicalSummary: string;
  globalPeriod: string;
  commonModifiers: string[];
  typicalDxPrefixes: string[];
  codingTips: string[];
}

interface ModifierInfo {
  code: string;
  title: string;
  category: string;
  whenToUse: string;
  avoidWhen: string;
  commonDenialsFixed: string[];
}

interface ChapterInfo {
  num: string;
  desc: string;
  range: string;
  sectionCount: number;
  sections: Array<{ id: string; desc: string; ch: string }>;
}

export interface CodingReferencePanelProps {
  compact?: boolean;
  inspectCode?: string | null;
  initialQuery?: string;
  onAddDiagnosis?: (code: string, asPrimary?: boolean) => void;
  onAddProcedure?: (code: string) => void;
  onAppendModifier?: (modifier: string) => void;
}

const SAMPLE_CODES = [
  { code: 'E11.65', label: 'T2DM w/ Hyperglycemia' },
  { code: 'M54.5', label: 'M54.5 Header Demo' },
  { code: 'M25.561', label: 'Right Knee Pain' },
  { code: 'S72.001', label: '7th-Char Fracture' },
  { code: 'I10', label: 'Essential HTN' },
  { code: 'J45.40', label: 'Moderate Asthma' },
  { code: 'N18.30', label: 'CKD Stage 3' },
];

export function CodingReferencePanel({
  compact = false,
  inspectCode,
  initialQuery = '',
  onAddDiagnosis,
  onAddProcedure,
  onAppendModifier,
}: CodingReferencePanelProps) {
  const [subTab, setSubTab] = useState<'icd10' | 'chapters' | 'cpt'>('icd10');
  const [query, setQuery] = useState(initialQuery);
  const [billableOnly, setBillableOnly] = useState(false);
  const [chapterFilter, setChapterFilter] = useState('');
  const [cptScope, setCptScope] = useState<'all' | 'cpt' | 'hcpcs' | 'modifiers'>('all');

  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [releaseMeta, setReleaseMeta] = useState<{
    fiscalYear: number;
    effectiveDate: string;
    billableCodeCount: number;
    headerCodeCount: number;
  } | null>(null);

  const [icdResults, setIcdResults] = useState<SearchICD10Item[]>([]);
  const [procResults, setProcResults] = useState<ProcedureCodeInfo[]>([]);
  const [modResults, setModResults] = useState<ModifierInfo[]>([]);
  const [searching, setSearching] = useState(false);

  const [selectedIcd, setSelectedIcd] = useState<ICD10Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [activeChapterNum, setActiveChapterNum] = useState<string>('13');
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [sectionCategories, setSectionCategories] = useState<ICD10CodeSummary[]>([]);
  const [loadingSection, setLoadingSection] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Load release metadata + chapters + initial CPT/Modifier list once
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/coding/reference?mode=meta', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setReleaseMeta(data.release || null);
        setChapters(data.chapters || []);
        setProcResults(data.featuredProcedures || []);
        setModResults(data.modifiers || []);
      } catch (e) {
        console.error('Failed loading ICD-10 metadata:', e);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const openICD10Detail = useCallback(async (code: string) => {
    if (!code.trim()) return;
    setSubTab('icd10');
    setLoadingDetail(true);
    try {
      const res = await fetch(
        `/api/coding/reference?mode=icd10&code=${encodeURIComponent(code.trim())}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setSelectedIcd(data.detail || null);
      }
    } catch (e) {
      console.error('Failed loading ICD-10 detail:', e);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (inspectCode) {
      openICD10Detail(inspectCode);
    }
  }, [inspectCode, openICD10Detail]);

  // Debounced search for ICD-10-CM and CPT/HCPCS/Modifiers
  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(async () => {
      if (subTab === 'icd10') {
        if (!trimmed) {
          setIcdResults([]);
          return;
        }
        setSearching(true);
        try {
          const p = new URLSearchParams({
            mode: 'search',
            scope: 'icd10',
            q: trimmed,
            limit: '35',
          });
          if (billableOnly) p.set('billableOnly', 'true');
          if (chapterFilter) p.set('chapter', chapterFilter);
          const res = await fetch(`/api/coding/reference?${p}`, { credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            setIcdResults(data.icd10 || []);
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSearching(false);
        }
      } else if (subTab === 'cpt') {
        setSearching(true);
        try {
          const p = new URLSearchParams({
            mode: 'search',
            scope: cptScope === 'all' ? 'all' : cptScope,
            q: trimmed,
            limit: '50',
          });
          const res = await fetch(`/api/coding/reference?${p}`, { credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            setProcResults(data.procedures || []);
            setModResults(data.modifiers || []);
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSearching(false);
        }
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [query, billableOnly, chapterFilter, subTab, cptScope]);

  const loadSectionCategories = async (sectionId: string) => {
    setActiveSectionId(sectionId);
    setLoadingSection(true);
    try {
      const res = await fetch(
        `/api/coding/reference?mode=section&sectionId=${encodeURIComponent(sectionId)}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setSectionCategories(data.categories || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSection(false);
    }
  };

  const handleCopy = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  };

  const activeChapter = chapters.find((c) => c.num === activeChapterNum) || chapters[0] || null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
      {/* Studio Top Bar */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-indigo-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight">
                Built-In ICD-10-CM, CPT/HCPCS &amp; NCCI Coding Studio
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                Ad-Free • In-App
              </span>
            </div>
            <p className="text-[11px] text-slate-300">
              {releaseMeta
                ? `Official CDC/NCHS FY${releaseMeta.fiscalYear} (Eff. ${releaseMeta.effectiveDate}) • ${releaseMeta.billableCodeCount.toLocaleString()} Billable + ${releaseMeta.headerCodeCount.toLocaleString()} Header Codes`
                : 'Official CDC/NCHS FY2027 ICD-10-CM Tabular Set • CPT/HCPCS & Modifiers'}
            </p>
          </div>
        </div>

        {/* Sub-mode switcher */}
        <div className="flex items-center bg-slate-800/90 p-0.5 rounded-lg border border-slate-700 text-xs">
          <button
            type="button"
            onClick={() => setSubTab('icd10')}
            className={`px-2.5 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
              subTab === 'icd10'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            ICD-10-CM
          </button>
          <button
            type="button"
            onClick={() => setSubTab('chapters')}
            className={`px-2.5 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
              subTab === 'chapters'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            Chapters (A00–Z99)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('cpt')}
            className={`px-2.5 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
              subTab === 'cpt'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Stethoscope className="w-3.5 h-3.5" />
            CPT / Modifiers
          </button>
        </div>
      </div>

      {/* === SUBTAB 1: ICD-10-CM SEARCH & FULL CODE DOSSIER === */}
      {subTab === 'icd10' && (
        <div className="p-4 space-y-4">
          {/* Search Controls */}
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Search ICD-10-CM code or clinical terms (e.g., "M54.5", "type 2 diabetes kidney", "right knee pain", "S72.001")...'
                className="w-full pl-9 pr-20 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700 px-1.5 py-0.5"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer select-none bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md">
                  <input
                    type="checkbox"
                    checked={billableOnly}
                    onChange={(e) => setBillableOnly(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Billable FY2027 codes only
                </label>
                <select
                  value={chapterFilter}
                  onChange={(e) => setChapterFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 max-w-[230px]"
                >
                  <option value="">All 22 Chapters (A00–Z99)</option>
                  {chapters.map((c) => (
                    <option key={c.num} value={c.num}>
                      Ch. {c.num}: {c.range || ''} {c.desc.replace(/\s*\([^)]+\)\s*$/, '')}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <span className="text-slate-400 mr-1">Quick inspect:</span>
                {SAMPLE_CODES.slice(0, compact ? 4 : 7).map((sc) => (
                  <button
                    key={sc.code}
                    type="button"
                    onClick={() => openICD10Detail(sc.code)}
                    className="px-2 py-0.5 rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 font-mono text-[11px] transition"
                    title={sc.label}
                  >
                    {sc.code}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Search Results List */}
          {query.trim() && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-3 py-1.5 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600">
                <span>
                  {searching
                    ? 'Searching FY2027 ICD-10-CM tabular index...'
                    : `${icdResults.length} matching ICD-10-CM entries`}
                </span>
                <span className="text-[11px] text-slate-400">Click any code for full clinical rules</span>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                {icdResults.length === 0 && !searching ? (
                  <div className="p-4 text-center text-sm text-slate-500">
                    No ICD-10-CM matches found for &ldquo;{query}&rdquo;. Try broader clinical keywords or a 3-character category.
                  </div>
                ) : (
                  icdResults.map((item) => (
                    <div
                      key={item.normalizedCode}
                      className={`px-3 py-2 flex items-center justify-between gap-2 hover:bg-indigo-50/50 transition cursor-pointer ${
                        selectedIcd?.normalizedCode === item.normalizedCode ? 'bg-indigo-50/80' : ''
                      }`}
                      onClick={() => openICD10Detail(item.code)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-sm text-indigo-700">
                            {item.code}
                          </span>
                          {item.billable ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                              <CheckCircle2 className="w-3 h-3" />
                              Billable
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                              Non-Billable Header
                            </span>
                          )}
                          {item.sectionId && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              {item.sectionId}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-700 truncate mt-0.5">{item.description}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {item.billable && onAddDiagnosis && (
                          <button
                            type="button"
                            onClick={() => onAddDiagnosis(item.code, false)}
                            className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium flex items-center gap-1"
                            title="Add this billable ICD-10-CM code to claim"
                          >
                            <Plus className="w-3 h-3" /> Add
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openICD10Detail(item.code)}
                          className="p-1 text-slate-400 hover:text-indigo-600"
                          title="Inspect hierarchy & Excludes1 rules"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Full ICD10Data.com-Style Clinical Dossier */}
          {loadingDetail ? (
            <div className="p-6 text-center text-sm text-slate-500 border border-slate-200 rounded-lg">
              Loading official FY2027 ICD-10-CM tabular dossier...
            </div>
          ) : selectedIcd ? (
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
              {!selectedIcd.exists ? (
                <div className="p-4 bg-rose-50 border-b border-rose-200 flex items-start gap-3">
                  <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-rose-900 text-sm">
                      Invalid / Retired ICD-10-CM Code: {selectedIcd.code}
                    </h4>
                    <p className="text-xs text-rose-700 mt-1">
                      This code is not present in the official FY2027 CDC/NCHS ICD-10-CM release. Search above by clinical condition or 3-character prefix to select an active billable code.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Billable vs Non-Billable Banner */}
                  <div
                    className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3 ${
                      selectedIcd.billable
                        ? 'bg-emerald-50/90 border-emerald-200'
                        : 'bg-rose-50/90 border-rose-200'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {selectedIcd.billable ? (
                        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-lg font-bold text-slate-900">
                            {selectedIcd.code}
                          </span>
                          {selectedIcd.billable ? (
                            <Badge variant="success">
                              Billable / Specific FY2027 Code
                            </Badge>
                          ) : (
                            <Badge variant="danger">
                              Non-Billable Header Code — Do Not Bill
                            </Badge>
                          )}
                          {selectedIcd.clinicalAttributes.laterality !== 'none' && (
                            <Badge variant="info">
                              Laterality: {selectedIcd.clinicalAttributes.laterality}
                            </Badge>
                          )}
                          {selectedIcd.clinicalAttributes.isManifestation && (
                            <Badge variant="purple">Manifestation (Code First Required)</Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium text-slate-800 mt-1">
                          {selectedIcd.description}
                        </p>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                          {selectedIcd.billable
                            ? `Valid for HIPAA 837P / 837I / CMS-1500 submission (Effective ${selectedIcd.effectiveDate}).`
                            : selectedIcd.clinicalAttributes.requires7thChar
                              ? 'Invalid for claim submission: requires a 7th-character encounter/healing extension below.'
                              : `Invalid for claim submission: select one of the ${selectedIcd.billableDescendants.length} specific billable child codes below.`}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopy(selectedIcd.code)}
                      >
                        {copiedCode === selectedIcd.code ? (
                          <>
                            <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                          </>
                        )}
                      </Button>
                      {selectedIcd.billable && onAddDiagnosis && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => onAddDiagnosis(selectedIcd.code, false)}
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" /> Add Dx to Claim
                          </Button>
                          {!selectedIcd.clinicalAttributes.isManifestation && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => onAddDiagnosis(selectedIcd.code, true)}
                            >
                              Set Primary Dx #1
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Breadcrumb Hierarchy */}
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs flex flex-wrap items-center gap-1 text-slate-600">
                    {selectedIcd.chapter && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveChapterNum(selectedIcd.chapter!.num);
                            setSubTab('chapters');
                          }}
                          className="hover:text-indigo-700 hover:underline font-medium"
                        >
                          Ch. {selectedIcd.chapter.num} ({selectedIcd.chapter.range})
                        </button>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </>
                    )}
                    {selectedIcd.section && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedIcd.chapter) setActiveChapterNum(selectedIcd.chapter.num);
                            loadSectionCategories(selectedIcd.section!.id);
                            setSubTab('chapters');
                          }}
                          className="hover:text-indigo-700 hover:underline font-mono"
                        >
                          {selectedIcd.section.id}
                        </button>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </>
                    )}
                    {selectedIcd.ancestors.map((anc) => (
                      <React.Fragment key={anc.normalizedCode}>
                        <button
                          type="button"
                          onClick={() => openICD10Detail(anc.code)}
                          className="hover:text-indigo-700 hover:underline font-mono font-semibold text-slate-700"
                          title={anc.description}
                        >
                          {anc.code}
                        </button>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </React.Fragment>
                    ))}
                    <span className="font-mono font-bold text-indigo-700">{selectedIcd.code}</span>
                  </div>

                  <div className="p-4 space-y-4">
                    {/* 7th Character Extension Picker */}
                    {Object.keys(selectedIcd.notes.sevenChrDef).length > 0 && (
                      <div className="p-3 rounded-lg bg-indigo-50/70 border border-indigo-200">
                        <p className="text-xs font-semibold text-indigo-950 mb-2 flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-indigo-600" />
                          Official 7th-Character Extensions (Defined at {selectedIcd.notes.sevenChrSource})
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {Object.entries(selectedIcd.notes.sevenChrDef).map(([ext, label]) => {
                            const stem =
                              selectedIcd.normalizedCode.length === 7
                                ? selectedIcd.normalizedCode.slice(0, 6)
                                : selectedIcd.normalizedCode.padEnd(6, 'X');
                            const candidateCode = `${stem.slice(0, 3)}.${stem.slice(3)}${ext}`;
                            return (
                              <button
                                key={ext}
                                type="button"
                                onClick={() => openICD10Detail(candidateCode)}
                                className="text-left px-2.5 py-1.5 rounded bg-white hover:bg-indigo-100/70 border border-indigo-200/80 text-xs flex items-center justify-between gap-2 transition"
                              >
                                <span>
                                  <strong className="font-mono text-indigo-700 mr-1.5">{ext}</strong>
                                  <span className="text-slate-700">{label}</span>
                                </span>
                                <span className="font-mono text-[11px] text-indigo-600 shrink-0">
                                  {candidateCode} →
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Billable Child / Descendant Codes when viewing a Non-Billable Header */}
                    {!selectedIcd.billable && selectedIcd.billableDescendants.length > 0 && (
                      <div className="border border-emerald-200 rounded-lg overflow-hidden">
                        <div className="bg-emerald-50 px-3 py-2 border-b border-emerald-200 flex items-center justify-between">
                          <span className="text-xs font-semibold text-emerald-900 flex items-center gap-1.5">
                            <FileCheck2 className="w-3.5 h-3.5 text-emerald-700" />
                            Valid FY2027 Billable Codes Under {selectedIcd.code} ({selectedIcd.billableDescendants.length})
                          </span>
                          <span className="text-[11px] text-emerald-700">Select a specific billable code</span>
                        </div>
                        <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
                          {selectedIcd.billableDescendants.map((child) => (
                            <div
                              key={child.normalizedCode}
                              className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-emerald-50/40"
                            >
                              <button
                                type="button"
                                onClick={() => openICD10Detail(child.code)}
                                className="text-left min-w-0 flex-1"
                              >
                                <span className="font-mono font-bold text-xs text-emerald-800 mr-2">
                                  {child.code}
                                </span>
                                <span className="text-xs text-slate-700">{child.description}</span>
                              </button>
                              {onAddDiagnosis && (
                                <button
                                  type="button"
                                  onClick={() => onAddDiagnosis(child.code, false)}
                                  className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium shrink-0"
                                >
                                  + Use {child.code}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Direct Subcategories (if header has intermediate headers) */}
                    {selectedIcd.children.length > 0 && selectedIcd.billable && (
                      <div className="text-xs text-slate-500">
                        Leaf code (no further subcategories).
                      </div>
                    )}

                    {/* Specific Alternatives for Unspecified Codes */}
                    {selectedIcd.clinicalAttributes.isUnspecified &&
                      selectedIcd.clinicalAttributes.specificAlternatives.length > 0 && (
                        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                          <p className="text-xs font-semibold text-amber-900 mb-1.5 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                            Specific Laterality / Clinical Alternatives (Avoid Unspecified Denials)
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedIcd.clinicalAttributes.specificAlternatives.map((alt) => (
                              <button
                                key={alt.normalizedCode}
                                type="button"
                                onClick={() => openICD10Detail(alt.code)}
                                className="px-2.5 py-1 rounded-md bg-white hover:bg-amber-100 border border-amber-300 text-xs text-slate-800"
                              >
                                <strong className="font-mono text-amber-900">{alt.code}</strong>:{' '}
                                {alt.description}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                    {/* Official CDC/NCHS Instructional Notes */}
                    <div className="space-y-2.5">
                      {selectedIcd.notes.codeFirst.length > 0 && (
                        <NoteSection
                          title="Code First (Mandatory Underlying Etiology Sequencing)"
                          badgeColor="bg-purple-100 text-purple-900 border-purple-200"
                          boxColor="bg-purple-50/60 border-purple-200"
                          items={selectedIcd.notes.codeFirst}
                          onSelectCode={openICD10Detail}
                        />
                      )}

                      {selectedIcd.notes.excludes1.length > 0 && (
                        <NoteSection
                          title="Excludes1 — Mutually Exclusive (NEVER Report Together)"
                          badgeColor="bg-rose-100 text-rose-900 border-rose-200"
                          boxColor="bg-rose-50/60 border-rose-200"
                          items={selectedIcd.notes.excludes1}
                          onSelectCode={openICD10Detail}
                        />
                      )}

                      {selectedIcd.notes.excludes2.length > 0 && (
                        <NoteSection
                          title="Excludes2 — Not Included Here (May Code Together When Both Present)"
                          badgeColor="bg-amber-100 text-amber-900 border-amber-200"
                          boxColor="bg-amber-50/50 border-amber-200"
                          items={selectedIcd.notes.excludes2}
                          onSelectCode={openICD10Detail}
                        />
                      )}

                      {selectedIcd.notes.useAdditionalCode.length > 0 && (
                        <NoteSection
                          title="Use Additional Code / Code Also"
                          badgeColor="bg-sky-100 text-sky-900 border-sky-200"
                          boxColor="bg-sky-50/60 border-sky-200"
                          items={selectedIcd.notes.useAdditionalCode}
                          onSelectCode={openICD10Detail}
                        />
                      )}

                      {selectedIcd.notes.includes.length > 0 && (
                        <NoteSection
                          title="Clinical Includes &amp; Inclusion Terms"
                          badgeColor="bg-slate-200 text-slate-800 border-slate-300"
                          boxColor="bg-slate-50 border-slate-200"
                          items={selectedIcd.notes.includes}
                          onSelectCode={openICD10Detail}
                        />
                      )}
                    </div>

                    {/* Sibling Codes */}
                    {selectedIcd.siblings.length > 0 && (
                      <div className="pt-2 border-t border-slate-200">
                        <p className="text-xs font-semibold text-slate-600 mb-2">
                          Adjacent Sibling Codes ({selectedIcd.siblings.length})
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                          {selectedIcd.siblings.map((sib) => (
                            <button
                              key={sib.normalizedCode}
                              type="button"
                              onClick={() => openICD10Detail(sib.code)}
                              className="text-left px-2.5 py-1.5 rounded border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-xs flex items-center justify-between gap-2"
                            >
                              <span className="truncate">
                                <strong className="font-mono text-indigo-700 mr-1.5">
                                  {sib.code}
                                </strong>
                                <span className="text-slate-700">{sib.description}</span>
                              </span>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                                  sib.billable
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {sib.billable ? 'Billable' : 'Header'}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="p-6 rounded-xl bg-slate-50 border border-dashed border-slate-300 text-center space-y-2">
              <BookOpen className="w-7 h-7 text-indigo-500 mx-auto" />
              <p className="text-sm font-medium text-slate-800">
                Search any ICD-10-CM diagnosis code or clinical term above
              </p>
              <p className="text-xs text-slate-500 max-w-lg mx-auto">
                View instant FY2027 billability status, 7th-character extensions, Excludes1 conflict rules, Code First sequencing, and 1-click claim code insertion — completely ad-free inside BloomAR Manager.
              </p>
            </div>
          )}
        </div>
      )}

      {/* === SUBTAB 2: 22-CHAPTER TABULAR HIERARCHY BROWSER === */}
      {subTab === 'chapters' && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-5 border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700">
              22 Official CDC/NCHS Chapters
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {chapters.map((ch) => (
                <button
                  key={ch.num}
                  type="button"
                  onClick={() => {
                    setActiveChapterNum(ch.num);
                    setActiveSectionId(null);
                    setSectionCategories([]);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs transition flex items-center justify-between gap-2 ${
                    activeChapter?.num === ch.num
                      ? 'bg-indigo-50 text-indigo-900 font-semibold'
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <span className="truncate">
                    <span className="font-mono text-indigo-700 mr-1.5">Ch.{ch.num}</span>
                    {ch.desc}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {ch.sectionCount} blk
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="md:col-span-7 space-y-3">
            {activeChapter && (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-800">
                  Chapter {activeChapter.num}: {activeChapter.desc} — Code Blocks
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
                  {activeChapter.sections.map((sec) => (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => loadSectionCategories(sec.id)}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 ${
                        activeSectionId === sec.id
                          ? 'bg-indigo-50 text-indigo-900 font-semibold'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <span>
                        <strong className="font-mono text-indigo-700 mr-2">{sec.id}</strong>
                        {sec.desc}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeSectionId && (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-indigo-50/70 px-3 py-2 border-b border-indigo-200 text-xs font-semibold text-indigo-950">
                  3-Character Categories in {activeSectionId}
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                  {loadingSection ? (
                    <div className="p-3 text-xs text-slate-500">Loading categories...</div>
                  ) : sectionCategories.length === 0 ? (
                    <div className="p-3 text-xs text-slate-500">No categories found in section.</div>
                  ) : (
                    sectionCategories.map((cat) => (
                      <div
                        key={cat.normalizedCode}
                        className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50"
                      >
                        <button
                          type="button"
                          onClick={() => openICD10Detail(cat.code)}
                          className="text-left text-xs flex-1"
                        >
                          <strong className="font-mono text-indigo-700 mr-2">{cat.code}</strong>
                          <span className="text-slate-700">{cat.description}</span>
                        </button>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            cat.billable
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {cat.billable ? 'Billable 3-Char' : 'Drill Down →'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* === SUBTAB 3: CPT / HCPCS & BILLING MODIFIERS REFERENCE === */}
      {subTab === 'cpt' && (
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Search CPT, HCPCS, or Modifiers (e.g., "99214", "20610", "25", "59", "XS", "J3301", "colonoscopy")...'
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs">
              {(['all', 'cpt', 'hcpcs', 'modifiers'] as const).map((sc) => (
                <button
                  key={sc}
                  type="button"
                  onClick={() => setCptScope(sc)}
                  className={`px-2.5 py-1 rounded font-medium capitalize ${
                    cptScope === sc ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  {sc === 'all' ? 'All' : sc.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Procedures */}
          {cptScope !== 'modifiers' && procResults.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                CPT &amp; HCPCS Level II Procedures ({procResults.length})
              </h4>
              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {procResults.map((p) => (
                  <div
                    key={p.code}
                    className="p-3 rounded-lg border border-slate-200 hover:border-indigo-300 bg-white space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-sm text-indigo-700">
                            {p.code}
                          </span>
                          <Badge variant={p.codeSystem === 'CPT' ? 'info' : 'purple'}>
                            {p.codeSystem}
                          </Badge>
                          <span className="text-[11px] text-slate-500">
                            Global: <strong>{p.globalPeriod}</strong>
                          </span>
                          <span className="text-[11px] text-slate-500">{p.category}</span>
                        </div>
                        <p className="text-xs font-medium text-slate-800 mt-0.5">
                          {p.shortDescriptor}
                        </p>
                      </div>
                      {onAddProcedure && (
                        <button
                          type="button"
                          onClick={() => onAddProcedure(p.code)}
                          className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium shrink-0"
                        >
                          + Add {p.code}
                        </button>
                      )}
                    </div>
                    {p.commonModifiers.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 text-[11px]">
                        <span className="text-slate-500">Common modifiers:</span>
                        {p.commonModifiers.map((m) => (
                          <span
                            key={m}
                            className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-slate-700"
                          >
                            -{m}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.codingTips.map((tip, i) => (
                      <p key={i} className="text-[11px] text-amber-900 bg-amber-50/80 px-2 py-1 rounded">
                        • {tip}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Modifiers */}
          {(cptScope === 'all' || cptScope === 'modifiers') && modResults.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                CPT &amp; HCPCS Billing Modifiers ({modResults.length})
              </h4>
              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {modResults.map((m) => (
                  <div
                    key={m.code}
                    className="p-3 rounded-lg border border-slate-200 bg-slate-50/60 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm px-2 py-0.5 rounded bg-indigo-100 text-indigo-900">
                          -{m.code}
                        </span>
                        <span className="text-xs font-semibold text-slate-900">{m.title}</span>
                        <Badge variant="default">{m.category}</Badge>
                      </div>
                      {onAppendModifier && (
                        <button
                          type="button"
                          onClick={() => onAppendModifier(m.code)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-medium shrink-0"
                        >
                          + Append -{m.code}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-700">
                      <strong className="text-emerald-800">Use when:</strong> {m.whenToUse}
                    </p>
                    <p className="text-xs text-slate-600">
                      <strong className="text-rose-800">Avoid:</strong> {m.avoidWhen}
                    </p>
                    {m.commonDenialsFixed.length > 0 && (
                      <p className="text-[11px] text-slate-500">
                        Addresses denials:{' '}
                        <span className="font-mono font-medium text-slate-700">
                          {m.commonDenialsFixed.join(', ')}
                        </span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NoteSection({
  title,
  badgeColor,
  boxColor,
  items,
  onSelectCode,
}: {
  title: string;
  badgeColor: string;
  boxColor: string;
  items: ICD10NoteItem[];
  onSelectCode: (code: string) => void;
}) {
  return (
    <div className={`p-3 rounded-lg border ${boxColor}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${badgeColor}`}>
          {title}
        </span>
      </div>
      <ul className="space-y-1.5 text-xs text-slate-800">
        {items.map((item, idx) => (
          <li key={idx} className="flex flex-wrap items-baseline gap-1.5">
            <span className="font-mono text-[10px] text-slate-500">[{item.sourceCode}]</span>
            <span>{item.text}</span>
            {item.referencedCodes.map((rc) => (
              <button
                key={rc}
                type="button"
                onClick={() => onSelectCode(rc)}
                className="px-1.5 py-0.2 rounded bg-white border border-slate-300 hover:border-indigo-500 text-indigo-700 font-mono text-[11px] font-semibold"
              >
                {rc}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
