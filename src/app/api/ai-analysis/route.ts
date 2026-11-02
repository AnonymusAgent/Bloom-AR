import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { denialAnalyses, claims, denialCodes, claimNotes, claimStatusHistory } from '@/db/schema';
import { eq, desc, sql, and, or, isNull } from 'drizzle-orm';
import { createAuditLog } from '@/lib/audit';
import { analyzeDenial, isDeniedClaim, toRecommendedActions } from '@/lib/denial-analysis';
import { requireTenantContext } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantContext();
    if (!auth.ok) return auth.response;
    const { organizationId } = auth.ctx;

    const pageRaw = parseInt(request.nextUrl.searchParams.get('page') || '1');
    const limitRaw = parseInt(request.nextUrl.searchParams.get('limit') || '20');
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;
    const claimId = request.nextUrl.searchParams.get('claimId');
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (claimId && !UUID_RE.test(claimId)) {
      return NextResponse.json({ error: 'Invalid claim ID' }, { status: 400 });
    }

    const conditions = [eq(denialAnalyses.organizationId, organizationId)];
    if (claimId) conditions.push(eq(denialAnalyses.claimId, claimId));

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(denialAnalyses)
      .where(whereClause);

    const rows = await db
      .select({
        id: denialAnalyses.id,
        claimId: denialAnalyses.claimId,
        denialCode: denialAnalyses.denialCode,
        likelyReason: denialAnalyses.likelyReason,
        recommendedActions: denialAnalyses.recommendedActions,
        recoveryPotential: denialAnalyses.recoveryPotential,
        priorityScore: denialAnalyses.priorityScore,
        confidenceScore: denialAnalyses.confidenceScore,
        status: denialAnalyses.status,
        analysisResult: denialAnalyses.analysisResult,
        outcome: denialAnalyses.outcome,
        createdAt: denialAnalyses.createdAt,
        claimNumber: claims.claimNumber,
        patientName: claims.patientName,
        balance: claims.balance,
      })
      .from(denialAnalyses)
      .leftJoin(claims, eq(denialAnalyses.claimId, claims.id))
      .where(whereClause)
      .orderBy(desc(denialAnalyses.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return NextResponse.json({
      analyses: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    console.error('Get analyses error:', error);
    return NextResponse.json({ error: 'Failed to retrieve analyses' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    const body = await request.json().catch(() => null);
    const claimId = body?.claimId;
    if (!claimId) return NextResponse.json({ error: 'Claim ID is required' }, { status: 400 });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(claimId))) {
      return NextResponse.json({ error: 'Invalid claim ID' }, { status: 400 });
    }

    const [claim] = await db
      .select()
      .from(claims)
      .where(and(eq(claims.id, claimId), eq(claims.organizationId, organizationId)))
      .limit(1);
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    if (!isDeniedClaim(claim as Record<string, unknown>)) {
      return NextResponse.json(
        {
          error:
            'This claim is not denied. AI Denial Analysis is only available for denied claims.',
          claimStatus: claim.status,
        },
        { status: 400 }
      );
    }

    let denialCodeData: {
      code: string;
      codeType: string;
      description: string;
      category: string | null;
    } | null = null;
    if (claim.denialCodeId) {
      const [dc] = await db
        .select()
        .from(denialCodes)
        .where(
          and(
            eq(denialCodes.id, claim.denialCodeId),
            or(isNull(denialCodes.organizationId), eq(denialCodes.organizationId, organizationId))
          )
        )
        .limit(1);
      if (dc) {
        denialCodeData = {
          code: dc.code,
          codeType: dc.codeType,
          description: dc.description,
          category: dc.category,
        };
      }
    }

    const history = await db
      .select({ reason: claimStatusHistory.reason })
      .from(claimStatusHistory)
      .where(eq(claimStatusHistory.claimId, claimId))
      .orderBy(desc(claimStatusHistory.createdAt))
      .limit(10);

    const notes = await db
      .select({ note: claimNotes.note })
      .from(claimNotes)
      .where(eq(claimNotes.claimId, claimId))
      .orderBy(desc(claimNotes.createdAt))
      .limit(10);

    // Tenant-scoped historical outcomes only
    const denialCodeStr = denialCodeData?.code || '';
    const historicalOutcomes = denialCodeStr
      ? await db
          .select({ outcome: denialAnalyses.outcome, actionTaken: denialAnalyses.actionTaken })
          .from(denialAnalyses)
          .where(
            and(
              eq(denialAnalyses.organizationId, organizationId),
              eq(denialAnalyses.denialCode, denialCodeStr),
              eq(denialAnalyses.status, 'resolved')
            )
          )
          .limit(50)
      : [];

    const analysis = analyzeDenial(
      claim as Record<string, unknown>,
      denialCodeData,
      history,
      notes,
      historicalOutcomes
    );

    const [saved] = await db
      .insert(denialAnalyses)
      .values({
        organizationId,
        claimId,
        denialCodeId: claim.denialCodeId,
        denialCode: denialCodeData
          ? `${denialCodeData.codeType}-${denialCodeData.code}`
          : claim.denialReason?.substring(0, 20) || 'unknown',
        analysisResult: analysis,
        likelyReason: analysis.denialReason,
        recommendedActions: toRecommendedActions(
          analysis.nextSteps,
          analysis.historicalSuccessRate
        ),
        recoveryPotential: analysis.recoveryPotential,
        priorityScore: analysis.priorityScore,
        confidenceScore: String(
          analysis.confidence === 'High' ? 90 : analysis.confidence === 'Medium' ? 60 : 30
        ),
        historicalMatchCount: analysis.historicalMatchCount,
        status: 'analyzed',
        analyzedBy: user.id,
      })
      .returning();

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: 'denial_analyzed',
      entityType: 'denialAnalysis',
      entityId: saved.id,
      newValue: {
        claimId,
        denialCategory: analysis.denialCategory,
        severity: analysis.severity,
        recoveryPotential: analysis.recoveryPotential,
      },
    });

    return NextResponse.json({
      analysis: {
        id: saved.id,
        ...analysis,
        claimNumber: claim.claimNumber,
        patientName: claim.patientName,
        balance: claim.balance,
      },
    });
  } catch (error) {
    console.error('Analyze denial error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze denial. Please try again.' },
      { status: 500 }
    );
  }
}

