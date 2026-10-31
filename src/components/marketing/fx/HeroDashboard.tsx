'use client';
import { useRef, type MouseEvent } from 'react';
/** Layered CSS-3D product mockup: panels float at different Z depths inside a tilting scene. */
export default function HeroDashboard() {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: MouseEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateX(${(10 - y * 10).toFixed(2)}deg) rotateY(${(-14 + x * 12).toFixed(2)}deg)`;
  };
  const reset = () => { if (ref.current) ref.current.style.transform = 'rotateX(10deg) rotateY(-14deg)'; };
  const chip = 'rounded-xl px-3.5 py-2.5 text-xs font-semibold shadow-2xl backdrop-blur';
  return (
    <div className="mkt-scene mx-auto w-full max-w-[520px]" onMouseMove={onMove} onMouseLeave={reset} role="img"
      aria-label="Illustration of the BloomAR Manager workspace: AR aging, work queue and denial routing">
      <div ref={ref} className="mkt-preserve relative transition-transform duration-300 ease-out" style={{ transform: 'rotateX(10deg) rotateY(-14deg)' }}>
        {/* main dashboard panel */}
        <div className="relative rounded-2xl bg-[#0F2D52] p-5 text-white shadow-[0_40px_80px_-20px_rgba(15,45,82,.55)] ring-1 ring-white/20" style={{ transform: 'translateZ(30px)' }}>
          <div className="flex items-center justify-between"><p className="font-bold text-sm">BloomAR Manager — Workspace</p><span className="flex gap-1.5">{['#f87171','#fbbf24','#34d399'].map(c => <i key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />)}</span></div>
          <div className="mt-4 grid grid-cols-3 gap-2.5 text-center">
            {[['AR balance', '$284k'], ['0–30 days', '62%'], ['Denials', '18']].map(([l, v]) => <div key={l} className="rounded-lg bg-white/10 px-2 py-3"><p className="text-base font-extrabold">{v}</p><p className="text-[10px] text-white/65">{l}</p></div>)}
          </div>
          <div className="mt-4 space-y-2" aria-hidden="true">{[['bg-sky-400', '82%'], ['bg-emerald-400', '64%'], ['bg-amber-400', '41%']].map(([c, w]) => <div key={w} className="h-2 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${c}`} style={{ width: w }} /></div>)}</div>
          <ul className="mt-4 space-y-2 text-xs">{['Work queue: unworked → working → approved', 'Denied claim routed to coding', 'Follow-up due today · 6 claims'].map(x => <li key={x} className="rounded-lg bg-white/[.07] px-3 py-2">{x}</li>)}</ul>
        </div>
        {/* floating depth chips */}
        <div className={`${chip} mkt-float absolute -left-4 -top-5 bg-white text-emerald-700`} style={{ transform: 'translateZ(95px)' }}>✓ Claim approved</div>
        <div className={`${chip} mkt-float-slow absolute -right-3 top-1/3 bg-blue-600 text-white`} style={{ transform: 'translateZ(75px)' }}>AR aging · 31–60 ↓ 12%</div>
        <div className={`${chip} mkt-float absolute bottom-6 -left-6 bg-white text-[#0F2D52] shadow-xl ring-1 ring-slate-200`} style={{ transform: 'translateZ(110px)' }}>🧾 ERA posted · $12,480</div>
        <div className="absolute -bottom-8 right-8 h-24 w-24 rounded-full bg-blue-500/25 blur-2xl" style={{ transform: 'translateZ(-30px)' }} aria-hidden="true" />
      </div>
    </div>
  );
}
