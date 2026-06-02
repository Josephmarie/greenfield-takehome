import React, { useState, useEffect, useRef } from "react";

// Greenfield Cardiology — multi-page web app
// Landing (with live intake call) → post-call Summary (editable) → OCR Console.
// Same design system throughout. The inbound/outbound call flows run a
// simulated lifecycle for the demo; the OCR console uploads to the live
// pipeline (OCR_BASE) and renders the real result.
const LIVE = true;
const API_BASE = "https://greenfield-voice-agent.onrender.com"; // Retell tool backend (Render)
const OCR_BASE = "https://greenfield-ocr.onrender.com";          // OCR pipeline /process (Render)

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes panelIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes ring{0%{transform:scale(.7);opacity:.7}100%{transform:scale(2.2);opacity:0}}
@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
`;
const C={paper:"#F6F4ED",card:"#FCFBF7",ink:"#1B1D1A",inkSoft:"#5A5E56",inkFaint:"#8A8E84",line:"#E4DFD2",
  teal:"#0F6E5B",tealDeep:"#0A4A3E",green:"#2F7D32",amber:"#A86A12",red:"#A6402F",
  display:"'Spectral',Georgia,serif",sans:"'IBM Plex Sans',system-ui,sans-serif",mono:"'IBM Plex Mono',ui-monospace,monospace"};
const GRAIN="data:image/svg+xml;utf8,"+encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.025'/></svg>`);

const Ekg=({color=C.teal,w=30})=>(<svg width={w} height={w*0.5} viewBox="0 0 60 30" fill="none"><path d="M0 15 H14 L19 5 L25 25 L31 15 H60" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
const PhoneWave=({color="#fff",s=15})=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M5 4h3l2 5-2 1a11 11 0 005 5l1-2 5 2v3a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/></svg>);

// ── live Retell web call ─────────────────────────────────────────────────────
// Mints a web-call token from the backend (API_BASE) and drives a real
// browser<->agent call via retell-client-js-sdk. status: idle|connecting|live|
// ended|error. transcript: [{who:"agent"|"user", text}].
function useRetellCall(){
 const[status,setStatus]=useState("idle");const[seconds,setSeconds]=useState(0);
 const[transcript,setTranscript]=useState([]);const[error,setError]=useState(null);
 const clientRef=useRef(null);const tickRef=useRef(null);
 const startTick=()=>{if(tickRef.current)return;tickRef.current=setInterval(()=>setSeconds(s=>s+1),1000);};
 const stopTick=()=>{if(tickRef.current){clearInterval(tickRef.current);tickRef.current=null;}};
 const start=async(agent)=>{
  setStatus("connecting");setError(null);setTranscript([]);setSeconds(0);
  try{
   const res=await fetch(`${API_BASE}/calls/web`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent})});
   if(!res.ok){let m=`HTTP ${res.status}`;try{const e=await res.json();if(e.detail)m=typeof e.detail==="string"?e.detail:JSON.stringify(e.detail);}catch{}throw new Error(m);}
   const {access_token}=await res.json();
   const mod=await import("retell-client-js-sdk");
   const client=new mod.RetellWebClient();clientRef.current=client;
   client.on("call_started",()=>{setStatus("live");startTick();});
   client.on("call_ended",()=>{setStatus("ended");stopTick();});
   client.on("error",(e)=>{setError((e&&(e.message||e.toString()))||"call error");setStatus("error");try{client.stopCall();}catch{}stopTick();});
   client.on("update",(u)=>{if(u&&Array.isArray(u.transcript))setTranscript(u.transcript.map(t=>({who:t.role==="agent"?"agent":"user",text:t.content})));});
   await client.startCall({accessToken:access_token});
  }catch(e){setError(e.message||"failed to start call");setStatus("error");stopTick();}
 };
 const stop=()=>{const c=clientRef.current;if(c){try{c.stopCall();}catch{}}stopTick();setStatus(s=>(s==="live"||s==="connecting")?"ended":s);};
 const reset=()=>{const c=clientRef.current;if(c){try{c.stopCall();}catch{}}stopTick();setStatus("idle");setSeconds(0);setTranscript([]);setError(null);};
 useEffect(()=>()=>{const c=clientRef.current;if(c){try{c.stopCall();}catch{}}stopTick();},[]);
 return {status,seconds,transcript,error,start,stop,reset};
}

// ── shared OCR components ────────────────────────────────────────────────────
function ConfidenceChip({confidence}){const m={high:{t:"High",c:C.green,bg:"rgba(47,125,50,.10)"},medium:{t:"Medium",c:C.amber,bg:"rgba(168,106,18,.12)"},low:{t:"Low",c:C.red,bg:"rgba(166,64,47,.12)"},missing:{t:"Missing",c:C.red,bg:"rgba(166,64,47,.12)"}}[confidence];return(<span style={{fontFamily:C.mono,fontSize:10.5,fontWeight:500,letterSpacing:".04em",textTransform:"uppercase",color:m.c,background:m.bg,padding:"2px 7px",borderRadius:4,whiteSpace:"nowrap"}}>{m.t}</span>);}
function Field({f}){const[open,setOpen]=useState(false);const missing=f.confidence==="missing"||f.value===null;return(<div style={{borderBottom:`1px solid ${C.line}`,padding:"11px 0"}}><div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:16}}><span style={{fontFamily:C.sans,fontSize:12.5,color:C.inkSoft,minWidth:150}}>{f.label}</span><span style={{flex:1}}><span style={{fontFamily:C.mono,fontSize:13.5,color:missing?C.red:C.ink,fontStyle:missing?"italic":"normal"}}>{missing?"not found":f.value}</span></span><span style={{display:"flex",alignItems:"center",gap:10}}><ConfidenceChip confidence={f.confidence}/>{f.quote&&<button onClick={()=>setOpen(!open)} style={{border:"none",background:"none",cursor:"pointer",padding:0,fontFamily:C.mono,fontSize:11,color:C.inkFaint,textDecoration:"underline",textUnderlineOffset:2}}>{open?"hide":"source"}</button>}</span></div>{open&&f.quote&&<div style={{marginTop:8,padding:"8px 11px",background:C.paper,borderLeft:`2px solid ${C.teal}`,borderRadius:"0 4px 4px 0",fontFamily:C.mono,fontSize:12,color:C.inkSoft}}>“{f.quote}”</div>}</div>);}
function LabTable({labs}){return(<div style={{border:`1px solid ${C.line}`,borderRadius:8,overflow:"hidden"}}><div style={{display:"grid",gridTemplateColumns:"1.4fr .7fr .5fr 1fr 1.3fr",background:C.paper,padding:"9px 14px",fontFamily:C.sans,fontSize:10.5,fontWeight:600,letterSpacing:".05em",textTransform:"uppercase",color:C.inkFaint}}><span>Component</span><span>Result</span><span>Unit</span><span>Reference</span><span>Status</span></div>{labs.map(l=>{const u=l.out&&!l.labFlag;return(<div key={l.c} style={{display:"grid",gridTemplateColumns:"1.4fr .7fr .5fr 1fr 1.3fr",padding:"10px 14px",alignItems:"center",borderTop:`1px solid ${C.line}`,background:l.out?"rgba(166,64,47,.04)":C.card}}><span style={{fontFamily:C.sans,fontSize:13,color:C.ink,fontWeight:l.out?600:400}}>{l.c}</span><span style={{fontFamily:C.mono,fontSize:13,color:l.out?C.red:C.ink}}>{l.v}</span><span style={{fontFamily:C.mono,fontSize:11.5,color:C.inkFaint}}>{l.unit}</span><span style={{fontFamily:C.mono,fontSize:12,color:C.inkSoft}}>{l.range}</span><span>{l.out?(<span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{fontFamily:C.mono,fontSize:11,fontWeight:500,color:C.red,background:"rgba(166,64,47,.12)",padding:"1px 6px",borderRadius:4}}>{l.computed==="H"?"High":"Low"}</span>{u&&<span title="Out of range by our computation; lab printed no flag" style={{fontFamily:C.mono,fontSize:10,color:C.amber,fontStyle:"italic"}}>lab unflagged</span>}</span>):<span style={{fontFamily:C.mono,fontSize:11.5,color:C.green}}>in range</span>}</span></div>);})}</div>);}
function DenyBackCard({patient,missing}){return(<div style={{position:"relative",marginTop:6,padding:"22px 24px",background:C.card,border:`1px solid ${C.line}`,borderRadius:8}}><div style={{position:"absolute",top:16,right:16,transform:"rotate(6deg)",border:`2px solid ${C.red}`,color:C.red,fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:".08em",padding:"4px 9px",borderRadius:5,opacity:.85}}>HELD · NOT SCHEDULED</div><div style={{fontFamily:C.display,fontSize:17}}>Greenfield Cardiology</div><div style={{fontFamily:C.mono,fontSize:11,color:C.inkFaint,marginBottom:16}}>450 Market Street, Suite 300, San Francisco, CA 94105 · Fax 415-555-0121</div><div style={{fontFamily:C.sans,fontSize:13,marginBottom:4}}><strong>Re:</strong> Incomplete referral — {patient}</div><p style={{fontFamily:C.sans,fontSize:13,color:C.inkSoft,lineHeight:1.6,margin:"10px 0"}}>We are unable to process this referral as received because the following required field(s) are missing or could not be verified:</p><ul style={{margin:"10px 0",paddingLeft:0,listStyle:"none"}}>{missing.map(m=><li key={m} style={{fontFamily:C.mono,fontSize:13,color:C.red,padding:"3px 0"}}>— {m}</li>)}</ul><p style={{fontFamily:C.sans,fontSize:13,color:C.inkSoft,lineHeight:1.6,margin:"10px 0 0"}}>Please resubmit with the item(s) above completed and we will schedule the patient promptly.</p></div>);}
const DISPOSITION={cleared:{label:"Cleared",color:C.green},flagged:{label:"Flagged",color:C.amber},held:{label:"Held — deny-back",color:C.red}};
function Disposition({d}){const x=DISPOSITION[d];return(<span style={{display:"inline-flex",alignItems:"center",gap:7,fontFamily:C.sans,fontSize:12,fontWeight:600,color:x.color,background:`${x.color}14`,padding:"5px 11px",borderRadius:20}}><span style={{width:7,height:7,borderRadius:"50%",background:x.color}}/>{x.label}</span>);}
const ST=({children})=>(<div style={{fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:".09em",textTransform:"uppercase",color:C.inkFaint,margin:"26px 0 12px"}}>{children}</div>);

