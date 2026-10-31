import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    name: 'BloomAR Manager External API',
    version: '1.0.0',
    documentation: '/api/v1/docs',
    endpoints: {
      claims: { list: 'GET /api/v1/claims', get: 'GET /api/v1/claims/:id', create: 'POST /api/v1/claims' },
      patients: { search: 'GET /api/v1/patients?search=name' },
      denialCodes: { list: 'GET /api/v1/denial-codes', search: 'GET /api/v1/denial-codes?search=code' },
      authorizations: { list: 'GET /api/v1/authorizations', create: 'POST /api/v1/authorizations' },
      reports: { summary: 'GET /api/v1/reports/summary', aging: 'GET /api/v1/reports/aging' },
    },
    authentication: 'Include header: Authorization: Bearer <api_key>',
  });
}
