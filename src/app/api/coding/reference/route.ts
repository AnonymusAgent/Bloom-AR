import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getICD10Chapters,
  getICD10Detail,
  getICD10ReleaseMetadata,
  getICD10SectionCategories,
  searchICD10,
} from '@/lib/coding/icd10-service';
import {
  getModifierInfo,
  getProcedureInfo,
  MODIFIER_REFERENCE,
  PROCEDURE_REFERENCE,
  searchProceduresAndModifiers,
} from '@/lib/coding/cpt-hcpcs-reference';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sp = request.nextUrl.searchParams;
    const mode = sp.get('mode') || 'search';

    if (mode === 'meta') {
      return NextResponse.json({
        release: getICD10ReleaseMetadata(),
        chapters: getICD10Chapters(),
        featuredProcedures: PROCEDURE_REFERENCE.slice(0, 24),
        modifiers: MODIFIER_REFERENCE,
      });
    }

    if (mode === 'icd10') {
      const code = sp.get('code') || '';
      if (!code.trim()) {
        return NextResponse.json({ error: 'Code parameter is required' }, { status: 400 });
      }
      const detail = getICD10Detail(code);
      return NextResponse.json({ detail });
    }

    if (mode === 'section') {
      const sectionId = sp.get('sectionId') || '';
      if (!sectionId.trim()) {
        return NextResponse.json({ error: 'sectionId parameter is required' }, { status: 400 });
      }
      const categories = getICD10SectionCategories(sectionId);
      return NextResponse.json({ sectionId: sectionId.toUpperCase(), categories });
    }

    if (mode === 'procedure') {
      const code = sp.get('code') || '';
      return NextResponse.json({ procedure: getProcedureInfo(code) });
    }

    if (mode === 'modifier') {
      const code = sp.get('code') || '';
      return NextResponse.json({ modifier: getModifierInfo(code) });
    }

    // Default: unified search across ICD-10-CM, CPT, HCPCS, and Modifiers
    const q = sp.get('q') || '';
    const scope = (sp.get('scope') || 'all') as 'all' | 'icd10' | 'cpt' | 'hcpcs' | 'modifiers';
    const billableOnly = sp.get('billableOnly') === 'true';
    const chapter = sp.get('chapter') || undefined;
    const limit = Math.min(80, Math.max(5, parseInt(sp.get('limit') || '35', 10) || 35));

    const icd10Results =
      scope === 'all' || scope === 'icd10'
        ? searchICD10(q, { billableOnly, chapter, limit })
        : [];

    const procModResults =
      scope === 'icd10'
        ? { procedures: [], modifiers: [] }
        : searchProceduresAndModifiers(
            q,
            scope === 'all' ? 'all' : scope
          );

    return NextResponse.json({
      query: q,
      icd10: icd10Results,
      procedures: procModResults.procedures.slice(0, limit),
      modifiers: procModResults.modifiers.slice(0, limit),
    });
  } catch (error) {
    console.error('Coding reference API error:', error);
    return NextResponse.json({ error: 'Failed to query coding reference' }, { status: 500 });
  }
}
