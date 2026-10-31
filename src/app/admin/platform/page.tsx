'use client';
import { useCallback, useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const inp = 'w-full border rounded-lg px-3 py-2 text-sm';
const lbl = 'block text-xs font-semibold text-slate-500 mt-3';
const btn = 'px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-semibold disabled:opacity-50';
const card = 'bg-white rounded-xl shadow-sm border p-5';
type Tab = 'overview'|'website'|'plans'|'organizations'|'users'|'leads'|'system';
const VALID_PLATFORM_TABS: Tab[] = ['overview','website','plans','organizations','users','leads','system'];

function PlatformAdminContent() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<any>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = useCallback(async () => { const r = await fetch('/api/platform/admin'); if (!r.ok) { setErr('Forbidden — platform admin access (users.is_platform_admin = true) is required. This is separate from organization admin and does not grant access to customer healthcare data.'); return; } setData(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = searchParams.get('tab') as Tab | null;
    if (t && VALID_PLATFORM_TABS.includes(t)) setTab(t);
  }, [searchParams]);
  if (err) return <main className="min-h-screen bg-slate-100 p-8"><div className={`${card} max-w-xl mx-auto`}><h1 className="font-bold text-lg">Platform Admin</h1><p className="text-red-600 text-sm mt-2">{err}</p><p className="text-sm text-slate-600 mt-3">Ask an operator to either set <code className="bg-slate-100 px-1">PLATFORM_ADMIN_EMAILS</code> in the hosting environment to your sign-in email (comma-separated for multiple admins) and redeploy, run <code className="bg-slate-100 px-1">scripts/bootstrap-platform-admin.mjs</code> with private env credentials, or set <code className="bg-slate-100 px-1">users.is_platform_admin=true</code> for your account in the database. Then sign out and back in.</p></div></main>;
  if (!data) return <main className="p-8">Loading platform admin…</main>;
  const tabs: [Tab,string][] = [['overview','Overview'],['website','🌐 Website'],['plans','Plans & Pricing'],['organizations','Organizations'],['users','Users'],['leads','Leads Inbox'],['system','Domains & System']];
  return <main className="min-h-screen bg-[#F5F7FA]"><div className="max-w-6xl mx-auto p-5 space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-extrabold text-[#0F2D52]">Platform Admin</h1><p className="text-sm text-slate-500">Manage your public website, plans, customers and platform — separate from any single organization&apos;s workspace.</p></div><a href="/" target="_blank" className="text-sm text-[#2563EB] font-semibold">View live website ↗</a></header>
    <nav className="flex flex-wrap gap-2" aria-label="Admin sections">{tabs.map(([t,l]) => <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab===t?'bg-[#0F2D52] text-white':'bg-white border'}`}>{l}</button>)}</nav>
    {msg && <p role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-2 text-sm">{msg}</p>}
    {tab==='overview' && <Overview data={data} go={setTab} />}
    {tab==='website' && <WebsiteEditor setMsg={setMsg} />}
    {tab==='plans' && <PlansEditor setMsg={setMsg} />}
    {tab==='organizations' && <Organizations data={data} reload={load} setMsg={setMsg} />}
    {tab==='users' && <UsersAdmin setMsg={setMsg} />}
    {tab==='leads' && <LeadsAdmin setMsg={setMsg} />}
    {tab==='system' && <System data={data} />}
  </div></main>;
}

function Overview({ data, go }: any) {
  return <div className="space-y-5"><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Object.entries(data.metrics).map(([k,v]) => <button key={k} onClick={() => go('organizations')} className={`${card} text-left`}><p className="text-3xl font-extrabold text-[#0F2D52]">{String(v)}</p><p className="text-xs text-slate-500 capitalize">{k.replace(/([A-Z])/g,' $1')}</p></button>)}</div>
  <div className="grid md:grid-cols-3 gap-4">{[['🌐 Manage website','Edit homepage, features, FAQs, legal pages & announcements','website'],['💳 Plans & pricing','Prices shown on /pricing and used at checkout','plans'],['📥 Leads inbox',`${data.leads?.filter((l:any)=>l.status==='new').length||0} new contact/demo requests`,'leads']].map(([t,d,t2]) => <button key={t2} onClick={() => go(t2)} className={`${card} text-left`}><b>{t}</b><p className="text-sm text-slate-500 mt-1">{d}</p></button>)}</div></div>;
}

function WebsiteEditor({ setMsg }: any) {
  const [c, setC] = useState<any>(null); const [saving, setSaving] = useState(false);
  useEffect(() => { fetch('/api/platform/site').then(r => r.json()).then(d => setC(d.content)); }, []);
  if (!c) return <p>Loading website content…</p>;
  const set = (k: string, v: any) => setC({ ...c, [k]: v });
  const save = async () => { setSaving(true); const r = await fetch('/api/platform/site', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(c) }); setSaving(false); setMsg(r.ok ? 'Website updated — changes are live on the public site now.' : 'Failed to save website content.'); };
  const listEditor = (key: string, fields: string[]) => <div>{(c[key]||[]).map((item:any,i:number) => <div key={i} className="border rounded-lg p-3 mt-2">{fields.map(f => <div key={f}><label className={lbl}>{f}</label>{f==='description'||f==='answer'?<textarea className={inp} rows={2} value={item[f]||''} onChange={e => { const a=[...c[key]]; a[i]={...a[i],[f]:e.target.value}; set(key,a); }} />:<input className={inp} value={item[f]||''} onChange={e => { const a=[...c[key]]; a[i]={...a[i],[f]:e.target.value}; set(key,a); }} />}</div>)}<button className="text-red-600 text-xs mt-2" onClick={() => set(key, c[key].filter((_:any,j:number)=>j!==i))}>Remove</button></div>)}<button className="text-[#2563EB] text-sm mt-2" onClick={() => set(key, [...(c[key]||[]), Object.fromEntries(fields.map(f=>[f,'']))])}>+ Add</button></div>;
  return <div className="space-y-5">
    <section className={card}><h2 className="font-bold">Brand & contact</h2><label className={lbl}>Brand name</label><input className={inp} value={c.brandName} onChange={e=>set('brandName',e.target.value)} /><label className={lbl}>Tagline (footer)</label><input className={inp} value={c.tagline} onChange={e=>set('tagline',e.target.value)} /><div className="grid md:grid-cols-2 gap-3"><div><label className={lbl}>Support email</label><input className={inp} value={c.supportEmail} onChange={e=>set('supportEmail',e.target.value)} /></div><div><label className={lbl}>Support phone</label><input className={inp} value={c.supportPhone} onChange={e=>set('supportPhone',e.target.value)} /></div></div><label className={lbl}>Footer note</label><input className={inp} value={c.footerText} onChange={e=>set('footerText',e.target.value)} /></section>
    <section className={card}><h2 className="font-bold">Announcement banner</h2><label className="flex gap-2 text-sm mt-2"><input type="checkbox" checked={c.announcementEnabled} onChange={e=>set('announcementEnabled',e.target.checked)} /> Show banner on every public page</label><label className={lbl}>Banner text</label><input className={inp} value={c.announcementText} onChange={e=>set('announcementText',e.target.value)} /><label className={lbl}>Banner link (optional)</label><input className={inp} value={c.announcementLink} onChange={e=>set('announcementLink',e.target.value)} /></section>
    <section className={card}><h2 className="font-bold">Homepage hero</h2><label className={lbl}>Headline</label><input className={inp} value={c.heroHeadline} onChange={e=>set('heroHeadline',e.target.value)} /><label className={lbl}>Subtext</label><textarea className={inp} rows={3} value={c.heroSubtext} onChange={e=>set('heroSubtext',e.target.value)} /><div className="grid md:grid-cols-2 gap-3"><div><label className={lbl}>Primary button</label><input className={inp} value={c.heroPrimaryCta} onChange={e=>set('heroPrimaryCta',e.target.value)} /></div><div><label className={lbl}>Secondary button</label><input className={inp} value={c.heroSecondaryCta} onChange={e=>set('heroSecondaryCta',e.target.value)} /></div></div><label className={lbl}>Features heading</label><input className={inp} value={c.featuresHeading} onChange={e=>set('featuresHeading',e.target.value)} /></section>
    <section className={card}><h2 className="font-bold">Homepage / Features page cards</h2>{listEditor('features',['title','description'])}</section>
    <section className={card}><h2 className="font-bold">About page</h2><label className={lbl}>About text</label><textarea className={inp} rows={4} value={c.aboutText} onChange={e=>set('aboutText',e.target.value)} /><label className={lbl}>Roadmap text</label><textarea className={inp} rows={2} value={c.roadmapText} onChange={e=>set('roadmapText',e.target.value)} /></section>
    <section className={card}><h2 className="font-bold">FAQ page</h2>{listEditor('faqs',['question','answer'])}</section>
    <section className={card}><h2 className="font-bold">Legal pages</h2>{Object.keys(c.legal||{}).map(slug => <div key={slug}><label className={lbl}>{slug} — title</label><input className={inp} value={c.legal[slug].title} onChange={e=>set('legal',{...c.legal,[slug]:{...c.legal[slug],title:e.target.value}})} /><label className={lbl}>{slug} — paragraphs (one per line)</label><textarea className={inp} rows={4} value={(c.legal[slug].body||[]).join('\n')} onChange={e=>set('legal',{...c.legal,[slug]:{...c.legal[slug],body:e.target.value.split('\n').filter(Boolean)}})} /></div>)}</section>
    <section className={card}><h2 className="font-bold">SEO</h2><label className={lbl}>Site title</label><input className={inp} value={c.seoTitle} onChange={e=>set('seoTitle',e.target.value)} /><label className={lbl}>Meta description</label><textarea className={inp} rows={2} value={c.seoDescription} onChange={e=>set('seoDescription',e.target.value)} /></section>
    <button className={btn} disabled={saving} onClick={save}>{saving?'Saving…':'Save & publish website'}</button>
  </div>;
}

function PlansEditor({ setMsg }: any) {
  const [plans, setPlans] = useState<any[]>([]); const [np, setNp] = useState({ slug:'', name:'', monthlyPriceCents:0, annualPriceCents:0, trialDays:14 });
  const load = () => fetch('/api/platform/plans').then(r=>r.json()).then(d=>setPlans(d.plans||[]));
  useEffect(() => { load(); }, []);
  const save = async (p:any) => { const r = await fetch('/api/platform/plans',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...p, features: typeof p.features==='string'?p.features.split('\n').filter(Boolean):p.features, limits: typeof p.limits==='string'?JSON.parse(p.limits||'{}'):p.limits})}); setMsg(r.ok?`Plan “${p.name}” saved — /pricing updated.`:'Failed to save plan (check limits JSON).'); load(); };
  return <div className="space-y-4">{plans.map(p => <section key={p.id} className={card}><div className="flex justify-between"><b>{p.name}</b><span className="text-xs">{p.isActive?'● Active':'○ Disabled'}</span></div>
    <div className="grid md:grid-cols-4 gap-3"><div><label className={lbl}>Name</label><input className={inp} value={p.name} onChange={e=>setPlans(plans.map(x=>x.id===p.id?{...x,name:e.target.value}:x))} /></div><div><label className={lbl}>Monthly $</label><input type="number" className={inp} value={p.monthlyPriceCents/100} onChange={e=>setPlans(plans.map(x=>x.id===p.id?{...x,monthlyPriceCents:Math.round(+e.target.value*100)}:x))} /></div><div><label className={lbl}>Annual $</label><input type="number" className={inp} value={p.annualPriceCents/100} onChange={e=>setPlans(plans.map(x=>x.id===p.id?{...x,annualPriceCents:Math.round(+e.target.value*100)}:x))} /></div><div><label className={lbl}>Trial days</label><input type="number" className={inp} value={p.trialDays} onChange={e=>setPlans(plans.map(x=>x.id===p.id?{...x,trialDays:+e.target.value}:x))} /></div></div>
    <label className={lbl}>Description</label><input className={inp} value={p.description||''} onChange={e=>setPlans(plans.map(x=>x.id===p.id?{...x,description:e.target.value}:x))} />
    <label className={lbl}>Features (one per line)</label><textarea className={inp} rows={4} value={Array.isArray(p.features)?p.features.join('\n'):p.features||''} onChange={e=>setPlans(plans.map(x=>x.id===p.id?{...x,features:e.target.value}:x))} />
    <div className="grid md:grid-cols-3 gap-3"><div><label className={lbl}>Limits JSON</label><input className={inp} value={typeof p.limits==='string'?p.limits:JSON.stringify(p.limits||{})} onChange={e=>setPlans(plans.map(x=>x.id===p.id?{...x,limits:e.target.value}:x))} /></div><div><label className={lbl}>Stripe monthly price id</label><input className={inp} value={p.stripeMonthlyPriceId||''} onChange={e=>setPlans(plans.map(x=>x.id===p.id?{...x,stripeMonthlyPriceId:e.target.value}:x))} /></div><div><label className={lbl}>Stripe annual price id</label><input className={inp} value={p.stripeAnnualPriceId||''} onChange={e=>setPlans(plans.map(x=>x.id===p.id?{...x,stripeAnnualPriceId:e.target.value}:x))} /></div></div>
    <div className="flex gap-2 mt-3"><button className={btn} onClick={()=>save(p)}>Save plan</button><button className="px-4 py-2 border rounded-lg text-sm" onClick={async()=>{await fetch('/api/platform/plans',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:p.id})}); setMsg('Plan disabled.'); load();}}>Disable</button></div></section>)}
    <section className={card}><h2 className="font-bold">Create plan</h2><div className="grid md:grid-cols-5 gap-3">{(['slug','name','monthlyPriceCents','annualPriceCents','trialDays'] as const).map(k=><div key={k}><label className={lbl}>{k}</label><input type={k.includes('Cents')||k==='trialDays'?'number':'text'} className={inp} value={np[k]} onChange={e=>setNp({...np,[k]:k==='slug'?e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''):e.target.value})} /></div>)}</div><button className={`${btn} mt-3`} onClick={async()=>{const r=await fetch('/api/platform/plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(np)}); const d=await r.json(); setMsg(r.ok?'Plan created.':d.error); load();}}>Create plan</button></section></div>;
}

function Organizations({ data, reload, setMsg }: any) {
  const [reason, setReason] = useState('');
  const act = async (id:string, action:string) => { if(!reason) { setMsg('Enter a reason first — it is recorded in the audit log.'); return; } const r = await fetch('/api/platform/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:id,action,reason})}); setMsg(r.ok?`Organization ${action}d.`:'Action failed.'); reload(); };
  return <section className={card}><h2 className="font-bold">Organizations ({data.organizations.length})</h2><input aria-label="Reason" placeholder="Reason (required, audit-logged)" value={reason} onChange={e=>setReason(e.target.value)} className={`${inp} mt-3`} />
  <ul className="mt-3 space-y-2 text-sm">{data.organizations.map((o:any)=><li key={o.id} className="flex flex-wrap justify-between gap-2 border rounded-lg p-3"><span><b>{o.name}</b> ({o.slug}) — {o.status} · {o.subscriptionTier||'—'} · onboard {o.onboardingComplete?'✓':`${o.onboardingStep||0}`}</span><span className="space-x-2"><button className="text-red-600" onClick={()=>act(o.id,'suspend')}>Suspend</button><button className="text-[#2563EB]" onClick={()=>act(o.id,'reactivate')}>Reactivate</button></span></li>)}</ul></section>;
}

function UsersAdmin({ setMsg }: any) {
  const [users, setUsers] = useState<any[]>([]); const [q, setQ] = useState('');
  const load = (query='') => fetch(`/api/platform/users?q=${encodeURIComponent(query)}`).then(r=>r.json()).then(d=>setUsers(d.users||[]));
  useEffect(() => { load(); }, []);
  const act = async (userId:string, action:string) => { const r = await fetch('/api/platform/users',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId,action})}); const d = await r.json(); setMsg(r.ok?'User updated.':d.error); load(q); };
  return <section className={card}><h2 className="font-bold">All users</h2><div className="flex gap-2 mt-3"><input className={inp} placeholder="Search name or email…" value={q} onChange={e=>setQ(e.target.value)} /><button className={btn} onClick={()=>load(q)}>Search</button></div>
  <div className="overflow-x-auto"><table className="w-full text-sm mt-3"><thead><tr className="text-left text-slate-500"><th className="p-2">User</th><th>Role</th><th>Status</th><th>Verified</th><th>Platform admin</th><th>Actions</th></tr></thead><tbody>{users.map(u=><tr key={u.id} className="border-t"><td className="p-2"><b>{u.firstName} {u.lastName}</b><br/><span className="text-slate-500">{u.email}</span></td><td>{u.role}</td><td>{u.isActive?u.accountStatus:'inactive'}</td><td>{u.emailVerifiedAt?'✓':'—'}</td><td>{u.isPlatformAdmin?'✓ Yes':'—'}</td><td className="space-x-2 whitespace-nowrap"><button className="text-[#2563EB]" onClick={()=>act(u.id, u.isActive?'deactivate':'activate')}>{u.isActive?'Deactivate':'Activate'}</button><button className="text-[#2563EB]" onClick={()=>act(u.id, u.isPlatformAdmin?'remove_platform_admin':'make_platform_admin')}>{u.isPlatformAdmin?'Remove admin':'Make admin'}</button><button className="text-[#2563EB]" onClick={()=>act(u.id,'revoke_sessions')}>Revoke sessions</button>{!u.emailVerifiedAt && <button className="text-[#2563EB]" onClick={()=>act(u.id,'mark_verified')}>Mark verified</button>}</td></tr>)}</tbody></table></div></section>;
}

function LeadsAdmin({ setMsg }: any) {
  const [leads, setLeads] = useState<any[]>([]);
  const load = () => fetch('/api/platform/leads').then(r=>r.json()).then(d=>setLeads(d.leads||[]));
  useEffect(() => { load(); }, []);
  return <section className={card}><h2 className="font-bold">Leads inbox — contact, sales & demo requests from your website</h2><ul className="mt-3 space-y-2 text-sm">{leads.map(l=><li key={l.id} className="border rounded-lg p-3 flex flex-wrap justify-between gap-2"><span><b>{l.type}</b>: {l.name} &lt;{l.email}&gt; {l.organization||''}<br/><span className="text-slate-500">{l.message||''}</span></span><span className="flex gap-2"><select aria-label="Status" value={l.status} onChange={async e=>{await fetch('/api/platform/leads',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:l.id,status:e.target.value})}); setMsg('Lead updated.'); load();}} className="border rounded-lg px-2 py-1">{['new','contacted','qualified','converted','closed'].map(s=><option key={s}>{s}</option>)}</select><button className="text-red-600" onClick={async()=>{await fetch('/api/platform/leads',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:l.id})}); load();}}>Delete</button></span></li>)}{!leads.length && <li className="text-slate-500">No leads yet — submissions from /contact appear here.</li>}</ul></section>;
}

function System({ data }: any) {
  const i = data.integrations || {};
  const Row = ({k,v}:any) => <div className="flex justify-between border-b py-2 text-sm"><span>{k}</span><b>{v}</b></div>;
  return <div className="grid md:grid-cols-2 gap-5"><section className={card}><h2 className="font-bold">Integrations (status only — secrets never shown)</h2><div className="mt-2"><Row k="Email (SMTP)" v={i.emailConfigured?'Configured ✓':'Not configured — set SMTP_*'} /><Row k="Payments (Stripe)" v={i.paymentsConfigured?'Configured ✓':'Not configured — set STRIPE_SECRET_KEY'} /><Row k="Stripe webhook" v={i.webhookConfigured?'Configured ✓':'Not configured'} /><Row k="Root domain" v={i.rootDomain||'Not set'} /><Row k="App URL" v={i.appUrl||'Not set'} /></div><p className="text-xs text-slate-500 mt-3">Set these in your hosting environment variables, then redeploy. Full guide: docs/SAAS_SETUP.md</p></section>
  <section className={card}><h2 className="font-bold">Custom domains ({data.domains?.length||0})</h2><ul className="text-sm mt-2 space-y-2">{(data.domains||[]).map((d:any)=><li key={d.id} className="border rounded-lg p-2"><b>{d.hostname}</b> — {d.verificationStatus} · hosting: {d.hostingStatus} · TLS: {d.tlsStatus}</li>)}{!data.domains?.length && <li className="text-slate-500">No custom domains yet.</li>}</ul></section></div>;
}

export default function PlatformAdmin() {
  return <Suspense fallback={<main className="p-8">Loading platform admin…</main>}><PlatformAdminContent /></Suspense>;
}
