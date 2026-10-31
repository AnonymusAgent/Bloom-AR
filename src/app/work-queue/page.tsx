'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Building2, ClipboardList, Clock, DollarSign, ExternalLink, Play } from 'lucide-react';

interface Claim {
  id: string;
  claimNumber: string;
  accountNumber: string | null;
  patientName: string | null;
  dateOfService: string | null;
  insurance: string | null;
  billedAmount: string | null;
  balance: string | null;
  status: string;
  workflowStatus: string | null;
  priority: string | null;
  practiceId: string | null;
  practiceName: string | null;
  practiceCode: string | null;
  createdAt: string;
  assignedAt: string | null;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All My Claims' },
  { value: 'new,assigned', label: 'Assigned / Ready' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'rework_required', label: 'Rework Required' },
];

export default function WorkQueuePage() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const router = useRouter();

  const fetchClaims = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter) {
        params.set('status', statusFilter);
      } else {
        params.set('status', 'new,assigned,in_progress,rework_required');
      }

      const res = await fetch(`/api/claims?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok) {
        setClaims(data.claims);
      }
    } catch (error) {
      console.error('Failed to fetch claims:', error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchClaims();
  }, [fetchClaims]);

  const handleStartWork = async (claimId: string) => {
    try {
      await fetch(`/api/claims/${claimId}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'start_working' }),
      });
      router.push(`/claims/${claimId}`);
    } catch (error) {
      console.error('Failed to start work:', error);
      router.push(`/claims/${claimId}`);
    }
  };

  const formatCurrency = (amount: string | null) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(amount));
  };

  const getPriorityColor = (priority: string | null) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 border-red-200';
      case 'urgent':
        return 'bg-amber-100 border-amber-200';
      default:
        return 'bg-white border-slate-200';
    }
  };

  // Group claims by status/workflow
  const groupedClaims = {
    rework: claims.filter((c) => c.status === 'rework_required' || c.workflowStatus === 'rework'),
    assigned: claims.filter(
      (c) =>
        (c.status === 'assigned' || c.status === 'new') &&
        c.workflowStatus !== 'rework' &&
        c.workflowStatus !== 'working'
    ),
    inProgress: claims.filter(
      (c) => c.status === 'in_progress' || c.workflowStatus === 'working'
    ),
  };

  return (
    <AppLayout title="Work Queue">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-slate-400" />
          <div>
            <h2 className="text-lg font-semibold text-slate-900">My Work Queue</h2>
            <p className="text-sm text-slate-500">{claims.length} claims in your queue</p>
          </div>
        </div>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={STATUS_OPTIONS}
          className="w-48"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : claims.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">No claims in your work queue</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Rework Required - High Priority */}
          {groupedClaims.rework.length > 0 && (
            <Card className="border-red-200">
              <CardHeader
                title="Rework Required"
                subtitle={`${groupedClaims.rework.length} claim(s) need attention`}
              />
              <div className="space-y-3">
                {groupedClaims.rework.map((claim) => (
                  <ClaimCard
                    key={claim.id}
                    claim={claim}
                    onWork={() => router.push(`/claims/${claim.id}`)}
                    formatCurrency={formatCurrency}
                    getPriorityColor={getPriorityColor}
                  />
                ))}
              </div>
            </Card>
          )}

          {/* Assigned */}
          {groupedClaims.assigned.length > 0 && (
            <Card>
              <CardHeader
                title="Assigned"
                subtitle={`${groupedClaims.assigned.length} claim(s) ready to work`}
              />
              <div className="space-y-3">
                {groupedClaims.assigned.map((claim) => (
                  <ClaimCard
                    key={claim.id}
                    claim={claim}
                    onWork={() => handleStartWork(claim.id)}
                    formatCurrency={formatCurrency}
                    getPriorityColor={getPriorityColor}
                    showStartButton
                  />
                ))}
              </div>
            </Card>
          )}

          {/* In Progress */}
          {groupedClaims.inProgress.length > 0 && (
            <Card>
              <CardHeader
                title="In Progress"
                subtitle={`${groupedClaims.inProgress.length} claim(s) being worked`}
              />
              <div className="space-y-3">
                {groupedClaims.inProgress.map((claim) => (
                  <ClaimCard
                    key={claim.id}
                    claim={claim}
                    onWork={() => router.push(`/claims/${claim.id}`)}
                    formatCurrency={formatCurrency}
                    getPriorityColor={getPriorityColor}
                  />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </AppLayout>
  );
}

function ClaimCard({
  claim,
  onWork,
  formatCurrency,
  getPriorityColor,
  showStartButton,
}: {
  claim: Claim;
  onWork: () => void;
  formatCurrency: (amount: string | null) => string;
  getPriorityColor: (priority: string | null) => string;
  showStartButton?: boolean;
}) {
  const practiceLabel =
    claim.practiceCode && claim.practiceName
      ? `${claim.practiceCode} — ${claim.practiceName}`
      : claim.practiceName || null;

  return (
    <div className={`p-4 rounded-lg border ${getPriorityColor(claim.priority)}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="font-semibold text-slate-900">{claim.claimNumber}</span>
            <StatusBadge status={claim.status} />
            {practiceLabel && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                <Building2 className="w-3 h-3" />
                {practiceLabel}
              </span>
            )}
            {claim.priority && claim.priority !== 'normal' && (
              <Badge variant={claim.priority === 'high' ? 'danger' : 'warning'}>
                {claim.priority}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <span className="text-slate-500">Practice:</span>
              <span className="ml-1 font-medium">{practiceLabel || '-'}</span>
            </div>
            <div>
              <span className="text-slate-500">Patient:</span>
              <span className="ml-1 font-medium">{claim.patientName || '-'}</span>
            </div>
            <div>
              <span className="text-slate-500">DOS:</span>
              <span className="ml-1 font-medium">{claim.dateOfService || '-'}</span>
            </div>
            <div>
              <span className="text-slate-500">Insurance:</span>
              <span className="ml-1 font-medium">{claim.insurance || '-'}</span>
            </div>
            <div className="flex items-center gap-1">
              <DollarSign className="w-3 h-3 text-slate-400" />
              <span className="font-medium text-slate-900">{formatCurrency(claim.balance)}</span>
            </div>
          </div>
          {claim.assignedAt && (
            <div className="flex items-center gap-1 mt-2 text-xs text-slate-400">
              <Clock className="w-3 h-3" />
              Assigned {new Date(claim.assignedAt).toLocaleDateString()}
            </div>
          )}
        </div>
        <div className="flex gap-2 ml-4 flex-shrink-0">
          {showStartButton ? (
            <Button size="sm" onClick={onWork}>
              <Play className="w-4 h-4 mr-1" />
              Start
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onWork}>
              <ExternalLink className="w-4 h-4 mr-1" />
              Open
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
