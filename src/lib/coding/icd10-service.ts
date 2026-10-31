import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

export interface ICD10Chapter {
  num: string;
  desc: string;
  range: string;
}

export interface ICD10Section {
  id: string;
  desc: string;
  ch: string;
}

export interface ICD10RawNoteBlock {
  in?: string[];
  x1?: string[];
  x2?: string[];
  cf?: string[];
  ua?: string[];
  s7?: Record<string, string>;
}

interface RawTabularMeta {
  source: string;
  chapters: Array<{ num: string; desc: string }>;
  sections: ICD10Section[];
  catSection: Record<string, string>;
  headers: Record<string, string>;
  notes: Record<string, ICD10RawNoteBlock>;
}

export interface ICD10CodeSummary {
  code: string;
  normalizedCode: string;
  description: string;
  billable: boolean;
}

export interface ICD10NoteItem {
  sourceCode: string;
  text: string;
  referencedCodes: string[];
}

export interface ICD10Detail {
  code: string;
  normalizedCode: string;
  exists: boolean;
  billable: boolean;
  fiscalYear: number;
  effectiveDate: string;
  description: string;
  chapter: ICD10Chapter | null;
  section: ICD10Section | null;
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

interface CachedICD10Store {
  billableMap: Record<string, string>;
  headersMap: Record<string, string>;
  allCodesSorted: string[];
  chapters: ICD10Chapter[];
  chapterByNum: Map<string, ICD10Chapter>;
  sections: ICD10Section[];
  sectionById: Map<string, ICD10Section>;
  sectionsByChapter: Map<string, ICD10Section[]>;
  catSection: Record<string, string>;
  categoriesBySection: Map<string, string[]>;
  notes: Record<string, ICD10RawNoteBlock>;
  billableCount: number;
  headerCount: number;
}

let cachedStore: CachedICD10Store | null = null;

export function normalizeICD10(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\./g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function formatICD10Code(raw: string): string {
  const norm = normalizeICD10(raw);
  if (norm.length <= 3) return norm;
  return `${norm.slice(0, 3)}.${norm.slice(3)}`;
}

function extractRangeFromDesc(desc: string): string {
  const m = desc.match(/\(([A-Z][0-9A-Z]{2}-[A-Z][0-9A-Z]{2})\)\s*$/);
  return m ? m[1] : '';
}

function loadBillableDataset(): Record<string, string> {
  try {
    const req = createRequire(/* turbopackIgnore: true */ import.meta.url);
    const pkgJson = req.resolve('@lowlysre/icd-10-cm/package.json');
    const resolvedPath = path.join(/* turbopackIgnore: true */ path.dirname(pkgJson), 'data', 'icd10.min.json');
    if (fs.existsSync(resolvedPath)) {
      return JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as Record<string, string>;
    }
  } catch {
    // Fallback to static subfolder path below
  }
  const staticPath = path.join(
    process.cwd(),
    'node_modules/@lowlysre/icd-10-cm/data/icd10.min.json'
  );
  return JSON.parse(fs.readFileSync(staticPath, 'utf-8')) as Record<string, string>;
}

function loadTabularMeta(): RawTabularMeta {
  const staticPath = path.join(
    process.cwd(),
    'src/lib/coding/data/icd10cm-tabular-meta.json.gz'
  );
  const gzBuf = fs.readFileSync(staticPath);
  return JSON.parse(zlib.gunzipSync(gzBuf).toString('utf-8')) as RawTabularMeta;
}

function getStore(): CachedICD10Store {
  if (cachedStore) return cachedStore;

  const billableMap = loadBillableDataset();
  const rawMeta = loadTabularMeta();

  const chapters: ICD10Chapter[] = rawMeta.chapters.map((c) => ({
    num: c.num,
    desc: c.desc,
    range: extractRangeFromDesc(c.desc),
  }));
  const chapterByNum = new Map(chapters.map((c) => [c.num, c]));
  const sectionById = new Map(rawMeta.sections.map((s) => [s.id, s]));
  const sectionsByChapter = new Map<string, ICD10Section[]>();
  for (const s of rawMeta.sections) {
    const arr = sectionsByChapter.get(s.ch) || [];
    arr.push(s);
    sectionsByChapter.set(s.ch, arr);
  }

  // Merge all keys for fast binary-search prefix scans
  const keySet = new Set<string>(Object.keys(billableMap));
  for (const h of Object.keys(rawMeta.headers)) {
    if (!billableMap[h]) keySet.add(h);
  }
  const allCodesSorted = Array.from(keySet).sort();

  const categoriesBySection = new Map<string, string[]>();
  for (const code of allCodesSorted) {
    if (code.length === 3) {
      const secId = rawMeta.catSection[code] || inferSectionForCategory(code, rawMeta.sections);
      if (secId) {
        rawMeta.catSection[code] = secId;
        const list = categoriesBySection.get(secId) || [];
        list.push(code);
        categoriesBySection.set(secId, list);
      }
    }
  }

  cachedStore = {
    billableMap,
    headersMap: rawMeta.headers,
    allCodesSorted,
    chapters,
    chapterByNum,
    sections: rawMeta.sections,
    sectionById,
    sectionsByChapter,
    catSection: rawMeta.catSection,
    categoriesBySection,
    notes: rawMeta.notes,
    billableCount: Object.keys(billableMap).length,
    headerCount: Object.keys(rawMeta.headers).length,
  };
  return cachedStore;
}

function inferSectionForCategory(cat3: string, sections: ICD10Section[]): string | null {
  for (const s of sections) {
    const parts = s.id.split('-');
    if (parts.length === 2 && cat3 >= parts[0] && cat3 <= parts[1]) {
      return s.id;
    }
  }
  return null;
}

function lowerBound(sorted: string[], prefix: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function getPrefixMatches(store: CachedICD10Store, normPrefix: string, maxItems = 300): string[] {
  if (!normPrefix) return [];
  const start = lowerBound(store.allCodesSorted, normPrefix);
  const out: string[] = [];
  for (let i = start; i < store.allCodesSorted.length && out.length < maxItems; i++) {
    const k = store.allCodesSorted[i];
    if (!k.startsWith(normPrefix)) break;
    out.push(k);
  }
  return out;
}

function getDescriptionFromStore(store: CachedICD10Store, norm: string): string | undefined {
  return store.billableMap[norm] ?? store.headersMap[norm];
}

function toSummary(store: CachedICD10Store, norm: string): ICD10CodeSummary {
  return {
    code: formatICD10Code(norm),
    normalizedCode: norm,
    description: getDescriptionFromStore(store, norm) || '',
    billable: Boolean(store.billableMap[norm]),
  };
}

export function extractReferencedICD10Codes(noteText: string): string[] {
  const matches = noteText.match(/\b[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4}|\.?-)?\b/g) || [];
  const cleaned = new Set<string>();
  for (const m of matches) {
    const trimmed = m.replace(/-$/, '').replace(/\.$/, '');
    if (trimmed.length >= 3) {
      cleaned.add(formatICD10Code(trimmed));
    }
  }
  return Array.from(cleaned);
}

function detectLaterality(desc: string): 'right' | 'left' | 'bilateral' | 'unspecified' | 'none' {
  const lower = desc.toLowerCase();
  if (/\bbilateral\b/.test(lower)) return 'bilateral';
  const hasRight = /\bright\b/.test(lower);
  const hasLeft = /\bleft\b/.test(lower);
  if (hasRight && hasLeft) return 'bilateral';
  if (hasRight) return 'right';
  if (hasLeft) return 'left';
  if (/\bunspecified\s+(eye|ear|side|limb|arm|leg|knee|hip|shoulder|ankle|wrist|hand|foot|breast|ovary|kidney|lung)\b/.test(lower)) {
    return 'unspecified';
  }
  return 'none';
}

function detectEncounterType(norm: string, desc: string): 'initial' | 'subsequent' | 'sequela' | null {
  const lower = desc.toLowerCase();
  if (/\binitial encounter\b/.test(lower)) return 'initial';
  if (/\bsubsequent encounter\b/.test(lower)) return 'subsequent';
  if (/\bsequela\b/.test(lower)) return 'sequela';
  if (norm.length === 7 && /^[STVWXY]/.test(norm)) {
    const ch7 = norm[6];
    if (ch7 === 'A' || ch7 === 'B' || ch7 === 'C') return 'initial';
    if (ch7 === 'S') return 'sequela';
    if ('DGKMNPR'.includes(ch7)) return 'subsequent';
  }
  return null;
}

export function getICD10ReleaseMetadata() {
  const store = getStore();
  return {
    fiscalYear: 2027,
    effectiveDate: '2026-10-01',
    source: 'CDC / NCHS Official ICD-10-CM FY2027 Tabular Release',
    billableCodeCount: store.billableCount,
    headerCodeCount: store.headerCount,
    totalEntries: store.allCodesSorted.length,
    chapterCount: store.chapters.length,
    sectionCount: store.sections.length,
  };
}

export function getICD10Detail(rawCode: string): ICD10Detail {
  const store = getStore();
  const norm = normalizeICD10(rawCode);
  const formatted = formatICD10Code(norm);
  const billableDesc = store.billableMap[norm];
  const headerDesc = store.headersMap[norm];
  const exists = Boolean(billableDesc || headerDesc);
  const billable = Boolean(billableDesc);
  const description = billableDesc || headerDesc || '';

  const cat3 = norm.slice(0, 3);
  const secId = cat3.length === 3 ? store.catSection[cat3] || inferSectionForCategory(cat3, store.sections) : null;
  const section = secId ? store.sectionById.get(secId) || null : null;
  const chapter = section ? store.chapterByNum.get(section.ch) || null : null;

  // Ancestors (3..norm.length-1)
  const ancestors: ICD10CodeSummary[] = [];
  for (let len = 3; len < norm.length; len++) {
    const anc = norm.slice(0, len);
    if (getDescriptionFromStore(store, anc)) {
      ancestors.push(toSummary(store, anc));
    }
  }

  // Children & billable descendants
  const descendants = exists ? getPrefixMatches(store, norm, 250).filter((c) => c !== norm) : [];
  const children: ICD10CodeSummary[] = [];
  const seenChildPrefix = new Set<string>();
  for (const d of descendants) {
    // Immediate child is norm.length + 1 (or X-extended 7th char child)
    if (d.length === norm.length + 1) {
      children.push(toSummary(store, d));
      seenChildPrefix.add(d);
    } else if (d.length > norm.length + 1) {
      const nextStep = d.slice(0, norm.length + 1);
      if (!seenChildPrefix.has(nextStep) && getDescriptionFromStore(store, nextStep)) {
        children.push(toSummary(store, nextStep));
        seenChildPrefix.add(nextStep);
      }
    }
    if (children.length >= 60) break;
  }

  const billableDescendants = descendants
    .filter((d) => Boolean(store.billableMap[d]))
    .slice(0, 40)
    .map((d) => toSummary(store, d));

  // Siblings under immediate parent (if norm.length >= 4)
  const siblings: ICD10CodeSummary[] = [];
  if (norm.length >= 4) {
    const parent = norm.slice(0, norm.length - 1);
    const sibMatches = getPrefixMatches(store, parent, 80);
    for (const s of sibMatches) {
      if (s.length === norm.length && s !== norm) {
        siblings.push(toSummary(store, s));
      }
      if (siblings.length >= 25) break;
    }
  }

  // Aggregate inherited + self notes from cat3 down to norm
  const includes: ICD10NoteItem[] = [];
  const excludes1: ICD10NoteItem[] = [];
  const excludes2: ICD10NoteItem[] = [];
  const codeFirst: ICD10NoteItem[] = [];
  const useAdditionalCode: ICD10NoteItem[] = [];
  let sevenChrDef: Record<string, string> = {};
  let sevenChrSource: string | null = null;

  for (let len = 3; len <= norm.length; len++) {
    const p = norm.slice(0, len);
    const nb = store.notes[p];
    if (!nb) continue;
    const srcFormatted = formatICD10Code(p);
    for (const t of nb.in || []) {
      includes.push({ sourceCode: srcFormatted, text: t, referencedCodes: extractReferencedICD10Codes(t) });
    }
    for (const t of nb.x1 || []) {
      excludes1.push({ sourceCode: srcFormatted, text: t, referencedCodes: extractReferencedICD10Codes(t) });
    }
    for (const t of nb.x2 || []) {
      excludes2.push({ sourceCode: srcFormatted, text: t, referencedCodes: extractReferencedICD10Codes(t) });
    }
    for (const t of nb.cf || []) {
      codeFirst.push({ sourceCode: srcFormatted, text: t, referencedCodes: extractReferencedICD10Codes(t) });
    }
    for (const t of nb.ua || []) {
      useAdditionalCode.push({
        sourceCode: srcFormatted,
        text: t,
        referencedCodes: extractReferencedICD10Codes(t),
      });
    }
    if (nb.s7 && Object.keys(nb.s7).length > 0) {
      sevenChrDef = { ...sevenChrDef, ...nb.s7 };
      sevenChrSource = srcFormatted;
    }
  }

  const isUnspecified = /\bunspecified\b/i.test(description);
  const isManifestation =
    codeFirst.length > 0 || /\bin diseases classified elsewhere\b/i.test(description);
  const requires7thChar =
    !billable &&
    exists &&
    (Object.keys(sevenChrDef).length > 0 ||
      billableDescendants.some((d) => d.normalizedCode.length === 7));

  const specificAlternatives = isUnspecified
    ? siblings.filter((s) => s.billable && !/\bunspecified\b/i.test(s.description)).slice(0, 8)
    : [];

  return {
    code: formatted,
    normalizedCode: norm,
    exists,
    billable,
    fiscalYear: 2027,
    effectiveDate: '2026-10-01',
    description,
    chapter,
    section,
    ancestors,
    children,
    billableDescendants,
    siblings,
    notes: {
      includes,
      excludes1,
      excludes2,
      codeFirst,
      useAdditionalCode,
      sevenChrDef,
      sevenChrSource,
    },
    clinicalAttributes: {
      laterality: detectLaterality(description),
      isUnspecified,
      isManifestation,
      requires7thChar,
      encounterType: detectEncounterType(norm, description),
      specificAlternatives,
    },
  };
}

export interface SearchICD10Options {
  billableOnly?: boolean;
  chapter?: string;
  limit?: number;
}

export interface SearchICD10Result {
  code: string;
  normalizedCode: string;
  description: string;
  billable: boolean;
  chapterNum: string | null;
  sectionId: string | null;
  laterality: 'right' | 'left' | 'bilateral' | 'unspecified' | 'none';
}

export function searchICD10(query: string, opts: SearchICD10Options = {}): SearchICD10Result[] {
  const store = getStore();
  const raw = String(query || '').trim();
  const limit = Math.min(100, Math.max(1, opts.limit ?? 35));
  if (!raw) return [];

  const normQuery = normalizeICD10(raw);
  const looksLikeCode = /^[A-TV-Z][0-9]/i.test(normQuery) && !/\s/.test(raw.trim());
  const lowerTokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const scored: Array<{ norm: string; score: number }> = [];

  // Fast exact / prefix code check first
  if (looksLikeCode) {
    const prefixHits = getPrefixMatches(store, normQuery, 200);
    for (const norm of prefixHits) {
      if (opts.billableOnly && !store.billableMap[norm]) continue;
      if (opts.chapter) {
        const secId = store.catSection[norm.slice(0, 3)];
        const sec = secId ? store.sectionById.get(secId) : null;
        if (sec?.ch !== opts.chapter) continue;
      }
      let score = 1000 - (norm.length - normQuery.length) * 15;
      if (norm === normQuery) score += 500;
      if (store.billableMap[norm]) score += 25;
      scored.push({ norm, score });
    }
  }

  // Keyword scan across descriptions when needed
  if (scored.length < limit && lowerTokens.length > 0) {
    const seen = new Set(scored.map((s) => s.norm));
    const phrase = raw.toLowerCase().trim();

    for (const norm of store.allCodesSorted) {
      if (seen.has(norm)) continue;
      const isBillable = Boolean(store.billableMap[norm]);
      if (opts.billableOnly && !isBillable) continue;

      if (opts.chapter) {
        const secId = store.catSection[norm.slice(0, 3)];
        const sec = secId ? store.sectionById.get(secId) : null;
        if (sec?.ch !== opts.chapter) continue;
      }

      const desc = (store.billableMap[norm] || store.headersMap[norm] || '').toLowerCase();
      if (!desc) continue;

      let matchedAll = true;
      for (let i = 0; i < lowerTokens.length; i++) {
        const tok = lowerTokens[i];
        if (!desc.includes(tok) && !norm.toLowerCase().includes(tok.replace('.', ''))) {
          matchedAll = false;
          break;
        }
      }
      if (!matchedAll) continue;

      let score = 200;
      if (desc.startsWith(phrase)) score += 160;
      else if (desc.includes(phrase)) score += 90;
      if (isBillable) score += 45;
      if (!desc.includes('unspecified')) score += 12;
      else if (phrase.includes('unspecified')) score += 30;
      score -= Math.max(0, desc.length - 40) * 0.25;

      scored.push({ norm, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.norm.localeCompare(b.norm));

  return scored.slice(0, limit).map(({ norm }) => {
    const desc = getDescriptionFromStore(store, norm) || '';
    const secId = store.catSection[norm.slice(0, 3)] || null;
    const sec = secId ? store.sectionById.get(secId) : null;
    return {
      code: formatICD10Code(norm),
      normalizedCode: norm,
      description: desc,
      billable: Boolean(store.billableMap[norm]),
      chapterNum: sec?.ch || null,
      sectionId: secId,
      laterality: detectLaterality(desc),
    };
  });
}

export function suggestSimilarICD10(rawCode: string, limit = 6): ICD10CodeSummary[] {
  const store = getStore();
  const norm = normalizeICD10(rawCode);
  if (!norm) return [];
  for (let len = Math.min(norm.length, 6); len >= 3; len--) {
    const prefix = norm.slice(0, len);
    const hits = getPrefixMatches(store, prefix, 40).filter((c) => Boolean(store.billableMap[c]));
    if (hits.length > 0) {
      return hits.slice(0, limit).map((c) => toSummary(store, c));
    }
  }
  return [];
}

export function getICD10Chapters() {
  const store = getStore();
  return store.chapters.map((ch) => ({
    ...ch,
    sectionCount: (store.sectionsByChapter.get(ch.num) || []).length,
    sections: store.sectionsByChapter.get(ch.num) || [],
  }));
}

export function getICD10SectionCategories(sectionId: string): ICD10CodeSummary[] {
  const store = getStore();
  const cats = store.categoriesBySection.get(sectionId.toUpperCase()) || [];
  return cats.map((c) => toSummary(store, c));
}
