'use client';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function Inner() {
  const token = useSearchParams().get('token');
  const [f, setF] = useState({ firstName: '', lastName: '', password: '' });
  const [msg, setMsg] = useState('');
  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-5">
      <div className="bg-white rounded-2xl shadow p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold">Accept invitation</h1>
        <p className="text-sm text-slate-600 mt-2">
          New to BloomAR Manager? Fill in your name and create a 10+ character password. Already have an account? Enter your existing password to join this workspace.
        </p>
        {[
          ['firstName', 'First name (new accounts)', 'text'],
          ['lastName', 'Last name (optional)', 'text'],
          ['password', 'Password (10+ chars for new accounts, or your existing password)', 'password'],
        ].map(([k, l, t]) => (
          <div key={k}>
            <label className="text-sm font-medium block mt-4" htmlFor={k}>
              {l}
            </label>
            <input
              id={k}
              type={t}
              value={(f as Record<string, string>)[k]}
              onChange={(e) => setF({ ...f, [k]: e.target.value })}
              className="mt-1 w-full border rounded-lg px-3 py-2"
            />
          </div>
        ))}
        <button
          className="w-full mt-5 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-semibold"
          onClick={async () => {
            const r = await fetch('/api/invitations/accept', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, ...f }),
            });
            const d = await r.json();
            if (r.ok) window.location.href = '/dashboard';
            else setMsg(d.error || 'Failed to accept invitation');
          }}
        >
          Accept invitation
        </button>
        {msg && (
          <p role="alert" className="text-sm mt-3 text-red-600">
            {msg}
          </p>
        )}
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
