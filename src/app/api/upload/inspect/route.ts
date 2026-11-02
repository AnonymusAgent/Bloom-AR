import { NextRequest, NextResponse } from 'next/server';
import { canUploadFiles } from '@/lib/auth';
import { inspectWorkbook, CANONICAL_FIELDS } from '@/lib/file-parser';
import { requireTenantContext } from '@/lib/tenant-context';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantContext({ allowMutation: true });
    if (!auth.ok) return auth.response;
    const { user } = auth.ctx;

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
    const sheetName = formData.get('sheetName') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file was provided.' }, { status: 400 });
    }

    const fileName = file.name;
    const fileType = fileName.split('.').pop()?.toLowerCase() || '';

    if (!['xlsx', 'xls', 'csv'].includes(fileType)) {
      return NextResponse.json(
        {
          error:
            'Unsupported file format. Please upload an Excel spreadsheet (.xlsx, .xls) or comma-separated file (.csv).',
        },
        { status: 400 }
      );
    }

    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        {
          error:
            'The uploaded file exceeds the 25MB maximum size limit. Please upload a smaller file or split the records.',
        },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      const inspection = inspectWorkbook(buffer, fileName, sheetName || undefined);
      return NextResponse.json({
        success: true,
        inspection,
        canonicalFields: CANONICAL_FIELDS,
      });
    } catch (parseError: unknown) {
      const msg =
        parseError instanceof Error
          ? parseError.message
          : 'The Excel file could not be read. Please check that the file is not password-protected or corrupted and try again.';
      console.error('Workbook inspection error:', parseError);
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  } catch (error: unknown) {
    console.error('Inspect API error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred while analyzing the file.' },
      { status: 500 }
    );
  }
}
