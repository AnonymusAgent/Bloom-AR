'use client';

import React, { useEffect, useState } from 'react';
import {
  QrCode,
  ShieldCheck,
  Copy,
  Check,
  KeyRound,
  Download,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  remainingRecoveryCodes: number;
}

interface MfaSetupPayload {
  secret: string;
  formattedSecret: string;
  issuer: string;
  accountName: string;
  otpauthUri: string;
  qrCodeDataUrl: string;
}

interface MfaAuthenticatorCardProps {
  onStatusMessage?: (message: string) => void;
}

export function MfaAuthenticatorCard({ onStatusMessage }: MfaAuthenticatorCardProps) {
  const [status, setStatus] = useState<MfaStatus>({
    enabled: false,
    enabledAt: null,
    remainingRecoveryCodes: 0,
  });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<MfaSetupPayload | null>(null);
  const [showManualKey, setShowManualKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [issuedRecoveryCodes, setIssuedRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState('');
  const [regenPassword, setRegenPassword] = useState('');
  const [showRegenForm, setShowRegenForm] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const notify = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    if (onStatusMessage) onStatusMessage(text);
  };

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/account/mfa');
      if (res.ok) {
        const data = await res.json();
        setStatus({
          enabled: Boolean(data.enabled),
          enabledAt: data.enabledAt || null,
          remainingRecoveryCodes: Number(data.remainingRecoveryCodes ?? 0),
        });
      }
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleStartSetup = async () => {
    setBusy(true);
    setFeedback(null);
    setIssuedRecoveryCodes(null);
    setShowManualKey(false);
    try {
      const res = await fetch('/api/account/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setup' }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to start authenticator setup.');
        return;
      }
      setSetup(data);
      setVerificationCode('');
    } catch {
      notify('error', 'Network error while starting MFA setup.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyAndEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = verificationCode.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleaned)) {
      notify('error', 'Enter the 6-digit code shown in your authenticator app.');
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/account/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', code: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Invalid 6-digit verification code.');
        return;
      }
      setSetup(null);
      setVerificationCode('');
      setIssuedRecoveryCodes(data.recoveryCodes || null);
      notify(
        'success',
        'Two-factor authentication is now enabled. Save your backup recovery codes below.'
      );
      await loadStatus();
    } catch {
      notify('error', 'Network error while verifying authenticator code.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disablePassword) {
      notify('error', 'Enter your current account password to disable MFA.');
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/account/mfa', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Could not disable MFA.');
        return;
      }
      setDisablePassword('');
      setIssuedRecoveryCodes(null);
      notify('success', 'Two-factor authentication has been disabled.');
      await loadStatus();
    } catch {
      notify('error', 'Network error while disabling MFA.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerateRecoveryCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regenPassword) {
      notify('error', 'Enter your current account password to generate new recovery codes.');
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/account/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate_recovery_codes', password: regenPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Could not regenerate recovery codes.');
        return;
      }
      setRegenPassword('');
      setShowRegenForm(false);
      setIssuedRecoveryCodes(data.recoveryCodes || null);
      notify('success', 'New backup recovery codes generated. Previous recovery codes are now invalid.');
      await loadStatus();
    } catch {
      notify('error', 'Network error while regenerating recovery codes.');
    } finally {
      setBusy(false);
    }
  };

  const copySecretKey = async () => {
    if (!setup) return;
    await navigator.clipboard.writeText(setup.secret);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const copyRecoveryCodes = async () => {
    if (!issuedRecoveryCodes?.length) return;
    await navigator.clipboard.writeText(issuedRecoveryCodes.join('\n'));
    setCopiedRecovery(true);
    setTimeout(() => setCopiedRecovery(false), 2000);
  };

  const downloadRecoveryCodes = () => {
    if (!issuedRecoveryCodes?.length) return;
    const text = [
      'BloomAR Manager — One-Time MFA Recovery Codes',
      '=============================================',
      `Generated: ${new Date().toISOString()}`,
      '',
      'Each code can be used once if you lose access to your authenticator app:',
      '',
      ...issuedRecoveryCodes.map((c, idx) => `${idx + 1}. ${c}`),
      '',
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bloomar-mfa-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-blue-50 text-[#2563EB] border border-blue-100">
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">
              Two-Factor Authentication (Authenticator App)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Scan a QR code with Google Authenticator, Microsoft Authenticator, Apple Passwords,
              1Password, or Authy to require a 6-digit verification code at sign-in.
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
            status.enabled
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {status.enabled && <ShieldCheck className="w-3.5 h-3.5" />}
          {loadingStatus ? 'Checking…' : status.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {feedback && (
        <div
          role="alert"
          className={`mt-4 rounded-lg px-3.5 py-2.5 text-xs font-medium border ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {!loadingStatus && !status.enabled && !setup && (
        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-600">
            Recommended for all Organization Owners, Billing Managers, and Platform Admins.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={handleStartSetup}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#2563EB] hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
          >
            <QrCode className="w-4 h-4" />
            {busy ? 'Generating QR Code…' : 'Set up Authenticator App'}
          </button>
        </div>
      )}

      {setup && !status.enabled && (
        <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
            <div className="md:col-span-5 flex flex-col items-center">
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
                <img
                  src={setup.qrCodeDataUrl}
                  alt="Scan this QR code with Google Authenticator"
                  width={200}
                  height={200}
                  className="w-48 h-48 block rounded"
                />
              </div>
              <span className="mt-2 text-[11px] font-medium text-slate-500">
                Scan with Google Authenticator
              </span>
            </div>

            <div className="md:col-span-7 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                1. Scan this QR code in your authenticator app
              </h3>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-600">
                <li>
                  Open <b>Google Authenticator</b> (or Microsoft Authenticator, Apple Passwords,
                  1Password, or Authy) on your phone.
                </li>
                <li>
                  Tap <b>+</b> &rarr; <b>Scan a QR code</b> and point your camera at the barcode.
                </li>
                <li>
                  Enter the <b>6-digit verification code</b> shown in your app below to finish
                  enabling MFA.
                </li>
              </ol>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowManualKey((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] hover:underline"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {showManualKey
                    ? 'Hide manual setup key'
                    : "Can't scan the QR code? Enter setup key manually"}
                </button>

                {showManualKey && (
                  <div className="mt-2.5 bg-white border border-slate-200 rounded-lg p-3 space-y-2 text-xs">
                    <div className="flex flex-wrap justify-between gap-2 text-slate-600">
                      <span>
                        Account: <b className="text-slate-800">{setup.accountName}</b>
                      </span>
                      <span>
                        Type: <b className="text-slate-800">Time-based (30s)</b>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-slate-50 border rounded px-2.5 py-2">
                      <code className="font-mono text-xs text-slate-900 tracking-wider select-all break-all">
                        {setup.formattedSecret || setup.secret}
                      </code>
                      <button
                        type="button"
                        onClick={copySecretKey}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded border bg-white hover:bg-slate-50 text-slate-700 shrink-0"
                      >
                        {copiedKey ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" /> Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <form
            onSubmit={handleVerifyAndEnable}
            className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-end gap-3"
          >
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                2. Enter 6-digit code from your authenticator app
              </label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={verificationCode}
                onChange={(e) =>
                  setVerificationCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))
                }
                className="w-full border border-slate-300 bg-white rounded-lg px-3.5 py-2 text-sm font-mono tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy || verificationCode.length !== 6}
                className="px-4 py-2 bg-[#2563EB] hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 whitespace-nowrap"
              >
                {busy ? 'Verifying…' : 'Verify & Enable MFA'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setSetup(null);
                  setVerificationCode('');
                }}
                className="px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {issuedRecoveryCodes && issuedRecoveryCodes.length > 0 && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-950">
                  Save your one-time backup recovery codes now (shown only once)
                </p>
                <p className="text-[11px] text-amber-800">
                  Store these in a password manager. Each code works once if you lose your phone.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyRecoveryCodes}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-amber-300 rounded-md text-xs font-semibold text-amber-950 hover:bg-amber-100"
              >
                {copiedRecovery ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-700" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={downloadRecoveryCodes}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-amber-300 rounded-md text-xs font-semibold text-amber-950 hover:bg-amber-100"
              >
                <Download className="w-3.5 h-3.5" /> Download .txt
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {issuedRecoveryCodes.map((rc) => (
              <code
                key={rc}
                className="bg-white border border-amber-200 rounded-md px-2.5 py-1.5 text-center text-xs font-mono font-semibold text-slate-900 select-all"
              >
                {rc}
              </code>
            ))}
          </div>
        </div>
      )}

      {status.enabled && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span>
              Enrolled:{' '}
              <b className="text-slate-800">
                {status.enabledAt ? new Date(status.enabledAt).toLocaleString() : 'Active'}
              </b>{' '}
              &middot; Remaining backup codes:{' '}
              <b className="text-slate-800">{status.remainingRecoveryCodes}</b>
            </span>
            <button
              type="button"
              onClick={() => setShowRegenForm((v) => !v)}
              className="inline-flex items-center gap-1 text-[#2563EB] font-semibold hover:underline"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {showRegenForm ? 'Cancel regeneration' : 'Regenerate backup codes'}
            </button>
          </div>

          {showRegenForm && (
            <form
              onSubmit={handleRegenerateRecoveryCodes}
              className="bg-slate-50 border rounded-lg p-3 flex flex-col sm:flex-row gap-2"
            >
              <input
                type="password"
                placeholder="Confirm current password to issue 8 new backup codes"
                value={regenPassword}
                onChange={(e) => setRegenPassword(e.target.value)}
                className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white"
              />
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 bg-[#0F2D52] text-white rounded-lg text-sm font-semibold whitespace-nowrap disabled:opacity-50"
              >
                Generate New Codes
              </button>
            </form>
          )}

          <form onSubmit={handleDisableMfa} className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500">
              Confirm current account password to disable MFA
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                placeholder="Current password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold whitespace-nowrap disabled:opacity-50"
              >
                Disable MFA
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
