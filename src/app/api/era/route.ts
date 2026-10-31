import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { eraFiles, eraTransactions, claims, payments, paymentAllocations } from '@/db/schema';
import { eq, desc, sql, ilike } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { parseEraFile } from '@/lib/era-parser';
import { cleanPage, cleanLimit } from '@/lib/sanitize';
import { createHash } from 'crypto';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || !isSupervisorOrAbove(user.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const page = cleanPage(request.nextUrl.searchParams.get('page'));
    const limit = cleanLimit(request.nextUrl.searchParams.get('limit'), 20, 100);

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(eraFiles);
    const rows = await db.select().from(eraFiles).orderBy(desc(eraFiles.createdAt)).limit(limit).offset((page - 1) * limit);

    return NextResponse.json({ eraFiles: rows, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } });
  } catch (error) {
    console.error('Get ERA files error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || !isSupervisorOrAbove(user.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'File required' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const content = buffer.toString('utf-8');
    const fileHash = createHash('sha256').update(content).digest('hex');

    // Duplicate ERA protection
    const [existing] = await db.select({ id: eraFiles.id }).from(eraFiles).where(eq(eraFiles.fileHash, fileHash)).limit(1);
    if (existing) return NextResponse.json({ error: 'This ERA file has already been processed. Duplicate upload prevented.' }, { status: 400 });

    // Parse ERA
    let parsed;
    try {
      parsed = parseEraFile(content, file.name);
    } catch (parseError) {
      return NextResponse.json({ error: `ERA parsing failed: ${parseError instanceof Error ? parseError.message : 'Invalid format'}` }, { status: 400 });
    }

    if (parsed.transactions.length === 0) return NextResponse.json({ error: 'ERA file contains no transactions' }, { status: 400 });

    // Save ERA file
    const [eraFile] = await db.insert(eraFiles).values({
      fileName: file.name, fileHash, fileData: buffer.toString('base64'),
      payerName: parsed.payerName, paymentDate: parsed.paymentDate || null,
      checkNumber: parsed.checkNumber, totalPayment: String(parsed.totalPayment),
      totalClaims: parsed.transactions.length, status: 'parsed', uploadedBy: user.id,
    }).returning();

    // Match transactions to claims
    let matched = 0, unmatched = 0;

    for (const tx of parsed.transactions) {
      let matchedClaimId: string | null = null;
      let matchStatus = 'unmatched';

      // Try to match by claim number
      if (tx.claimNumber) {
        const [claim] = await db.select({ id: claims.id }).from(claims).where(ilike(claims.claimNumber, `%${tx.claimNumber}%`)).limit(1);
        if (claim) { matchedClaimId = claim.id; matchStatus = 'matched'; matched++; }
        else { unmatched++; }
      } else { unmatched++; }

      await db.insert(eraTransactions).values({
        eraFileId: eraFile.id, claimId: matchedClaimId, claimNumber: tx.claimNumber,
        patientName: tx.patientName, dateOfService: tx.dateOfService || null, cptCode: tx.cptCode,
        billedAmount: String(tx.billedAmount), allowedAmount: String(tx.allowedAmount),
        paidAmount: String(tx.paidAmount), contractualAdjustment: String(tx.contractualAdjustment),
        patientResponsibility: String(tx.patientResponsibility), otherAdjustment: String(tx.otherAdjustment),
        carcCode: tx.carcCode, rarcCode: tx.rarcCode, remarkText: tx.remarkText,
        matchStatus, postStatus: 'pending',
      });
    }

    // Update ERA file counts
    await db.update(eraFiles).set({ matchedClaims: matched, unmatchedClaims: unmatched, status: 'parsed' }).where(eq(eraFiles.id, eraFile.id));

    await createAuditLog({ userId: user.id, action: 'era_uploaded', entityType: 'eraFile', entityId: eraFile.id, newValue: { fileName: file.name, totalClaims: parsed.transactions.length, matched, unmatched } });

    return NextResponse.json({
      eraFile: { id: eraFile.id, fileName: file.name, payerName: parsed.payerName, checkNumber: parsed.checkNumber, totalPayment: parsed.totalPayment, totalClaims: parsed.transactions.length, matched, unmatched },
    });
  } catch (error) {
    console.error('ERA upload error:', error);
    return NextResponse.json({ error: 'Failed to process ERA file' }, { status: 500 });
  }
}
