'use client';
import { useState } from 'react'; import Link from 'next/link';
export default function Page(){ const [email,setEmail]=useState(''); const [msg,setMsg]=useState('');
 return <main className="min-h-screen bg-slate-100 flex items-center justify-center p-5"><div className="bg-white rounded-2xl shadow p-8 w-full max-w-md"><Link href="/" className="font-extrabold text-[#0F2D52]">BloomAR Manager</Link><h1 className="text-2xl font-bold mt-4">Forgot password</h1><p className="text-sm text-slate-600 mt-2">We will email a single-use reset link (expires in 1 hour).</p>
 <label className="text-sm font-medium block mt-5" htmlFor="email">Email</label><input id="email" type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2"/>
 <button className="w-full mt-4 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-semibold" onClick={async()=>{const r=await fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})}); const d=await r.json(); setMsg(d.message||d.error);}}>Send reset link</button>
 {msg && <p role="status" className="text-sm mt-3">{msg}</p>}<p className="text-sm mt-4"><Link href="/login" className="text-blue-600">Back to sign in</Link></p></div></main>; }