// ── lightweight invite-code auth ─────────────────────────────────────────────
// Valid codes come from build-time Vite env vars (VITE_CODE_JOSEPH / _VARUNI).
const INVITE_CODES={joseph:import.meta.env.VITE_CODE_JOSEPH,varuni:import.meta.env.VITE_CODE_VARUNI};
const AUTH_KEY="gc_auth";
function checkCode(code){const c=(code||"").trim();for(const [user,valid] of Object.entries(INVITE_CODES)){if(valid&&c===valid)return user;}return null;}
function loadAuth(){try{const a=JSON.parse(localStorage.getItem(AUTH_KEY)||"null");return (a&&a.user&&a.token)?a:null;}catch{return null;}}

// ── map persisted DB rows <-> the OCR result shape UploadedResult renders ─────
function runDisposition(r){if(r.deny_back_letter)return "held";if(r.pushed_downstream)return "cleared";return "flagged";}
function runToResult(r){return {source:r.filename,classification:{doc_type:r.doc_type,confidence:r.classification_confidence},extracted:r.extracted_fields,review_queue:r.review_queue||[],deny_back_letter:r.deny_back_letter,pushed_downstream:r.pushed_downstream};}
function runPhone(r){const p=r&&r.extracted_fields&&r.extracted_fields.phone;return (p&&typeof p==="object")?p.value:(typeof p==="string"?p:null);}


// inbound booking call script + the record it produces
const BOOKING=[
 {at:0,status:"connecting"},
 {at:900,status:"live",line:{who:"agent",text:"Thank you for calling Greenfield Cardiology, how can I help you today?"}},
 {at:3200,line:{who:"caller",text:"Hi, I'd like to book a follow-up with Dr. Chen."}},
 {at:5200,line:{who:"agent",text:"Happy to help. May I have your full name?"}},
 {at:7000,line:{who:"caller",text:"Linda Alvarez."}},
 {at:8600,line:{who:"agent",text:"Thank you. And what is your date of birth?"}},
 {at:10200,line:{who:"caller",text:"March 14th, 1972."}},
 {at:11800,line:{who:"agent",text:"What's the reason for the visit?"}},
 {at:13600,line:{who:"caller",text:"A routine follow-up for my blood pressure."}},
 {at:15600,line:{who:"agent",text:"Dr. Chen is in our San Francisco office Monday, Wednesday and Friday. I have Wednesday, June 3rd at 10 AM — shall I book that?"}},
 {at:18600,line:{who:"caller",text:"Yes, that works."}},
 {at:20200,status:"ended",line:{who:"agent",text:"You're booked with Dr. Chen, Wednesday June 3rd at 10 AM, 450 Market Street. Your confirmation is GC-40192. Take care."}},
];
const CAPTURED={outcome:"Appointment booked",confirmation:"GC-40192",
  fields:{patient_name:"Linda Alvarez",dob:"03/14/1972",reason:"Routine follow-up — blood pressure",provider:"Dr. Sarah Chen",location:"San Francisco — 450 Market Street, Suite 300",slot:"Wednesday, June 3, 2026 · 10:00 AM",insurance:"Aetna PPO — pending verification"}};

const CALL_STATUS={connecting:{t:"Connecting",c:C.amber},dialing:{t:"Dialing",c:C.amber},ringing:{t:"Ringing",c:C.amber},live:{t:"Live",c:C.green},voicemail:{t:"Voicemail",c:C.teal},ended:{t:"Call ended",c:C.inkFaint}};

// ── Nav ──────────────────────────────────────────────────────────────────────
function Nav({page,go,auth,onLogout}){const link=(id,label)=>(<button onClick={()=>go(id)} style={{border:"none",background:"none",cursor:"pointer",fontFamily:C.sans,fontSize:13,fontWeight:600,color:page===id?C.tealDeep:C.inkSoft,padding:"6px 2px",borderBottom:`2px solid ${page===id?C.teal:"transparent"}`}}>{label}</button>);
 return(<header style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 34px",borderBottom:`1px solid ${C.line}`,background:"rgba(252,251,247,.8)",backdropFilter:"blur(6px)",position:"sticky",top:0,zIndex:20}}>
  <button onClick={()=>go("home")} style={{display:"flex",alignItems:"center",gap:12,border:"none",background:"none",cursor:"pointer"}}><div style={{width:36,height:36,borderRadius:9,background:C.tealDeep,display:"flex",alignItems:"center",justifyContent:"center"}}><Ekg color="#EAF3EF" w={22}/></div><span style={{fontFamily:C.display,fontSize:18,fontWeight:600,color:C.ink}}>Greenfield Cardiology</span></button>
  <nav style={{display:"flex",gap:22,alignItems:"center"}}>{link("home","Home")}{link("console","Dashboard")}
   {auth&&<div style={{display:"flex",alignItems:"center",gap:11,marginLeft:6,paddingLeft:18,borderLeft:`1px solid ${C.line}`}}>
    <span style={{display:"inline-flex",alignItems:"center",gap:7,fontFamily:C.mono,fontSize:12,color:C.inkSoft}}><span style={{width:6,height:6,borderRadius:"50%",background:C.green}}/>{auth.user}</span>
    <button onClick={onLogout} style={{fontFamily:C.sans,fontSize:12.5,fontWeight:600,color:C.tealDeep,background:"none",border:`1px solid ${C.line}`,borderRadius:8,padding:"6px 12px",cursor:"pointer"}}>Log out</button>
   </div>}
  </nav>
 </header>);
}

