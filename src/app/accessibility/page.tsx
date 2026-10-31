import { MarketingShell, H1 } from '@/components/marketing/Marketing';
import { getSiteContent } from '@/lib/site-content';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Accessibility — BloomAR Manager', description: 'How BloomAR Manager supports accessible use of our website and application, and how to request help.' };
export default async function Page() {
  const c = await getSiteContent();
  return <MarketingShell content={c}><section className="mx-auto max-w-3xl px-5 py-14">
    <H1>Accessibility</H1>
    <p className="mt-4 text-slate-600">We want every practice and billing team to be able to use {c.brandName}. This page describes what we support today and how to reach us if something blocks you.</p>
    <h2 className="mt-8 text-lg font-bold">What we build in</h2>
    <ul className="mt-2 list-disc space-y-1.5 pl-6 text-slate-600">
      <li><b>Keyboard navigation</b> — every link, button, menu and form control is reachable and shows a visible focus outline; a “Skip to main content” link appears on first Tab.</li>
      <li><b>Display controls</b> — use the <b>Accessibility</b> button in the header to switch on larger text, high contrast, or reduced motion. Your choices are remembered on your device.</li>
      <li><b>Reduced motion</b> — we honor your operating system&apos;s <code>prefers-reduced-motion</code> setting automatically; 3D and scrolling effects are toned down or disabled.</li>
      <li><b>Labels & structure</b> — form fields have labels and hints, tables have captions and header cells, pages use a clear heading hierarchy, and status messages are announced via ARIA live regions.</li>
      <li><b>Color</b> — body text targets WCAG AA contrast; information is never conveyed by color alone (statuses also use text/icons).</li>
    </ul>
    <h2 className="mt-8 text-lg font-bold">Known limitations</h2>
    <p className="mt-2 text-slate-600">Some complex data tables and charts inside the signed-in application are still being improved for screen-reader announcements. The 3D hero animation is decorative and always paired with equivalent text content.</p>
    <h2 className="mt-8 text-lg font-bold">Need help?</h2>
    <p className="mt-2 text-slate-600">Contact us via the <a className="text-blue-700 underline" href="/contact">contact page</a>{c.supportEmail && <> or <a className="text-blue-700 underline" href={`mailto:${c.supportEmail}`}>{c.supportEmail}</a></>} and tell us the page, your assistive technology, and what blocked you — we&apos;ll work with you on an accessible alternative.</p>
  </section></MarketingShell>;
}
