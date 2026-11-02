import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error: 'Synthetic demo claim generation has been permanently disabled. Import real CSV/Excel claims via Upload Claims or create claims inside your organization workspace.',
      code: 'DEMO_DATA_DISABLED',
    },
    { status: 410 }
  );
}
