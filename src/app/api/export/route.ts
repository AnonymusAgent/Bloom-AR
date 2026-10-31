import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { claims, practices, authorizations, billingTasks, codingRequests, auditLogs, users } from '@/db/schema';
import { eq, and, gte, lte, ilike, or, desc, inArray, sql } from 'drizzle-orm';
import { getCurrentUser, isSupervisorOrAbove } from '@/lib/auth';
import { cleanUuid, parseEndOfDay } from '@/lib/sanitize';
import * as XLSX from 'xlsx';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = request.nextUrl.searchParams;
    const entity = sp.get('entity') || 'claims';
    const format = sp.get('format') || 'csv';
    const dateFrom = sp.get('dateFrom');
    const dateTo = sp.get('dateTo');
    const status = sp.get('status');
    const search = sp.get('search');
    const assignedTo = cleanUuid(sp.get('assignedTo'));
    const endDate = dateTo ? parseEndOfDay(dateTo) : null;

    let rows: Record<string, unknown>[] = [];
    let fileName = entity;

    if (entity === 'claims') {
      const conds = [];
      if (!isSupervisorOrAbove(user.role)) conds.push(eq(claims.assignedTo, user.id));
      if (status) conds.push(eq(claims.status, status as typeof claims.status.enumValues[number]));
      if (dateFrom) conds.push(gte(claims.createdAt, new Date(dateFrom)));
      if (endDate) conds.push(lte(claims.createdAt, endDate));
      if (search) conds.push(or(ilike(claims.claimNumber, `%${search}%`), ilike(claims.patientName, `%${search}%`)));
      if (assignedTo) conds.push(eq(claims.assignedTo, assignedTo));

      const data = await db.select({
        claimNumber: claims.claimNumber, accountNumber: claims.accountNumber,
        practiceId: claims.practiceId,
        patientName: claims.patientName, dateOfService: claims.dateOfService,
        cptCodes: claims.cptCodes, provider: claims.provider, insurance: claims.insurance,
        payer: claims.payer, billedAmount: claims.billedAmount, paidAmount: claims.paidAmount,
        balance: claims.balance, status: claims.status, priority: claims.priority,
        createdAt: claims.createdAt,
      }).from(claims).where(conds.length ? and(...conds) : undefined).orderBy(desc(claims.createdAt)).limit(5000);

      const pIds = Array.from(new Set(data.map(r => r.practiceId).filter((id): id is string => Boolean(id))));
      const pRows = pIds.length > 0
        ? await db.select({ id: practices.id, name: practices.name, code: practices.code }).from(practices).where(inArray(practices.id, pIds))
        : [];
      const pMap = new Map(pRows.map(p => [p.id, `${p.code} — ${p.name}`]));

      rows = data.map(r => ({
        'Claim #': r.claimNumber, Practice: (r.practiceId ? pMap.get(r.practiceId) : '') || '', 'Account #': r.accountNumber || '', Patient: r.patientName || '',
        DOS: r.dateOfService || '', 'CPT Codes': r.cptCodes || '', Provider: r.provider || '',
        Insurance: r.insurance || '', Payer: r.payer || '',
        'Billed Amount': r.billedAmount ? `$${r.billedAmount}` : '', 'Paid Amount': r.paidAmount ? `$${r.paidAmount}` : '',
        Balance: r.balance ? `$${r.balance}` : '', Status: r.status, Priority: r.priority || '',
        Created: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '',
      }));
      fileName = 'claims_export';
    } else if (entity === 'authorizations') {
      const conds = [];
      if (!isSupervisorOrAbove(user.role)) conds.push(eq(authorizations.assignedTo, user.id));
      if (status) conds.push(eq(authorizations.status, status as typeof authorizations.status.enumValues[number]));
      if (dateFrom) conds.push(gte(authorizations.createdAt, new Date(dateFrom)));
      if (endDate) conds.push(lte(authorizations.createdAt, endDate));

      const data = await db.select().from(authorizations).where(conds.length ? and(...conds) : undefined).orderBy(desc(authorizations.createdAt)).limit(5000);
      rows = data.map(r => ({
        Patient: r.patientName, Insurance: r.insuranceName, 'Auth #': r.authNumber || '',
        'Date Obtained': r.dateObtained || '', 'Expiration': r.expirationDate || '', Status: r.status,
        'Service Requested': r.serviceRequested || '', 'CPT Codes': r.cptCodes || '',
        Created: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '',
      }));
      fileName = 'authorizations_export';
    } else if (entity === 'tasks') {
      const conds = [];
      if (!isSupervisorOrAbove(user.role)) conds.push(eq(billingTasks.assignedTo, user.id));
      if (status) conds.push(eq(billingTasks.status, status as typeof billingTasks.status.enumValues[number]));
      if (dateFrom) conds.push(gte(billingTasks.createdAt, new Date(dateFrom)));
      if (endDate) conds.push(lte(billingTasks.createdAt, endDate));

      const data = await db.select().from(billingTasks).where(conds.length ? and(...conds) : undefined).orderBy(desc(billingTasks.createdAt)).limit(5000);
      rows = data.map(r => ({
        Title: r.title, Category: r.category, Status: r.status, Priority: r.priority || '',
        Patient: r.patientName || '', Insurance: r.insuranceName || '', 'Due Date': r.dueDate || '',
        Created: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '',
      }));
      fileName = 'tasks_export';
    } else if (entity === 'audit-logs') {
      if (!isSupervisorOrAbove(user.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      const conds = [];
      if (dateFrom) conds.push(gte(auditLogs.createdAt, new Date(dateFrom)));
      if (endDate) conds.push(lte(auditLogs.createdAt, endDate));

      const data = await db.select({
        action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId,
        ipAddress: auditLogs.ipAddress, createdAt: auditLogs.createdAt, userId: auditLogs.userId,
      }).from(auditLogs).where(conds.length ? and(...conds) : undefined).orderBy(desc(auditLogs.createdAt)).limit(5000);

      rows = data.map(r => ({
        Timestamp: r.createdAt ? new Date(r.createdAt).toLocaleString() : '', Action: r.action,
        'Entity Type': r.entityType, 'Entity ID': r.entityId || '', 'IP Address': r.ipAddress || '',
      }));
      fileName = 'audit_logs_export';
    } else if (entity === 'productivity') {
      if (!isSupervisorOrAbove(user.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      const workers = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
        .from(users).where(and(eq(users.isActive, true), inArray(users.role, ['ar_executive', 'billing_user'])));

      rows = await Promise.all(workers.map(async (w) => {
        const [ct] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(eq(claims.assignedTo, w.id));
        const [cc] = await db.select({ count: sql<number>`count(*)::int` }).from(claims).where(and(eq(claims.assignedTo, w.id), inArray(claims.status, ['approved', 'paid', 'closed'])));
        const [at] = await db.select({ count: sql<number>`count(*)::int` }).from(authorizations).where(eq(authorizations.assignedTo, w.id));
        const [ac] = await db.select({ count: sql<number>`count(*)::int` }).from(authorizations).where(and(eq(authorizations.assignedTo, w.id), eq(authorizations.status, 'completed')));
        return { Name: `${w.firstName} ${w.lastName}`, Role: w.role, 'Total Claims': ct.count, 'Completed Claims': cc.count, 'Total Auths': at.count, 'Completed Auths': ac.count, 'Completion %': ct.count + at.count > 0 ? `${Math.round(((cc.count + ac.count) / (ct.count + at.count)) * 100)}%` : '0%' };
      }));
      fileName = 'productivity_report';
    }

    if (rows.length === 0) rows = [{ Message: 'No data found for the selected filters' }];

    const dateStr = new Date().toISOString().split('T')[0];
    fileName = `${fileName}_${dateStr}`;

    if (format === 'csv') {
      const headers = Object.keys(rows[0]);
      const csvContent = [headers.join(','), ...rows.map(r => headers.map(h => {
        const v = String(r[h] ?? '');
        return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(','))].join('\n');

      return new NextResponse(csvContent, {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${fileName}.csv"` },
      });
    } else if (format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Data');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      return new NextResponse(buf, {
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fileName}.xlsx"` },
      });
    } else if (format === 'pdf') {
      // Generate a simple text-based PDF table
      const headers = Object.keys(rows[0]);
      const lines = [`REPORT: ${entity.toUpperCase()}`, `Generated: ${new Date().toLocaleString()}`, `Total Records: ${rows.length}`, '', headers.join(' | '), '-'.repeat(80)];
      rows.slice(0, 500).forEach(r => { lines.push(headers.map(h => String(r[h] ?? '').substring(0, 20)).join(' | ')); });

      const textContent = lines.join('\n');
      return new NextResponse(textContent, {
        headers: { 'Content-Type': 'text/plain', 'Content-Disposition': `attachment; filename="${fileName}.txt"` },
      });
    }

    return NextResponse.json({ error: 'Invalid format' }, { status: 400 });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
