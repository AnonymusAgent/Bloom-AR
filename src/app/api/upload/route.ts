import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { uploadedFiles, claims, practices, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser, canUploadFiles, canAssignClaims } from '@/lib/auth';
import { canAccessPractice } from '@/lib/rbac';
import { createAuditLog, AUDIT_ACTIONS } from '@/lib/audit';
import { parseWorkbookWithMapping } from '@/lib/file-parser';
import { createNotification } from '@/lib/notifications';
import { ensureSaaSColumns } from '@/lib/db-schema';

const BATCH_SIZE = 100; // Safe batch size for PostgreSQL parameters

export async function POST(request: NextRequest) {
  try {
    await ensureSaaSColumns();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (!canUploadFiles(user.role)) {
      return NextResponse.json(
        {
          error:
            'You do not have permission to upload AR files. Required role: Administrator, Supervisor, Manager, or Senior Lead.',
        },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const practiceId = ((formData.get('practiceId') as string) || '').trim();
    const provider = ((formData.get('provider') as string) || '').trim();
    const assignedTo = ((formData.get('assignedTo') as string) || '').trim();
    const sheetName = (formData.get('sheetName') as string) || '';
    const headerRowIndexStr = formData.get('headerRowIndex') as string | null;
    const headerRowIndex = headerRowIndexStr ? parseInt(headerRowIndexStr, 10) : 0;
    const mappingRaw = formData.get('columnMapping') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided for upload.' }, { status: 400 });
    }

    // Require practice unless admin
    if (!practiceId && user.role !== 'administrator') {
      return NextResponse.json(
        { error: 'Practice selection is required for importing AR claims.' },
        { status: 400 }
      );
    }

    // Validate practice exists and user has access if provided
    let selectedPracticeRecord: { id: string; name: string; code: string } | null = null;
    if (practiceId) {
      const [practice] = await db
        .select({ id: practices.id, name: practices.name, code: practices.code })
        .from(practices)
        .where(eq(practices.id, practiceId))
        .limit(1);

      if (!practice) {
        return NextResponse.json(
          { error: 'The selected practice could not be found.' },
          { status: 400 }
        );
      }

      const hasAccess = await canAccessPractice(user, practiceId);
      if (!hasAccess) {
        return NextResponse.json(
          { error: 'You do not have permission to import claims for this practice.' },
          { status: 403 }
        );
      }
      selectedPracticeRecord = practice;
    }

    // Validate assigned user if provided
    if (assignedTo) {
      if (!canAssignClaims(user.role)) {
        return NextResponse.json(
          { error: 'Your role does not have permission to assign claims to other users.' },
          { status: 403 }
        );
      }

      const [assignedUserRecord] = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, assignedTo))
        .limit(1);

      if (!assignedUserRecord) {
        return NextResponse.json(
          { error: 'The selected assignee could not be found in active users.' },
          { status: 400 }
        );
      }
    }

    const fileName = file.name;
    const fileType = fileName.split('.').pop()?.toLowerCase() || '';
    const fileSize = file.size;

    if (!['xlsx', 'xls', 'csv'].includes(fileType)) {
      return NextResponse.json(
        { error: 'Invalid file type. Supported formats: .xlsx, .xls, .csv' },
        { status: 400 }
      );
    }

    let columnMapping: Record<string, string> = {};
    if (mappingRaw) {
      try {
        columnMapping = JSON.parse(mappingRaw);
      } catch {
        columnMapping = {};
      }
    }

    // Create initial upload record in database
    const [uploadRecord] = await db
      .insert(uploadedFiles)
      .values({
        fileName,
        fileType,
        fileSize,
        uploadedBy: user.id,
        status: 'processing',
      })
      .returning();

    try {
      const buffer = Buffer.from(await file.arrayBuffer());

      // Parse with mappings
      let parseResult: ReturnType<typeof parseWorkbookWithMapping>;
      try {
        parseResult = parseWorkbookWithMapping(buffer, {
          sheetName: sheetName || undefined,
          headerRowIndex,
          columnMapping,
        });
      } catch (parseError: any) {
        await db
          .update(uploadedFiles)
          .set({
            status: 'error',
            errorMessage: parseError.message || 'File parsing failed.',
          })
          .where(eq(uploadedFiles.id, uploadRecord.id));

        return NextResponse.json(
          {
            error:
              parseError.message ||
              'This Excel file could not be parsed. Please check that the file is not corrupted.',
          },
          { status: 400 }
        );
      }

      const { records, stats, warnings } = parseResult;

      if (records.length === 0) {
        await db
          .update(uploadedFiles)
          .set({
            status: 'error',
            errorMessage: 'No valid claim records identified in worksheet.',
          })
          .where(eq(uploadedFiles.id, uploadRecord.id));

        return NextResponse.json(
          {
            error:
              'No valid claim records could be extracted from the file. Please review your column mappings to ensure Claim Number, Patient Name, or Billed Amount are correctly mapped.',
          },
          { status: 400 }
        );
      }

      const initialStatus = assignedTo ? ('assigned' as const) : ('new' as const);
      const now = new Date();

      // Prepare claim records for database insertion
      const claimsToInsert = records.map((data) => ({
        claimNumber: data.claimNumber!,
        accountNumber: data.accountNumber || null,
        patientName: data.patientName || null,
        dateOfService: data.dateOfService || null,
        cptCodes: data.cptCodes || null,
        diagnosisCode: data.diagnosisCode || null,
        location: data.location || null,
        provider: provider || data.provider || null,
        insurance: data.insurance || null,
        payer: data.payer || null,
        billedAmount: data.billedAmount || '0.00',
        paidAmount: data.paidAmount || '0.00',
        balance: data.balance || data.billedAmount || '0.00',
        status: initialStatus,
        workflowStatus: 'unworked',
        practiceId: practiceId || null,
        uploadedFileId: uploadRecord.id,
        assignedTo: assignedTo || null,
        assignedBy: assignedTo ? user.id : null,
        assignedAt: assignedTo ? now : null,
        additionalData: data.additionalData || null,
      }));

      // Insert in chunks to guarantee safety with large files
      let insertedCount = 0;
      for (let i = 0; i < claimsToInsert.length; i += BATCH_SIZE) {
        const batch = claimsToInsert.slice(i, i + BATCH_SIZE);
        await db.insert(claims).values(batch);
        insertedCount += batch.length;
      }

      // Update upload record as completed
      await db
        .update(uploadedFiles)
        .set({
          status: 'completed',
          totalRecords: stats.totalRows,
          processedRecords: insertedCount,
        })
        .where(eq(uploadedFiles.id, uploadRecord.id));

      // Notify assigned user if assigned
      if (assignedTo) {
        const practiceSuffix = selectedPracticeRecord
          ? ` for ${selectedPracticeRecord.code} — ${selectedPracticeRecord.name}`
          : '';
        await createNotification({
          userId: assignedTo,
          type: 'new_assignment',
          title: 'New AR Claims Assigned',
          message: `${insertedCount} claim(s) from "${fileName}"${practiceSuffix} have been assigned to your work queue.`,
        });
      }

      // Create audit log
      await createAuditLog({
        userId: user.id,
        action: AUDIT_ACTIONS.FILE_UPLOADED,
        entityType: 'uploadedFile',
        entityId: uploadRecord.id,
        newValue: {
          fileName,
          fileType,
          recordCount: insertedCount,
          skippedRows: stats.skippedRows,
          duplicatesInFile: stats.duplicatesInFile,
          practiceId: practiceId || null,
          practiceName: selectedPracticeRecord?.name || null,
          assignedTo: assignedTo || null,
        },
        ipAddress: request.headers.get('x-forwarded-for') || '127.0.0.1',
        userAgent: request.headers.get('user-agent') || undefined,
      });

      return NextResponse.json({
        success: true,
        uploadId: uploadRecord.id,
        recordsProcessed: insertedCount,
        skippedRows: stats.skippedRows,
        duplicatesInFile: stats.duplicatesInFile,
        practice: selectedPracticeRecord,
        warnings,
      });
    } catch (processingError: any) {
      console.error('Upload processing error:', processingError);
      await db
        .update(uploadedFiles)
        .set({
          status: 'error',
          errorMessage: processingError.message || 'Upload processing failed.',
        })
        .where(eq(uploadedFiles.id, uploadRecord.id));

      return NextResponse.json(
        {
          error:
            processingError.message ||
            'A database or server error occurred while inserting the claims. Please check your data formatting and try again.',
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Fatal upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process file upload.' },
      { status: 500 }
    );
  }
}
