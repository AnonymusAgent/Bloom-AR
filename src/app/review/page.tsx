'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { 
  FileSearch, 
  ExternalLink, 
  CheckCircle, 
  XCircle, 
  RotateCcw,
  DollarSign,
  User,
  Building2,
} from 'lucide-react';

interface Claim {
  id: string;
  claimNumber: string;
  patientName: string | null;
  dateOfService: string | null;
  insurance: string | null;
  billedAmount: string | null;
  balance: string | null;
  status: string;
  assigneeName: string | null;
  workedByName?: string | null;
  practiceName?: string | null;
  practiceCode?: string | null;
  createdAt: string;
}

export default function ReviewPage() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | 'rework'>('approve');
  const [reviewComments, setReviewComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const fetchClaims = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/claims?status=submitted_for_review&limit=100');
      const data = await res.json();
      if (res.ok) {
        setClaims(data.claims);
      }
    } catch (error) {
      console.error('Failed to fetch claims:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClaims();
  }, [fetchClaims]);

  const handleReview = async () => {
    if (!selectedClaim) return;
    if ((reviewAction === 'rework' || reviewAction === 'reject') && !reviewComments.trim()) {
      alert('Please provide feedback comments before submitting.');
      return;
    }
    setSubmitting(true);

    try {
      const res = await fetch(`/api/claims/${selectedClaim.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: reviewAction,
          comments: reviewComments,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setShowReviewModal(false);
        setSelectedClaim(null);
        setReviewComments('');
        fetchClaims();
      } else {
        alert(data.error || 'Failed to review claim');
      }
    } catch (error) {
      console.error('Failed to review claim:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const openReviewModal = (claim: Claim, action: 'approve' | 'reject' | 'rework') => {
    setSelectedClaim(claim);
    setReviewAction(action);
    setShowReviewModal(true);
  };

  const formatCurrency = (amount: string | null) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(amount));
  };

  return (
    <AppLayout title="Review Queue">
      <div className="mb-6 flex items-center gap-3">
        <FileSearch className="w-6 h-6 text-slate-400" />
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Claims Pending Review</h2>
          <p className="text-sm text-slate-500">{claims.length} claims waiting for your review</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : claims.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <CheckCircle className="w-12 h-12 text-emerald-300 mx-auto mb-4" />
            <p className="text-slate-500">No claims pending review</p>
            <p className="text-sm text-slate-400 mt-1">All caught up!</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {claims.map((claim) => (
            <Card key={claim.id}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <span className="text-lg font-semibold text-slate-900">
                      {claim.claimNumber}
                    </span>
                    <StatusBadge status={claim.status} />
                    {(claim.practiceName || claim.practiceCode) && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                        <Building2 className="w-3.5 h-3.5" />
                        {claim.practiceCode ? `${claim.practiceCode} — ${claim.practiceName}` : claim.practiceName}
                      </span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                    <div>
                      <span className="text-slate-500">Practice:</span>
                      <p className="font-medium text-slate-900">
                        {claim.practiceCode ? `${claim.practiceCode} — ${claim.practiceName}` : claim.practiceName || '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">Patient:</span>
                      <p className="font-medium text-slate-900">{claim.patientName || '-'}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">DOS:</span>
                      <p className="font-medium text-slate-900">{claim.dateOfService || '-'}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Insurance:</span>
                      <p className="font-medium text-slate-900">{claim.insurance || '-'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <DollarSign className="w-4 h-4 text-slate-400" />
                      <span className="font-semibold text-slate-900">
                        {formatCurrency(claim.balance)}
                      </span>
                    </div>
                  </div>

                  {(claim.workedByName || claim.assigneeName) && (
                    <div className="flex items-center gap-2 mt-3 text-sm text-slate-500">
                      <User className="w-4 h-4" />
                      Worked by {claim.workedByName || claim.assigneeName}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 ml-6">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => router.push(`/claims/${claim.id}`)}
                  >
                    <ExternalLink className="w-4 h-4 mr-1" />
                    View
                  </Button>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openReviewModal(claim, 'approve')}
                      className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                      title="Approve"
                    >
                      <CheckCircle className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => openReviewModal(claim, 'rework')}
                      className="p-2 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                      title="Request Rework"
                    >
                      <RotateCcw className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => openReviewModal(claim, 'reject')}
                      className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                      title="Reject"
                    >
                      <XCircle className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Review Modal */}
      <Modal
        isOpen={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        title={`${reviewAction.charAt(0).toUpperCase() + reviewAction.slice(1)} Claim`}
      >
        {selectedClaim && (
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-500">Claim Number</p>
              <p className="font-semibold text-slate-900">{selectedClaim.claimNumber}</p>
            </div>

            <div className={`p-4 rounded-lg ${
              reviewAction === 'approve' ? 'bg-emerald-50' :
              reviewAction === 'rework' ? 'bg-amber-50' : 'bg-red-50'
            }`}>
              <p className="font-medium mb-2">
                {reviewAction === 'approve' && '✓ Approve this claim'}
                {reviewAction === 'rework' && '↻ Request rework on this claim'}
                {reviewAction === 'reject' && '✕ Reject this claim'}
              </p>
              <p className="text-sm text-slate-600">
                {reviewAction === 'approve' && 'The claim work will be marked as approved.'}
                {reviewAction === 'rework' && 'The claim will be sent back to the user for corrections.'}
                {reviewAction === 'reject' && 'The claim will be marked as rejected/denied.'}
              </p>
            </div>

            <Textarea
              label="Comments"
              value={reviewComments}
              onChange={(e) => setReviewComments(e.target.value)}
              placeholder={
                reviewAction === 'approve' 
                  ? 'Optional comments...'
                  : 'Please provide feedback...'
              }
              rows={4}
            />

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowReviewModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleReview}
                loading={submitting}
                className={
                  reviewAction === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' :
                  reviewAction === 'rework' ? 'bg-amber-600 hover:bg-amber-700' :
                  'bg-red-600 hover:bg-red-700'
                }
              >
                {reviewAction === 'approve' && 'Approve'}
                {reviewAction === 'rework' && 'Request Rework'}
                {reviewAction === 'reject' && 'Reject'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </AppLayout>
  );
}
