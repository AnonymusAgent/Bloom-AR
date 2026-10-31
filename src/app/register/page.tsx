'use client';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
function Inner(){
  const sp = useSearchParams();
  const [f,setF] = useState({firstName:'',lastName:'',email:'',password:'',organizationName:'',orgType:'practice',country:'',timezone:'',planSlug:sp.get('plan')||'starter',acceptedTerms:false});
  const [msg,setMsg] = useState('');
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setMsg('Creating account…');
    const r = await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)});
    const d = await r.json();
    setMsg(r.ok ? d.message + (d.emailDelivery==='not_configured' ? ' Note: email delivery is not configured on this deployment yet — ask the operator to configure SMTP (docs/SAAS_SETUP.md), then resend verification.' : '') : (d.error||'Failed')); };
  const field = (k:string,label:string,type='text',required=true) => (
    <div key={k}><label className="text-sm font-medium" htmlFor={k}>{label}</label>
    <input id={k} type={type} required={required} value={(f as unknown as Record<string,string>)[k]} onChange={e=>setF({...f,[k]:e.target.value})} className="mt-1 w-full border rounded-lg px-3 py-2"/></div>);
  return <main className="min-h-screen bg-slate-100 flex justify-center p-5"><form onSubmit={submit} className="bg-white rounded-2xl shadow p-8 w-full max-w-lg h-fit">
    <Link href="/" className="font-extrabold text-[#0F2D52]">BloomAR Manager</Link><h1 className="text-2xl font-bold mt-4">Create your account</h1>
    <p className="text-sm text-slate-600 mt-1">Your organization gets its own isolated workspace and trial.</p>
    <div className="space-y-3 mt-6">
      {field('firstName','First name')}{field('lastName','Last name','text',false)}{field('email','Work email','email')}{field('password','Password (10+ characters)','password')}{field('organizationName','Organization / practice name')}{field('orgType','Organization type')}{field('country','Country','text',false)}{field('timezone','Time zone','text',false)}
      <div><label className="text-sm font-medium" htmlFor="plan">Plan</label><select id="plan" value={f.planSlug} onChange={e=>setF({...f,planSlug:e.target.value})} className="mt-1 w-full border rounded-lg px-3 py-2"><option value="starter">Starter (trial)</option><option value="professional">Professional (trial)</option><option value="enterprise">Enterprise</option></select></div>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={f.acceptedTerms} onChange={e=>setF({...f,acceptedTerms:e.target.checked})} required/> <span>I accept the <Link href="/legal/terms" className="text-blue-600">Terms</Link> and <Link href="/legal/privacy" className="text-blue-600">Privacy Policy</Link></span></label>
      <button className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg font-semibold">Create account &amp; start trial</button>
      {msg && <p role="status" className="text-sm">{msg}</p>}
      <p className="text-sm">Already registered? <Link href="/login" className="text-blue-600">Sign in</Link> · <Link href="/verify-email" className="text-blue-600">Resend verification</Link></p>
    </div></form></main>;
}
export default function Page(){ return <Suspense><Inner/></Suspense>; }
