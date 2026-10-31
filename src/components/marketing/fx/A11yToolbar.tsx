'use client';
import { useEffect, useState } from 'react';
type Prefs = { text: boolean; contrast: boolean; motion: boolean };
const KEY = 'bloomar-a11y';
function apply(p: Prefs) {
  const el = document.documentElement;
  el.classList.toggle('a11y-large-text', p.text);
  el.classList.toggle('a11y-high-contrast', p.contrast);
  el.classList.toggle('a11y-reduce-motion', p.motion);
}
/** Visitor-controlled accessibility: larger text, high contrast, reduced motion. Persisted locally. */
export default function A11yToolbar() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({ text: false, contrast: false, motion: false });
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) { setPrefs(saved); apply(saved); } } catch { /* ignore */ } }, []);
  const set = (k: keyof Prefs) => { const next = { ...prefs, [k]: !prefs[k] }; setPrefs(next); apply(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ } };
  const Toggle = ({ k, label }: { k: keyof Prefs; label: string }) => (
    <button role="switch" aria-checked={prefs[k]} onClick={() => set(k)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600">
      <span>{label}</span><span aria-hidden="true" className={`relative h-5 w-9 rounded-full transition ${prefs[k] ? 'bg-blue-600' : 'bg-slate-300'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${prefs[k] ? 'left-[18px]' : 'left-0.5'}`} /></span>
    </button>);
  return (
    <div className="relative">
      <button aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}
        className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600" aria-label="Accessibility settings">
        <span aria-hidden="true">♿</span><span className="sr-only md:not-sr-only md:ml-1">Accessibility</span>
      </button>
      {open && <div role="group" aria-label="Accessibility options" className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border bg-white p-3 shadow-2xl">
        <p className="px-2 text-xs font-bold uppercase tracking-wide text-slate-500">Display & motion</p>
        <Toggle k="text" label="Larger text" /><Toggle k="contrast" label="High contrast" /><Toggle k="motion" label="Reduce motion & 3D" />
        <a href="/accessibility" className="mt-1 block rounded-lg px-2 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600">Accessibility statement →</a>
      </div>}
    </div>
  );
}
