import Link from 'next/link';
import { MarketingShell, H1 } from '@/components/marketing/Marketing';
import { getSiteContent } from '@/lib/site-content';
import Reveal from '@/components/marketing/fx/Reveal';
import TiltCard from '@/components/marketing/fx/TiltCard';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Features — BloomAR Manager', description: 'Claims, work queues, denial management, authorizations, payments, reporting and team collaboration for medical billing teams.' };

const MODULES = [
  { icon: '🧾', title: 'Claims management', points: ['Full claim lifecycle with 15 statuses', 'Search, filter, sort & bulk assignment', 'Excel/CSV import with smart column mapping'], outcome: 'Every claim accounted for — nothing sits untouched.' },
  { icon: '📥', title: 'AR work queues', points: ['Unworked → working → pending approval → approved', 'Follow-up dates so aged claims resurface', 'Rework loop with mandatory reasons'], outcome: 'Your team always knows what to work next.' },
  { icon: '🛡️', title: 'Denial management & coding', points: ['272 CARC/RARC denial codes built in', 'Denied claims routed to coding with documents', 'Rule-based AI denial analysis with action plans'], outcome: 'Denials get a next step, not a dead end.' },
  { icon: '📊', title: 'AR aging & analytics', points: ['Aging buckets and outstanding balances', 'Payer/insurance breakdowns', 'Team productivity dashboards'], outcome: 'See exactly where money is stuck, by payer and age.' },
  { icon: '✅', title: 'Authorizations & tasks', points: ['Prior auth, referrals, VOB workflows', 'Charge entry & payment posting tasks', 'Sign-offs with supervisor review'], outcome: 'Front-office work tracked alongside AR.' },
  { icon: '💳', title: 'Payments & ERA/835', points: ['ERA file parsing and claim matching', 'Payment posting with adjustments (CARC/RARC)', 'Unmatched items flagged, never lost'], outcome: 'Remittances posted faster, with an audit trail.' },
  { icon: '📈', title: 'Reports & exports', points: ['Date-range KPIs and trend reports', 'User performance reporting', 'One-click CSV/Excel export'], outcome: 'Leadership reporting without spreadsheet gymnastics.' },
  { icon: '💬', title: 'Team collaboration', points: ['Role-based access (7 roles)', 'Real-time team chat & notifications', 'E-signatures, OCR intake & audit trails'], outcome: 'Billers, leads and managers in one workspace.' },
  { icon: '🏢', title: 'Organization workspaces', points: ['Isolated data per organization', 'Invitations with roles & seat limits', 'Custom subdomain / custom domain options'], outcome: 'Each practice sees only its own data — enforced server-side.' },
];
const JOURNEY = [['1 · Import', 'Upload AR from Excel/CSV or enter claims — columns map automatically.'], ['2 · Assign', 'Distribute work by practice, payer or balance with bulk assignment.'], ['3 · Work', 'Billers work queues with notes, documents and follow-up dates.'], ['4 · Review', 'Leads approve or send back for rework — no self-approval.'], ['5 · Get paid', 'Post ERA/payments, route denials to coding, resubmit and report.']];

export default async function Page() {
  const c = await getSiteContent();
  return <MarketingShell content={c}>
    <section className="mkt-hero-bg"><div className="mx-auto max-w-6xl px-5 py-14">
      <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Features</p>
      <div className="mt-2 max-w-3xl"><H1>Everything your billing team needs, in one workspace.</H1></div>
      <p className="mt-4 max-w-2xl text-lg text-slate-600">Only capabilities that exist in the application today are listed as available. Setup-dependent items are marked honestly.</p>
      <div className="mt-6 flex flex-wrap gap-3"><Link href="/register" className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:-translate-y-0.5">Start free trial</Link><Link href="/pricing" className="rounded-xl border bg-white px-6 py-3 font-semibold transition hover:-translate-y-0.5 hover:shadow-md">See pricing & what&apos;s included</Link></div>
    </div></section>

    <section aria-labelledby="journey-h" className="mx-auto max-w-6xl px-5 py-12">
      <Reveal><h2 id="journey-h" className="text-2xl font-extrabold text-[#0F2D52]">How a claim flows through {c.brandName}</h2></Reveal>
      <ol className="mt-6 grid gap-4 md:grid-cols-5">{JOURNEY.map(([t, d], i) => <Reveal key={t} delay={i * 80}><li className="relative h-full rounded-2xl border bg-white p-4 shadow-sm"><p className="font-extrabold text-[#0F2D52]">{t}</p><p className="mt-1 text-sm text-slate-600">{d}</p>{i < 4 && <span aria-hidden="true" className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-blue-400 md:block">→</span>}</li></Reveal>)}</ol>
    </section>

    <section aria-labelledby="modules-h" className="mx-auto max-w-6xl px-5 py-6">
      <Reveal><h2 id="modules-h" className="text-2xl font-extrabold text-[#0F2D52]">Modules included</h2></Reveal>
      <div className="mt-6 grid gap-5 md:grid-cols-3" style={{ perspective: '1200px' }}>
        {MODULES.map((m, i) => <Reveal key={m.title} delay={(i % 3) * 80}><TiltCard max={4} className="h-full"><article className="mkt-card-shadow flex h-full flex-col rounded-3xl border bg-white p-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600/10 text-xl" aria-hidden="true">{m.icon}</div>
          <h3 className="mt-3 font-bold text-[#0F2D52]">{m.title}</h3>
          <ul className="mt-2 flex-1 space-y-1.5 text-sm text-slate-600">{m.points.map(pt => <li key={pt} className="flex gap-2"><span aria-hidden="true" className="text-emerald-600">✓</span>{pt}</li>)}</ul>
          <p className="mt-3 border-t pt-3 text-sm font-medium text-blue-800">{m.outcome}</p>
        </article></TiltCard></Reveal>)}
      </div>
    </section>

    <section aria-labelledby="plans-h" className="mx-auto max-w-6xl px-5 py-12">
      <Reveal><div className="rounded-3xl bg-[#0F2D52] p-6 text-white md:p-8"><h2 id="plans-h" className="text-2xl font-extrabold">Which plan includes what?</h2>
      <p className="mt-2 max-w-2xl text-white/75">Starter covers core claims, queues and the denial library. Professional adds review workflows, authorizations, coding, payments/ERA, AI analysis, reports and chat. Enterprise adds custom domains, API access and dedicated onboarding.</p>
      <div className="mt-5 flex flex-wrap gap-3"><Link href="/pricing" className="rounded-xl bg-white px-5 py-2.5 font-semibold text-[#0F2D52] transition hover:-translate-y-0.5">Compare plans & prices</Link><Link href="/contact?type=demo" className="rounded-xl border border-white/40 px-5 py-2.5 font-semibold transition hover:bg-white/10">Book a demo</Link></div></div></Reveal>
      <Reveal><div className="mt-6 rounded-2xl border bg-amber-50 p-5 text-sm text-amber-900"><b>Setup-dependent (marked honestly):</b> custom domains need DNS + hosting configuration, online checkout needs a payment-provider account, and email delivery needs SMTP configuration. Your workspace, data and trial work without them.</div></Reveal>
    </section>
  </MarketingShell>;
}