// ── Landing ──────────────────────────────────────────────────────────────────
function Landing({onCall,go}){
 const feats=[["Always answers","24/7 scheduling, follow-ups, and insurance questions — no hold music."],["Emergency-aware","Recognizes red-flag symptoms and advises 911 immediately — never books them."],["Referral callbacks","Calls referred patients back, up to 3 attempts, with PHI-free voicemails."],["Fax intake","Reads referrals, insurance cards, and labs — flags anything uncertain for staff."]];
 return(<div style={{animation:"fadeUp .5s ease both"}}>
  <section style={{display:"grid",gridTemplateColumns:"1.1fr .9fr",gap:40,alignItems:"center",padding:"70px 60px 50px",maxWidth:1180,margin:"0 auto"}}>
   <div>
    <div style={{display:"inline-flex",alignItems:"center",gap:8,fontFamily:C.mono,fontSize:11.5,letterSpacing:".05em",color:C.teal,background:"rgba(15,110,91,.08)",padding:"5px 11px",borderRadius:20,marginBottom:22}}><span style={{width:6,height:6,borderRadius:"50%",background:C.green,animation:"pulse 1.4s ease infinite"}}/>Front desk · online now</div>
    <h1 style={{fontFamily:C.display,fontSize:52,fontWeight:600,lineHeight:1.04,margin:"0 0 18px",letterSpacing:"-0.01em"}}>Care that answers on the <span style={{fontStyle:"italic",color:C.teal}}>first ring.</span></h1>
    <p style={{fontFamily:C.sans,fontSize:16.5,lineHeight:1.6,color:C.inkSoft,maxWidth:480,margin:"0 0 30px"}}>Greenfield Cardiology's AI front desk schedules visits, verifies insurance, handles referrals, and knows when to send you straight to 911. Talk to it now.</p>
    <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
     <button onClick={onCall} style={{display:"inline-flex",alignItems:"center",gap:9,fontFamily:C.sans,fontSize:15,fontWeight:600,color:"#fff",background:C.tealDeep,border:"none",borderRadius:10,padding:"14px 24px",cursor:"pointer",boxShadow:"0 6px 20px rgba(10,74,62,.22)"}}><PhoneWave/>Talk to the front desk on the web</button>
     <button onClick={()=>go("console")} style={{fontFamily:C.sans,fontSize:15,fontWeight:600,color:C.tealDeep,background:"none",border:`1px solid ${C.line}`,borderRadius:10,padding:"14px 22px",cursor:"pointer"}}>View intake console</button>
    </div>
    <a href="tel:+14156504518"
       onMouseEnter={e=>{e.currentTarget.style.borderColor=C.teal;e.currentTarget.style.boxShadow="0 6px 22px rgba(10,74,62,.10)";e.currentTarget.style.transform="translateY(-1px)";}}
       onMouseLeave={e=>{e.currentTarget.style.borderColor=C.line;e.currentTarget.style.boxShadow="none";e.currentTarget.style.transform="none";}}
       style={{marginTop:18,display:"inline-flex",alignItems:"center",gap:13,textDecoration:"none",background:C.card,border:`1px solid ${C.line}`,borderRadius:12,padding:"10px 18px 10px 12px",transition:"all .18s ease"}}>
     <span style={{width:40,height:40,borderRadius:"50%",background:"rgba(15,110,91,.10)",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><PhoneWave color={C.tealDeep} s={18}/></span>
     <span style={{display:"flex",flexDirection:"column",lineHeight:1.25}}>
      <span style={{fontFamily:C.sans,fontSize:10.5,fontWeight:600,letterSpacing:".07em",textTransform:"uppercase",color:C.inkFaint}}>Or call the front desk</span>
      <span style={{fontFamily:C.mono,fontSize:18,fontWeight:500,color:C.tealDeep,letterSpacing:".01em"}}>+1 (415) 650-4518</span>
     </span>
    </a>
    <div style={{marginTop:10,fontFamily:C.sans,fontSize:12,color:C.inkFaint}}>Same AI front desk, by phone · Mon–Fri 8am–5pm PT</div>
   </div>
   <div style={{position:"relative",height:340,display:"flex",alignItems:"center",justifyContent:"center"}}>
    {[0,1,2].map(i=>(<div key={i} style={{position:"absolute",width:150,height:150,borderRadius:"50%",border:`1.5px solid ${C.teal}`,animation:`ring 3s ease-out ${i*1}s infinite`}}/>))}
    <div style={{width:150,height:150,borderRadius:"50%",background:C.tealDeep,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 12px 40px rgba(10,74,62,.28)",zIndex:1}}><Ekg color="#EAF3EF" w={70}/></div>
   </div>
  </section>
  <section style={{borderTop:`1px solid ${C.line}`,background:C.card}}>
   <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:0,maxWidth:1180,margin:"0 auto"}}>
    {feats.map(([t,d],i)=>(<div key={t} style={{padding:"30px 26px",borderRight:i<3?`1px solid ${C.line}`:"none"}}><div style={{fontFamily:C.display,fontSize:17,fontWeight:600,marginBottom:8}}>{t}</div><div style={{fontFamily:C.sans,fontSize:13,lineHeight:1.55,color:C.inkSoft}}>{d}</div></div>))}
   </div>
  </section>
  <footer style={{padding:"34px 60px",maxWidth:1180,margin:"0 auto",display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:20}}>
   {[["San Francisco — Main","450 Market Street, Suite 300","San Francisco, CA 94105 · 415-555-0120"],["Oakland — Satellite","2800 Broadway, Suite 110","Oakland, CA 94611 · 510-555-0234"]].map(([a,b,c])=>(<div key={a}><div style={{fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:".06em",textTransform:"uppercase",color:C.teal,marginBottom:6}}>{a}</div><div style={{fontFamily:C.mono,fontSize:12.5,color:C.inkSoft,lineHeight:1.6}}>{b}<br/>{c}</div></div>))}
   <div style={{fontFamily:C.mono,fontSize:11,color:C.inkFaint,alignSelf:"flex-end"}}>Mon–Fri · 8am–5pm PT</div>
  </footer>
 </div>);
}

// ── Call screen (inbound) ────────────────────────────────────────────────────
// Presentational call UI; driven by either the simulated timeline (CallScreen)
// or a real Retell web call (LiveCallScreen).
function CallView({statusKey,secs,tr,ended,error,onCancel,onEnd,endLabel}){
 const s=CALL_STATUS[statusKey]||CALL_STATUS.connecting;const mm=String(Math.floor(secs/60)).padStart(2,"0");const ss=String(secs%60).padStart(2,"0");
 const bodyRef=useRef(null);
 useEffect(()=>{if(bodyRef.current)bodyRef.current.scrollTop=bodyRef.current.scrollHeight;},[tr.length]);
 return(<div style={{minHeight:"calc(100vh - 69px)",display:"flex",flexDirection:"column",alignItems:"center",padding:"40px 20px 60px",animation:"panelIn .35s ease both"}}>
  <div style={{position:"relative",width:150,height:150,display:"flex",alignItems:"center",justifyContent:"center",marginTop:20}}>
   {!ended&&[0,1].map(i=>(<div key={i} style={{position:"absolute",width:110,height:110,borderRadius:"50%",border:`1.5px solid ${s.c}`,animation:`ring 2.4s ease-out ${i*1.2}s infinite`}}/>))}
   <div style={{width:110,height:110,borderRadius:"50%",background:C.tealDeep,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1}}><Ekg color="#EAF3EF" w={54}/></div>
  </div>
  <div style={{display:"flex",alignItems:"center",gap:9,marginTop:22}}><span style={{width:9,height:9,borderRadius:"50%",background:s.c,animation:ended?"none":"pulse 1.4s ease infinite"}}/><span style={{fontFamily:C.sans,fontSize:14,fontWeight:600,color:s.c}}>{s.t}</span><span style={{fontFamily:C.mono,fontSize:13,color:C.inkFaint,marginLeft:6}}>{mm}:{ss}</span></div>
  {error&&<div style={{marginTop:10,fontFamily:C.mono,fontSize:12,color:C.red,maxWidth:480,textAlign:"center",wordBreak:"break-word"}}>{error}</div>}
  {!error&&statusKey==="connecting"&&<div style={{marginTop:8,fontFamily:C.sans,fontSize:12.5,color:C.inkFaint}}>Allow microphone access when prompted…</div>}
  <div ref={bodyRef} style={{width:"100%",maxWidth:560,marginTop:30,maxHeight:"42vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:14}}>
   {tr.map((t,i)=>(<div key={i} style={{alignSelf:t.who==="agent"?"flex-start":"flex-end",maxWidth:"82%",animation:"fadeUp .25s ease both"}}>
    <div style={{fontFamily:C.sans,fontSize:9.5,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:t.who==="agent"?C.teal:C.inkFaint,marginBottom:3,textAlign:t.who==="agent"?"left":"right"}}>{t.who==="agent"?"Front desk":"You"}</div>
    <div style={{fontFamily:C.sans,fontSize:14,lineHeight:1.5,color:C.ink,background:t.who==="agent"?C.card:"rgba(15,110,91,.08)",border:`1px solid ${t.who==="agent"?C.line:"rgba(15,110,91,.2)"}`,padding:"10px 14px",borderRadius:12}}>{t.text}</div>
   </div>))}
   {tr.length===0&&!error&&<div style={{fontFamily:C.sans,fontSize:13,color:C.inkFaint,textAlign:"center",marginTop:8}}>{statusKey==="live"?"Connected — go ahead and speak.":""}</div>}
  </div>
  <div style={{marginTop:30,display:"flex",gap:12}}>
   {!ended?(<button onClick={onCancel} style={{fontFamily:C.sans,fontSize:14,fontWeight:600,color:"#fff",background:C.red,border:"none",borderRadius:10,padding:"12px 28px",cursor:"pointer"}}>End call</button>)
   :(<button onClick={onEnd} style={{fontFamily:C.sans,fontSize:14,fontWeight:600,color:"#fff",background:C.tealDeep,border:"none",borderRadius:10,padding:"12px 28px",cursor:"pointer"}}>{endLabel}</button>)}
  </div>
 </div>);
}

// Simulated inbound call (demo lifecycle from BOOKING).
function CallScreen({onFinish,onCancel}){
 const[status,setStatus]=useState("connecting");const[secs,setSecs]=useState(0);const[tr,setTr]=useState([]);
 const timers=useRef([]);const tick=useRef(null);
 useEffect(()=>{
  tick.current=setInterval(()=>setSecs(s=>s+1),1000);
  BOOKING.forEach(step=>timers.current.push(setTimeout(()=>{if(step.status)setStatus(step.status);if(step.line)setTr(t=>[...t,step.line]);if(step.status==="ended"&&tick.current){clearInterval(tick.current);tick.current=null;}},step.at)));
  return()=>{timers.current.forEach(clearTimeout);if(tick.current)clearInterval(tick.current);};
 },[]);
 const ended=status==="ended";const mm=String(Math.floor(secs/60)).padStart(2,"0");const ss=String(secs%60).padStart(2,"0");
 return <CallView statusKey={status} secs={secs} tr={tr} ended={ended} onCancel={onCancel} onEnd={()=>onFinish({...CAPTURED,durationLabel:`${mm}:${ss}`,transcript:tr})} endLabel="View call summary →"/>;
}

// Real browser web call to the front-desk agent (mic, no phone).
function LiveCallScreen({onExit}){
 const call=useRetellCall();
 useEffect(()=>{call.start("front_desk");return()=>call.reset();},[]);
 const map={idle:"connecting",connecting:"connecting",live:"live",ended:"ended",error:"ended"};
 const ended=call.status==="ended"||call.status==="error";
 return <CallView statusKey={map[call.status]||"connecting"} secs={call.seconds} tr={call.transcript} ended={ended} error={call.error}
   onCancel={()=>call.stop()} onEnd={onExit} endLabel="Done"/>;
}

// ── Summary (editable) ───────────────────────────────────────────────────────
function EditableRow({label,value,onChange,flag}){return(<div style={{display:"grid",gridTemplateColumns:"180px 1fr",gap:16,alignItems:"center",padding:"12px 0",borderBottom:`1px solid ${C.line}`}}>
  <span style={{fontFamily:C.sans,fontSize:12.5,color:C.inkSoft}}>{label}</span>
  <div style={{display:"flex",alignItems:"center",gap:10}}>
   <input value={value} onChange={e=>onChange(e.target.value)} style={{flex:1,fontFamily:C.mono,fontSize:13.5,color:C.ink,background:C.card,border:`1px solid ${C.line}`,borderRadius:7,padding:"9px 12px",outline:"none"}} onFocus={e=>e.target.style.borderColor=C.teal} onBlur={e=>e.target.style.borderColor=C.line}/>
   {flag&&<span style={{fontFamily:C.mono,fontSize:10.5,color:C.amber,background:"rgba(168,106,18,.12)",padding:"3px 8px",borderRadius:5,whiteSpace:"nowrap"}}>{flag}</span>}
  </div>
 </div>);}
function Summary({captured,go}){
 const[f,setF]=useState(captured.fields);const[saved,setSaved]=useState(false);const[openT,setOpenT]=useState(false);
 const set=(k,v)=>{setF(p=>({...p,[k]:v}));setSaved(false);};
 const rows=[["patient_name","Patient name"],["dob","Date of birth"],["reason","Reason for visit"],["provider","Provider"],["location","Location"],["slot","Appointment"],["insurance","Insurance",f.insurance.includes("pending")?"Verify before visit":null]];
 return(<div style={{maxWidth:760,margin:"0 auto",padding:"34px 30px 60px",animation:"panelIn .35s ease both"}}>
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}>
   <div><div style={{fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.teal,marginBottom:6}}>Call summary · {captured.durationLabel||"01:20"}</div><h1 style={{fontFamily:C.display,fontSize:30,fontWeight:600,margin:0}}>Review & confirm</h1></div>
   <span style={{display:"inline-flex",alignItems:"center",gap:7,fontFamily:C.sans,fontSize:12.5,fontWeight:600,color:C.green,background:"rgba(47,125,50,.10)",padding:"7px 13px",borderRadius:20}}><span style={{width:7,height:7,borderRadius:"50%",background:C.green}}/>{captured.outcome}</span>
  </div>
  <div style={{marginTop:18,padding:"12px 16px",background:C.card,border:`1px solid ${C.line}`,borderRadius:9,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
   <span style={{fontFamily:C.sans,fontSize:13,color:C.inkSoft}}>Confirmation</span><span style={{fontFamily:C.mono,fontSize:14,color:C.teal,fontWeight:500}}>{captured.confirmation}</span>
  </div>
  <ST>Captured from the call — edit if needed</ST>
  <div>{rows.map(([k,label,flag])=><EditableRow key={k} label={label} value={f[k]} onChange={v=>set(k,v)} flag={flag}/>)}</div>
  <div style={{marginTop:18}}><button onClick={()=>setOpenT(!openT)} style={{border:"none",background:"none",cursor:"pointer",fontFamily:C.sans,fontSize:12.5,fontWeight:600,color:C.tealDeep}}>{openT?"Hide":"Show"} full transcript</button>
   {openT&&<div style={{marginTop:12,border:`1px solid ${C.line}`,borderRadius:9,padding:"14px 16px",background:C.card,display:"flex",flexDirection:"column",gap:10}}>{(captured.transcript||[]).map((t,i)=>(<div key={i}><span style={{fontFamily:C.sans,fontSize:9.5,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:t.who==="agent"?C.teal:C.inkFaint}}>{t.who==="agent"?"Front desk":"Caller"}</span><div style={{fontFamily:C.sans,fontSize:13,color:C.ink,lineHeight:1.5}}>{t.text}</div></div>))}</div>}
  </div>
  <div style={{marginTop:28,display:"flex",gap:12,alignItems:"center"}}>
   <button onClick={()=>setSaved(true)} style={{fontFamily:C.sans,fontSize:14,fontWeight:600,color:"#fff",background:C.tealDeep,border:"none",borderRadius:9,padding:"12px 22px",cursor:"pointer"}}>Confirm & save</button>
   <button onClick={()=>go("console")} style={{fontFamily:C.sans,fontSize:14,fontWeight:600,color:C.tealDeep,background:"none",border:`1px solid ${C.line}`,borderRadius:9,padding:"12px 20px",cursor:"pointer"}}>Go to intake console →</button>
   {saved&&<span style={{fontFamily:C.sans,fontSize:13,color:C.green,animation:"toastIn .3s ease both"}}>✓ Saved to patient record</span>}
  </div>
 </div>);
}

// ── OCR console (with outbound call dock) ────────────────────────────────────
function CallDock({call,onEnd}){const s=CALL_STATUS[call.status]||CALL_STATUS.dialing;const mm=String(Math.floor(call.seconds/60)).padStart(2,"0");const ss=String(call.seconds%60).padStart(2,"0");const b=useRef(null);useEffect(()=>{if(b.current)b.current.scrollTop=b.current.scrollHeight;},[call.transcript.length]);
 return(<div style={{position:"fixed",right:26,bottom:26,width:360,background:C.card,border:`1px solid ${C.line}`,borderRadius:14,boxShadow:"0 12px 40px rgba(10,74,62,.18)",overflow:"hidden",zIndex:50,animation:"fadeUp .3s ease both"}}>
  <div style={{padding:"14px 18px",background:C.tealDeep,display:"flex",alignItems:"center",justifyContent:"space-between"}}><span style={{display:"flex",alignItems:"center",gap:9}}><Ekg color="#EAF3EF" w={22}/><span style={{fontFamily:C.sans,fontSize:13,fontWeight:600,color:"#EAF3EF"}}>Outbound callback</span></span><span style={{fontFamily:C.mono,fontSize:12,color:"#BFE0D6"}}>{mm}:{ss}</span></div>
  <div style={{padding:"10px 18px",display:"flex",alignItems:"center",gap:8,borderBottom:`1px solid ${C.line}`}}><span style={{width:8,height:8,borderRadius:"50%",background:s.c,animation:call.status==="ended"?"none":"pulse 1.4s ease infinite"}}/><span style={{fontFamily:C.sans,fontSize:12.5,fontWeight:600,color:s.c}}>{s.t}</span>{call.to&&<span style={{fontFamily:C.mono,fontSize:11.5,color:C.inkFaint,marginLeft:"auto"}}>{call.to}</span>}</div>
  {call.error&&<div style={{padding:"8px 18px",fontFamily:C.mono,fontSize:11,color:C.red,wordBreak:"break-word"}}>{call.error}</div>}
  {!call.error&&call.status==="connecting"&&<div style={{padding:"8px 18px",fontFamily:C.sans,fontSize:11.5,color:C.inkFaint}}>Allow microphone access when prompted…</div>}
  <div ref={b} style={{maxHeight:200,overflowY:"auto",padding:"12px 18px",display:"flex",flexDirection:"column",gap:10}}>{call.transcript.map((t,i)=>{const sys=t.who==="system";return(<div key={i} style={{animation:"fadeUp .25s ease both"}}>{!sys&&<div style={{fontFamily:C.sans,fontSize:9.5,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:t.who==="agent"?C.teal:C.inkFaint,marginBottom:2}}>{t.who==="agent"?"Agent":"Caller"}</div>}<div style={{fontFamily:sys?C.mono:C.sans,fontSize:sys?11.5:13,color:sys?C.amber:C.ink,fontStyle:sys?"italic":"normal",lineHeight:1.5}}>{t.text}</div></div>);})}</div>
  <div style={{padding:"12px 18px",borderTop:`1px solid ${C.line}`}}><button onClick={onEnd} style={{width:"100%",fontFamily:C.sans,fontSize:13,fontWeight:600,color:call.status==="ended"?C.inkSoft:"#fff",background:call.status==="ended"?C.paper:C.red,border:call.status==="ended"?`1px solid ${C.line}`:"none",borderRadius:8,padding:"10px",cursor:"pointer"}}>{call.status==="ended"?"Close":"End call"}</button></div>
 </div>);
}
const OUTBOUND=[{at:0,status:"dialing"},{at:1000,status:"ringing"},{at:3200,status:"voicemail",line:{who:"system",text:"Voicemail detected — leaving PHI-free message only"}},{at:4400,line:{who:"agent",text:"This is a message from Greenfield Cardiology. Please call us back at 415-555-0120. Thank you."}},{at:7600,status:"ended",line:{who:"system",text:"Attempt 1 of 3 logged · next attempt eligible in 48 hours"}}];
// ── live OCR result rendering helpers ────────────────────────────────────────
const prettyLabel=k=>String(k).replace(/_/g," ").replace(/\b\w/g,m=>m.toUpperCase());
const KNOWN_CONF={high:1,medium:1,low:1,missing:1};
const normConf=(conf,val)=>(val===null||val===undefined||val==="")?"missing":(KNOWN_CONF[conf]?conf:"medium");
const isFieldObj=v=>v&&typeof v==="object"&&!Array.isArray(v)&&("value" in v||"confidence" in v||"source_quote" in v);
const isLabAnalyte=x=>x&&typeof x==="object"&&("reference_range" in x||"computed_flag" in x||("name" in x&&"value" in x));
// Map a pipeline analyte to the shape LabTable expects.
const mapLab=a=>({c:a.name,v:a.value,unit:a.unit,range:a.reference_range,out:a.in_range===false,computed:a.computed_flag,labFlag:!!a.lab_reported_flag,quote:a.source_quote});

// Renders the live result returned by the OCR pipeline's POST /process.
function UploadedResult({result,onClear}){
 const c=result.classification||{};
 const conf=typeof c.confidence==="number"?c.confidence:null;
 const ext=result.extracted||{};
 const review=result.review_queue||[];
 const fieldRows=[],labGroups=[],otherRows=[];
 for(const [k,v] of Object.entries(ext)){
  if(Array.isArray(v)&&v.length&&isLabAnalyte(v[0]))labGroups.push([k,v]);
  else if(isFieldObj(v))fieldRows.push({label:prettyLabel(k),value:v.value,confidence:normConf(v.confidence,v.value),quote:v.source_quote});
  else if(Array.isArray(v))otherRows.push([prettyLabel(k),v.join(", ")]);
  else if(v&&typeof v==="object")otherRows.push([prettyLabel(k),JSON.stringify(v)]);
  else otherRows.push([prettyLabel(k),v]);
 }
 return(<div style={{animation:"panelIn .3s ease both"}}>
  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:20}}>
   <div><div style={{fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.teal,marginBottom:6}}>Uploaded · live pipeline</div>
    <h1 style={{fontFamily:C.display,fontSize:26,fontWeight:600,margin:0,wordBreak:"break-all"}}>{result.source||"document"}</h1></div>
   {onClear&&<button onClick={onClear} style={{fontFamily:C.sans,fontSize:12,fontWeight:600,color:C.tealDeep,background:"none",border:`1px solid ${C.line}`,borderRadius:8,padding:"8px 12px",cursor:"pointer",whiteSpace:"nowrap"}}>← Back to samples</button>}
  </div>
  <div style={{display:"flex",alignItems:"center",gap:14,marginTop:18,padding:"14px 18px",background:C.card,border:`1px solid ${C.line}`,borderRadius:9}}>
   <span style={{fontFamily:C.sans,fontSize:12,color:C.inkSoft}}>Classified as</span>
   <span style={{fontFamily:C.display,fontSize:15,fontWeight:600}}>{c.doc_type||"uncertain"}</span>
   {conf!==null&&<><div style={{flex:1,height:6,background:C.paper,borderRadius:3,overflow:"hidden",marginLeft:8}}><div style={{width:`${conf*100}%`,height:"100%",background:C.teal,borderRadius:3}}/></div>
   <span style={{fontFamily:C.mono,fontSize:13,color:C.teal,fontWeight:500}}>{(conf*100).toFixed(0)}%</span></>}
  </div>
  {result.halt_reason&&<div style={{marginTop:14,padding:"12px 16px",background:"rgba(168,106,18,.08)",border:`1px solid rgba(168,106,18,.3)`,borderRadius:9,fontFamily:C.sans,fontSize:13,color:C.amber}}>{result.halt_reason}</div>}
  {(fieldRows.length>0||otherRows.length>0)&&(<><ST>Extracted fields</ST>
   <div>{fieldRows.map((f,i)=><Field key={"f"+i} f={f}/>)}
    {otherRows.map(([k,v],i)=>(<div key={"o"+i} style={{display:"grid",gridTemplateColumns:"180px 1fr",gap:16,padding:"11px 0",borderBottom:`1px solid ${C.line}`,alignItems:"baseline"}}><span style={{fontFamily:C.sans,fontSize:12.5,color:C.inkSoft}}>{k}</span><span style={{fontFamily:C.mono,fontSize:13.5,color:(v===null||v===undefined||v==="")?C.red:C.ink,fontStyle:(v===null||v===undefined||v==="")?"italic":"normal",wordBreak:"break-word"}}>{(v===null||v===undefined||v==="")?"not found":String(v)}</span></div>))}</div></>)}
  {labGroups.map(([k,arr])=>(<React.Fragment key={"lab"+k}><ST>{k==="test_values"?"Test results":prettyLabel(k)}</ST><LabTable labs={arr.map(mapLab)}/></React.Fragment>))}
  <ST>Human review queue {review.length>0&&<span style={{fontFamily:C.mono,fontSize:12,color:C.red}}>({review.length})</span>}</ST>
  {review.length===0?(<div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",background:"rgba(47,125,50,.06)",border:`1px solid rgba(47,125,50,.2)`,borderRadius:9}}><span style={{width:8,height:8,borderRadius:"50%",background:C.green}}/><span style={{fontFamily:C.sans,fontSize:13}}>Nothing flagged — all fields extracted cleanly.</span></div>):(<div style={{border:`1px solid ${C.line}`,borderRadius:9,overflow:"hidden"}}>{review.map((r,i)=>(<div key={i} style={{display:"flex",gap:14,padding:"13px 16px",alignItems:"baseline",borderTop:i?`1px solid ${C.line}`:"none",background:C.card}}><span style={{fontFamily:C.mono,fontSize:13,color:C.red,fontWeight:500,minWidth:140,wordBreak:"break-word"}}>{String(r.field||"").replace(/^lab:/,"")}</span><span style={{fontFamily:C.sans,fontSize:12.5,color:C.inkSoft}}>{r.reason||r.status}</span></div>))}</div>)}
  {result.deny_back_letter&&(<><ST>Deny-back letter</ST>
   <div style={{position:"relative",marginTop:6,padding:"26px 28px",background:C.card,border:`1px solid ${C.line}`,borderRadius:8,boxShadow:"0 1px 2px rgba(10,74,62,.04)"}}>
    <div style={{position:"absolute",top:18,right:18,transform:"rotate(6deg)",border:`2px solid ${C.red}`,color:C.red,fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:".08em",padding:"4px 9px",borderRadius:5,opacity:.85}}>HELD · NOT SCHEDULED</div>
    <div style={{fontFamily:C.sans,fontSize:13,color:C.ink,lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-word",maxWidth:620}}>{result.deny_back_letter}</div>
   </div></>)}
  <div style={{marginTop:22,display:"inline-flex",alignItems:"center",gap:8,fontFamily:C.sans,fontSize:12.5,fontWeight:600,color:result.pushed_downstream?C.green:C.amber,background:result.pushed_downstream?"rgba(47,125,50,.10)":"rgba(168,106,18,.12)",padding:"7px 13px",borderRadius:20}}>
   <span style={{width:7,height:7,borderRadius:"50%",background:result.pushed_downstream?C.green:C.amber}}/>{result.pushed_downstream?"Pushed downstream":"Held for human review"}</div>
  <div style={{height:60}}/>
 </div>);
}


// ── Login (invite code) ──────────────────────────────────────────────────────
function Login({onAuth}){
 const[code,setCode]=useState("");const[err,setErr]=useState(null);
 const submit=(e)=>{if(e)e.preventDefault();const user=checkCode(code);if(!user){setErr("That invite code isn't valid.");return;}const auth={user,token:code.trim()};localStorage.setItem(AUTH_KEY,JSON.stringify(auth));onAuth(auth);};
 return(<div style={{minHeight:"100vh",background:C.paper,color:C.ink,backgroundImage:`url("${GRAIN}")`,backgroundSize:"120px 120px",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
  <style>{FONTS}</style>
  <form onSubmit={submit} style={{width:"100%",maxWidth:380,background:C.card,border:`1px solid ${C.line}`,borderRadius:16,padding:"34px 32px",boxShadow:"0 12px 40px rgba(10,74,62,.10)",animation:"panelIn .4s ease both"}}>
   <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:22}}><div style={{width:40,height:40,borderRadius:10,background:C.tealDeep,display:"flex",alignItems:"center",justifyContent:"center"}}><Ekg color="#EAF3EF" w={24}/></div><span style={{fontFamily:C.display,fontSize:19,fontWeight:600}}>Greenfield Cardiology</span></div>
   <h1 style={{fontFamily:C.display,fontSize:24,fontWeight:600,margin:"0 0 6px"}}>Staff sign-in</h1>
   <p style={{fontFamily:C.sans,fontSize:13.5,color:C.inkSoft,margin:"0 0 22px",lineHeight:1.5}}>Enter your invite code to access the intake dashboard.</p>
   <input autoFocus value={code} onChange={e=>{setCode(e.target.value);setErr(null);}} placeholder="Invite code" style={{width:"100%",boxSizing:"border-box",fontFamily:C.mono,fontSize:15,color:C.ink,background:C.paper,border:`1px solid ${err?C.red:C.line}`,borderRadius:9,padding:"12px 14px",outline:"none"}} onFocus={e=>{if(!err)e.target.style.borderColor=C.teal;}} onBlur={e=>{if(!err)e.target.style.borderColor=C.line;}}/>
   {err&&<div style={{marginTop:9,fontFamily:C.sans,fontSize:12.5,color:C.red}}>{err}</div>}
   <button type="submit" style={{width:"100%",marginTop:18,fontFamily:C.sans,fontSize:14.5,fontWeight:600,color:"#fff",background:C.tealDeep,border:"none",borderRadius:10,padding:"13px",cursor:"pointer",boxShadow:"0 6px 20px rgba(10,74,62,.18)"}}>Sign in</button>
  </form>
 </div>);
}

// ── Dashboard (real runs from Postgres) ──────────────────────────────────────
function Dashboard({auth}){
 const[runs,setRuns]=useState([]);const[selId,setSelId]=useState(null);
 const[loading,setLoading]=useState(true);const[loadErr,setLoadErr]=useState(null);
 const[upBusy,setUpBusy]=useState(false);const[upErr,setUpErr]=useState(null);const fileRef=useRef(null);
 const live=useRetellCall();const[liveTo,setLiveTo]=useState(null);const[dockOpen,setDockOpen]=useState(false);
 const loadRuns=async(selectId)=>{
  setLoadErr(null);
  try{
   const res=await fetch(`${OCR_BASE}/runs?user_id=${encodeURIComponent(auth.user)}`);
   if(!res.ok)throw new Error(`HTTP ${res.status}`);
   const d=await res.json();const list=d.runs||[];
   setRuns(list);
   setSelId(prev=>selectId||prev||(list[0]&&list[0].id)||null);
  }catch(e){setLoadErr(e.message||"Failed to load runs");}finally{setLoading(false);}
 };
 useEffect(()=>{loadRuns();},[]);
 const doUpload=async(file)=>{
  if(!file)return;setUpErr(null);setUpBusy(true);
  try{
   const fd=new FormData();fd.append("file",file);
   const pres=await fetch(`${OCR_BASE}/process`,{method:"POST",body:fd});
   if(!pres.ok){let m=`HTTP ${pres.status}`;try{const e=await pres.json();if(e.detail)m=typeof e.detail==="string"?e.detail:JSON.stringify(e.detail);}catch{}throw new Error(m);}
   const result=await pres.json();
   const sres=await fetch(`${OCR_BASE}/runs`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
     user_id:auth.user,filename:result.source,doc_type:result.classification&&result.classification.doc_type,
     classification_confidence:result.classification&&result.classification.confidence,
     extracted_fields:result.extracted,review_queue:result.review_queue,
     deny_back_letter:result.deny_back_letter,pushed_downstream:result.pushed_downstream})});
   if(!sres.ok)throw new Error(`Saved to pipeline but DB save failed (HTTP ${sres.status})`);
   const {id}=await sres.json();
   await loadRuns(id);
  }catch(err){setUpErr(err.message||"Upload failed");}finally{setUpBusy(false);}
 };
 const counts={cleared:runs.filter(r=>runDisposition(r)==="cleared").length,flagged:runs.filter(r=>runDisposition(r)==="flagged").length,held:runs.filter(r=>runDisposition(r)==="held").length};
 const sel=runs.find(r=>r.id===selId)||null;
 const phone=runPhone(sel);
 const outbound=(to)=>{live.reset();setLiveTo(to);setDockOpen(true);live.start("outbound");};
 // Demo "Test callback": dial the logged-in user's own number to hear voicemail.
 const OUTBOUND_AGENT="agent_c56099a90a4b27dcaa1df3f737";
 const TEST_NUMBERS={joseph:"+15102701696",varuni:""};
 const[testOpen,setTestOpen]=useState(false);const[testNum,setTestNum]=useState("");
 const[testBusy,setTestBusy]=useState(false);const[testMsg,setTestMsg]=useState(null);const[testErr,setTestErr]=useState(null);
 const openTest=()=>{setTestOpen(o=>!o);setTestNum(TEST_NUMBERS[auth.user]||"");setTestMsg(null);setTestErr(null);};
 const placeTestCall=async()=>{
  const to=(testNum||"").trim();
  if(!to){setTestErr("Enter a number first.");return;}
  setTestBusy(true);setTestErr(null);setTestMsg(null);
  try{
   const res=await fetch(`${API_BASE}/calls/outbound`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to_number:to,referral_id:sel&&sel.id,override_agent_id:OUTBOUND_AGENT})});
   if(!res.ok){let m=`HTTP ${res.status}`;try{const e=await res.json();if(e.detail)m=typeof e.detail==="string"?e.detail:JSON.stringify(e.detail);}catch{}throw new Error(m);}
   await res.json();setTestMsg("Call placed — let it go to voicemail.");
  }catch(err){setTestErr(err.message||"Call failed");}finally{setTestBusy(false);}
 };
 const LMAP={idle:"connecting",connecting:"connecting",live:"live",ended:"ended",error:"ended"};
 const dockCall=dockOpen?{status:LMAP[live.status]||"connecting",seconds:live.seconds,transcript:live.transcript,to:liveTo,error:live.error}:null;
 const dockEnd=()=>{if(live.status==="live"||live.status==="connecting"){live.stop();}else{setDockOpen(false);live.reset();}};
 const fmtTime=iso=>{if(!iso)return "";try{return new Date(iso).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}catch{return iso;}};
 return(<div style={{display:"grid",gridTemplateColumns:"320px 1fr",minHeight:"calc(100vh - 69px)"}}>
  <aside style={{borderRight:`1px solid ${C.line}`,padding:"18px 16px",display:"flex",flexDirection:"column",maxHeight:"calc(100vh - 69px)"}}>
   <div style={{display:"flex",justifyContent:"space-between",padding:"0 8px 14px"}}>{[["Cleared",counts.cleared,C.green],["Flagged",counts.flagged,C.amber],["Held",counts.held,C.red]].map(([l,n,c])=>(<div key={l} style={{textAlign:"center"}}><div style={{fontFamily:C.mono,fontSize:18,color:c,fontWeight:500}}>{n}</div><div style={{fontFamily:C.sans,fontSize:9,letterSpacing:".06em",textTransform:"uppercase",color:C.inkFaint}}>{l}</div></div>))}</div>
   <div style={{fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:".09em",textTransform:"uppercase",color:C.inkFaint,padding:"0 8px 10px"}}>Your fax runs</div>
   <div style={{flex:1,overflowY:"auto",margin:"0 -4px",padding:"0 4px"}}>
    {loading?<div style={{fontFamily:C.sans,fontSize:13,color:C.inkFaint,padding:"10px 8px"}}>Loading…</div>:
     loadErr?<div style={{fontFamily:C.mono,fontSize:11.5,color:C.red,padding:"10px 8px",wordBreak:"break-word"}}>{loadErr}</div>:
     runs.length===0?<div style={{fontFamily:C.sans,fontSize:12.5,color:C.inkFaint,padding:"10px 8px",lineHeight:1.5}}>No runs yet. Upload a fax below to process it and add it here.</div>:
     runs.map(r=>{const a=r.id===selId;const x=DISPOSITION[runDisposition(r)];return(<button key={r.id} onClick={()=>setSelId(r.id)} style={{display:"block",width:"100%",textAlign:"left",cursor:"pointer",padding:"13px 14px",marginBottom:8,borderRadius:9,border:`1px solid ${a?C.teal:C.line}`,background:a?C.card:"transparent",borderLeft:`3px solid ${a?x.color:"transparent"}`}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}><span style={{fontFamily:C.sans,fontSize:10.5,fontWeight:600,letterSpacing:".05em",textTransform:"uppercase",color:C.teal}}>{(r.doc_type||"unknown").replace(/_/g," ")}</span><span style={{width:8,height:8,borderRadius:"50%",background:x.color}}/></div><div style={{fontFamily:C.display,fontSize:15,color:C.ink,wordBreak:"break-all"}}>{r.filename||"document"}</div><div style={{fontFamily:C.sans,fontSize:11.5,color:C.inkFaint,marginTop:3}}>{fmtTime(r.uploaded_at)}</div></button>);})}
   </div>
   <div style={{marginTop:14,padding:"14px",border:`1px dashed ${C.line}`,borderRadius:9,textAlign:"center"}}>
    <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff,.tif" style={{display:"none"}} onChange={e=>{const f=e.target.files&&e.target.files[0];e.target.value="";doUpload(f);}}/>
    <div style={{fontFamily:C.sans,fontSize:12,color:C.inkSoft,marginBottom:8}}>{upBusy?"Processing + saving…":"Process a new fax"}</div>
    <button disabled={upBusy} onClick={()=>fileRef.current&&fileRef.current.click()} style={{fontFamily:C.sans,fontSize:12,fontWeight:600,color:C.card,background:upBusy?C.inkFaint:C.tealDeep,border:"none",borderRadius:7,padding:"8px 16px",cursor:upBusy?"default":"pointer"}}>{upBusy?"Working…":"Upload PDF / image"}</button>
    {upErr&&<div style={{marginTop:8,fontFamily:C.mono,fontSize:11,color:C.red,wordBreak:"break-word"}}>{upErr}</div>}
   </div>
  </aside>
  <main key={selId||"empty"} style={{padding:"28px 40px",animation:"panelIn .32s ease both",maxWidth:860}}>
   {sel?(<>
    {runDisposition(sel)==="held"&&(<div style={{marginBottom:18,padding:"16px 18px",background:"rgba(15,110,91,.05)",border:`1px solid rgba(15,110,91,.22)`,borderRadius:10}}>
     <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
      <div><div style={{fontFamily:C.sans,fontSize:13,fontWeight:600,color:C.tealDeep}}>Referral held — patient contact required</div><div style={{fontFamily:C.mono,fontSize:12,color:C.inkSoft,marginTop:3}}>{phone?`${phone} · `:""}up to 3 attempts · PHI-free voicemail</div></div>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
       {phone&&<button onClick={()=>outbound(phone)} style={{display:"inline-flex",alignItems:"center",gap:8,fontFamily:C.sans,fontSize:13,fontWeight:600,color:"#fff",background:C.tealDeep,border:"none",borderRadius:8,padding:"10px 16px",cursor:"pointer",whiteSpace:"nowrap"}}><PhoneWave/>Initiate callback</button>}
       <button onClick={openTest} style={{display:"inline-flex",alignItems:"center",gap:7,fontFamily:C.sans,fontSize:13,fontWeight:600,color:C.tealDeep,background:"none",border:`1px solid ${C.teal}`,borderRadius:8,padding:"9px 15px",cursor:"pointer",whiteSpace:"nowrap"}}>Test callback</button>
      </div>
     </div>
     {testOpen&&(<div style={{marginTop:14,paddingTop:14,borderTop:`1px solid rgba(15,110,91,.18)`}}>
      <div style={{fontFamily:C.sans,fontSize:12,color:C.inkSoft,marginBottom:8}}>Demo: call this number to test voicemail</div>
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
       <input value={testNum} onChange={e=>{setTestNum(e.target.value);setTestErr(null);}} placeholder="+1 555 000 0000" style={{fontFamily:C.mono,fontSize:13.5,color:C.ink,background:C.card,border:`1px solid ${C.line}`,borderRadius:8,padding:"9px 12px",outline:"none",minWidth:210}} onFocus={e=>e.target.style.borderColor=C.teal} onBlur={e=>e.target.style.borderColor=C.line}/>
       <button onClick={placeTestCall} disabled={testBusy} style={{display:"inline-flex",alignItems:"center",gap:8,fontFamily:C.sans,fontSize:13,fontWeight:600,color:"#fff",background:testBusy?C.inkFaint:C.tealDeep,border:"none",borderRadius:8,padding:"10px 16px",cursor:testBusy?"default":"pointer",whiteSpace:"nowrap"}}><PhoneWave/>{testBusy?"Calling…":"Call me"}</button>
      </div>
      {testMsg&&<div style={{marginTop:9,fontFamily:C.sans,fontSize:12.5,fontWeight:600,color:C.green}}>{testMsg}</div>}
      {testErr&&<div style={{marginTop:9,fontFamily:C.mono,fontSize:11.5,color:C.red,wordBreak:"break-word"}}>{testErr}</div>}
     </div>)}
    </div>)}
    <UploadedResult result={runToResult(sel)} onClear={null}/>
   </>):(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"60vh",textAlign:"center"}}>
     <div style={{width:64,height:64,borderRadius:16,background:C.card,border:`1px solid ${C.line}`,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:18}}><Ekg w={36}/></div>
     <h1 style={{fontFamily:C.display,fontSize:24,fontWeight:600,margin:"0 0 8px"}}>{runs.length===0?"No runs yet":"No fax selected"}</h1>
     <p style={{fontFamily:C.sans,fontSize:14,color:C.inkSoft,maxWidth:360,lineHeight:1.5}}>{runs.length===0?"Upload a referral, insurance card, or lab result to run it through the live OCR pipeline — it'll be saved and listed here.":"Pick a run from the left to see its full result."}</p>
    </div>
   )}
  </main>
  {dockCall&&<CallDock call={dockCall} onEnd={dockEnd}/>}
 </div>);
}

export default function App(){
 const[auth,setAuth]=useState(loadAuth());
 const[page,setPage]=useState("home");const[captured,setCaptured]=useState(null);
 const go=p=>setPage(p);
 const logout=()=>{localStorage.removeItem(AUTH_KEY);setAuth(null);setPage("home");};
 if(!auth)return <Login onAuth={a=>{setAuth(a);setPage("home");}}/>;
 return(<div style={{minHeight:"100vh",background:C.paper,color:C.ink,fontFamily:C.sans,backgroundImage:`url("${GRAIN}")`,backgroundSize:"120px 120px"}}>
  <style>{FONTS}</style>
  <Nav page={page} go={go} auth={auth} onLogout={logout}/>
  {page==="home"&&<Landing onCall={()=>go("call")} go={go}/>}
  {page==="call"&&(LIVE
    ? <LiveCallScreen onExit={()=>go("home")}/>
    : <CallScreen onCancel={()=>go("home")} onFinish={c=>{setCaptured(c);go("summary");}}/>)}
  {page==="summary"&&<Summary captured={captured||CAPTURED} go={go}/>}
  {page==="console"&&<Dashboard auth={auth}/>}
 </div>);
}