const OUTCOMES = [
  'recovered',
  'paid',
  'partially_recovered',
  'written_off',
  'no_recovery',
] as const;

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const { user, organizationId } = ctx;

    const body = await request.json().catch(() => null);
    const { id, outcome, actionTaken } = body || {};
    if (
      !id ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))
    ) {
      return NextResponse.json({ error: 'Valid analysis ID is required' }, { status: 400 });
    }
    if (!OUTCOMES.includes(outcome)) {
      return NextResponse.json(
        { error: `Outcome must be one of: ${OUTCOMES.join(', ')}` },
        { status: 400 }
      );
    }
    const [existing] = await db
      .select()
      .from(denialAnalyses)
      .where(
        and(eq(denialAnalyses.id, id), eq(denialAnalyses.organizationId, organizationId))
      )
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });

    const [updated] = await db
      .update(denialAnalyses)
      .set({
        outcome,
        status: 'resolved',
        actionTaken: actionTaken ? String(actionTaken).slice(0, 2000) : existing.actionTaken,
        updatedAt: new Date(),
      })
      .where(
        and(eq(denialAnalyses.id, id), eq(denialAnalyses.organizationId, organizationId))
      )
      .returning();

    await createAuditLog({
      organizationId,
      userId: user.id,
      actorRole: ctx.orgRole,
      action: 'denial_outcome_recorded',
      entityType: 'denialAnalysis',
      entityId: id,
      newValue: { outcome, claimId: existing.claimId, denialCode: existing.denialCode },
    });

    return NextResponse.json({ analysis: updated });
  } catch (error) {
    console.error('Record outcome error:', error);
    return NextResponse.json({ error: 'Failed to record outcome' }, { status: 500 });
  }
}
