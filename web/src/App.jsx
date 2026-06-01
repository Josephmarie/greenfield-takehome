import React, { useState, useEffect, useRef } from "react";

// Greenfield Cardiology — multi-page web app
// Landing (with live intake call) → post-call Summary (editable) → OCR Console.
// Same design system throughout. Calls run a simulated lifecycle so the whole
// flow demos inline; flip LIVE + API_BASE to run against the Retell backend.
const LIVE = false;
const API_BASE = "http://localhost:8000";

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

// ── shared OCR components ────────────────────────────────────────────────────
function ConfidenceChip({confidence}){const m={high:{t:"High",c:C.green,bg:"rgba(47,125,50,.10)"},medium:{t:"Medium",c:C.amber,bg:"rgba(168,106,18,.12)"},low:{t:"Low",c:C.red,bg:"rgba(166,64,47,.12)"},missing:{t:"Missing",c:C.red,bg:"rgba(166,64,47,.12)"}}[confidence];return(<span style={{fontFamily:C.mono,fontSize:10.5,fontWeight:500,letterSpacing:".04em",textTransform:"uppercase",color:m.c,background:m.bg,padding:"2px 7px",borderRadius:4,whiteSpace:"nowrap"}}>{m.t}</span>);}
function Field({f}){const[open,setOpen]=useState(false);const missing=f.confidence==="missing"||f.value===null;return(<div style={{borderBottom:`1px solid ${C.line}`,padding:"11px 0"}}><div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:16}}><span style={{fontFamily:C.sans,fontSize:12.5,color:C.inkSoft,minWidth:150}}>{f.label}</span><span style={{flex:1}}><span style={{fontFamily:C.mono,fontSize:13.5,color:missing?C.red:C.ink,fontStyle:missing?"italic":"normal"}}>{missing?"not found":f.value}</span></span><span style={{display:"flex",alignItems:"center",gap:10}}><ConfidenceChip confidence={f.confidence}/>{f.quote&&<button onClick={()=>setOpen(!open)} style={{border:"none",background:"none",cursor:"pointer",padding:0,fontFamily:C.mono,fontSize:11,color:C.inkFaint,textDecoration:"underline",textUnderlineOffset:2}}>{open?"hide":"source"}</button>}</span></div>{open&&f.quote&&<div style={{marginTop:8,padding:"8px 11px",background:C.paper,borderLeft:`2px solid ${C.teal}`,borderRadius:"0 4px 4px 0",fontFamily:C.mono,fontSize:12,color:C.inkSoft}}>“{f.quote}”</div>}</div>);}
function LabTable({labs}){return(<div style={{border:`1px solid ${C.line}`,borderRadius:8,overflow:"hidden"}}><div style={{display:"grid",gridTemplateColumns:"1.4fr .7fr .5fr 1fr 1.3fr",background:C.paper,padding:"9px 14px",fontFamily:C.sans,fontSize:10.5,fontWeight:600,letterSpacing:".05em",textTransform:"uppercase",color:C.inkFaint}}><span>Component</span><span>Result</span><span>Unit</span><span>Reference</span><span>Status</span></div>{labs.map(l=>{const u=l.out&&!l.labFlag;return(<div key={l.c} style={{display:"grid",gridTemplateColumns:"1.4fr .7fr .5fr 1fr 1.3fr",padding:"10px 14px",alignItems:"center",borderTop:`1px solid ${C.line}`,background:l.out?"rgba(166,64,47,.04)":C.card}}><span style={{fontFamily:C.sans,fontSize:13,color:C.ink,fontWeight:l.out?600:400}}>{l.c}</span><span style={{fontFamily:C.mono,fontSize:13,color:l.out?C.red:C.ink}}>{l.v}</span><span style={{fontFamily:C.mono,fontSize:11.5,color:C.inkFaint}}>{l.unit}</span><span style={{fontFamily:C.mono,fontSize:12,color:C.inkSoft}}>{l.range}</span><span>{l.out?(<span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{fontFamily:C.mono,fontSize:11,fontWeight:500,color:C.red,background:"rgba(166,64,47,.12)",padding:"1px 6px",borderRadius:4}}>{l.computed==="H"?"High":"Low"}</span>{u&&<span title="Out of range by our computation; lab printed no flag" style={{fontFamily:C.mono,fontSize:10,color:C.amber,fontStyle:"italic"}}>lab unflagged</span>}</span>):<span style={{fontFamily:C.mono,fontSize:11.5,color:C.green}}>in range</span>}</span></div>);})}</div>);}
function DenyBackCard({patient,missing}){return(<div style={{position:"relative",marginTop:6,padding:"22px 24px",background:C.card,border:`1px solid ${C.line}`,borderRadius:8}}><div style={{position:"absolute",top:16,right:16,transform:"rotate(6deg)",border:`2px solid ${C.red}`,color:C.red,fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:".08em",padding:"4px 9px",borderRadius:5,opacity:.85}}>HELD · NOT SCHEDULED</div><div style={{fontFamily:C.display,fontSize:17}}>Greenfield Cardiology</div><div style={{fontFamily:C.mono,fontSize:11,color:C.inkFaint,marginBottom:16}}>450 Market Street, Suite 300, San Francisco, CA 94105 · Fax 415-555-0121</div><div style={{fontFamily:C.sans,fontSize:13,marginBottom:4}}><strong>Re:</strong> Incomplete referral — {patient}</div><p style={{fontFamily:C.sans,fontSize:13,color:C.inkSoft,lineHeight:1.6,margin:"10px 0"}}>We are unable to process this referral as received because the following required field(s) are missing or could not be verified:</p><ul style={{margin:"10px 0",paddingLeft:0,listStyle:"none"}}>{missing.map(m=><li key={m} style={{fontFamily:C.mono,fontSize:13,color:C.red,padding:"3px 0"}}>— {m}</li>)}</ul><p style={{fontFamily:C.sans,fontSize:13,color:C.inkSoft,lineHeight:1.6,margin:"10px 0 0"}}>Please resubmit with the item(s) above completed and we will schedule the patient promptly.</p></div>);}
const DISPOSITION={cleared:{label:"Cleared",color:C.green},flagged:{label:"Flagged",color:C.amber},held:{label:"Held — deny-back",color:C.red}};
function Disposition({d}){const x=DISPOSITION[d];return(<span style={{display:"inline-flex",alignItems:"center",gap:7,fontFamily:C.sans,fontSize:12,fontWeight:600,color:x.color,background:`${x.color}14`,padding:"5px 11px",borderRadius:20}}><span style={{width:7,height:7,borderRadius:"50%",background:x.color}}/>{x.label}</span>);}
const ST=({children})=>(<div style={{fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:".09em",textTransform:"uppercase",color:C.inkFaint,margin:"26px 0 12px"}}>{children}</div>);

const FAXES=[
 {id:"fax-001",type:"referral",typeLabel:"Referral",from:"Bay Area Internal Medicine Group",patient:"James Patterson",phone:"415-555-7892",received:"May 26, 2026",classification:{label:"Referral",confidence:.97},disposition:"held",callback:{reason:"Referral received — patient contact required"},
  fields:[{label:"Patient name",value:"James Patterson",confidence:"high",quote:"Patient Name: James Patterson"},{label:"Date of birth",value:"04/22/1958",confidence:"high",quote:"Date of Birth: 04/22/1958"},{label:"Phone",value:"(415) 555-7892",confidence:"high",quote:"Phone: (415) 555-7892"},{label:"Insurance carrier",value:"Aetna PPO",confidence:"high",quote:"Insurance Carrier: Aetna PPO"},{label:"Member ID",value:"AET-992847162",confidence:"high",quote:"Member ID: AET-992847162"},{label:"Group number",value:null,confidence:"missing",quote:"Group Number: [FIELD LEFT BLANK]"},{label:"Referring provider",value:"Dr. Michael Torres, MD",confidence:"high",quote:"Referring Provider: Dr. Michael Torres, MD"},{label:"Referring provider NPI",value:null,confidence:"missing",quote:"Referring Provider NPI: [FIELD LEFT BLANK]"},{label:"Reason for referral",value:"Exertional chest pain with shortness of breath",confidence:"high",quote:"Chief Complaint: Exertional chest pain"},{label:"Urgency",value:"Routine",confidence:"high",quote:"Urgency: [X] ROUTINE"}],
  review:[{field:"Group number",reason:"Field left blank on document"},{field:"Referring provider NPI",reason:"Field left blank on document"}],denyBack:["Group number","Referring provider NPI"]},
 {id:"fax-002",type:"insurance_card",typeLabel:"Insurance Card",from:"Maria Gonzalez",patient:"Maria Gonzalez",received:"May 26, 2026",classification:{label:"Insurance Card",confidence:.96},disposition:"cleared",note:"Cigna is in-network. Ready to attach to the patient record.",
  fields:[{label:"Member name",value:"GONZALEZ, MARIA",confidence:"high",quote:"Member Name: GONZALEZ, MARIA"},{label:"Member ID",value:"CIG-4471829304",confidence:"high",quote:"Member ID: CIG-4471829304"},{label:"Group number",value:"00456781",confidence:"high",quote:"Group Number: 00456781"},{label:"Payer ID",value:"62308",confidence:"high",quote:"Payer ID: 62308"},{label:"Co-pay (specialist)",value:"$60",confidence:"high",quote:"Copay - Specialist: $60"},{label:"Effective date",value:"01/01/2026",confidence:"high",quote:"Effective: 01/01/2026"}],review:[]},
 {id:"fax-003",type:"lab_result",typeLabel:"Lab Result",from:"Quest Diagnostics",patient:"Robert Kim",received:"May 24, 2026",classification:{label:"Lab Result",confidence:.95},disposition:"flagged",
  fields:[{label:"Patient name",value:"Robert Kim",confidence:"high",quote:"PATIENT: Robert Kim"},{label:"Date of birth",value:"11/03/1965",confidence:"high",quote:"Date of Birth: 11/03/1965"},{label:"Ordering provider",value:"Dr. Sarah Chen, MD",confidence:"high",quote:"Ordering Provider: Dr. Sarah Chen, MD"},{label:"Report date",value:"05/24/2026",confidence:"high",quote:"Date Reported: 05/24/2026"}],
  labs:[{c:"WBC",v:"11.2",unit:"K/uL",range:"4.5 – 11.0",out:true,computed:"H",labFlag:"H"},{c:"RBC",v:"4.1",unit:"M/uL",range:"4.2 – 5.8",out:true,computed:"L",labFlag:null},{c:"Hemoglobin",v:"12.8",unit:"g/dL",range:"13.5 – 17.5",out:true,computed:"L",labFlag:"L"},{c:"Hematocrit",v:"38.2",unit:"%",range:"41 – 53",out:true,computed:"L",labFlag:"L"},{c:"MCV",v:"79",unit:"fL",range:"80 – 100",out:true,computed:"L",labFlag:"L"},{c:"MCH",v:"26.1",unit:"pg",range:"27 – 33",out:true,computed:"L",labFlag:"L"},{c:"MCHC",v:"33.4",unit:"g/dL",range:"32 – 36",out:false,computed:"normal",labFlag:null},{c:"RDW",v:"15.8",unit:"%",range:"11.5 – 14.5",out:true,computed:"H",labFlag:"H"},{c:"Platelets",v:"428",unit:"K/uL",range:"150 – 400",out:true,computed:"H",labFlag:"H"},{c:"Neutrophils",v:"72",unit:"%",range:"50 – 70",out:true,computed:"H",labFlag:null},{c:"Lymphocytes",v:"18",unit:"%",range:"20 – 40",out:true,computed:"L",labFlag:"L"}],
  review:[{field:"RBC",reason:"4.1 below 4.2–5.8 (computed L) — lab printed no flag"},{field:"Neutrophils",reason:"72 above 50–70 (computed H) — lab printed no flag"}]},
];

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
function Nav({page,go}){const link=(id,label)=>(<button onClick={()=>go(id)} style={{border:"none",background:"none",cursor:"pointer",fontFamily:C.sans,fontSize:13,fontWeight:600,color:page===id?C.tealDeep:C.inkSoft,padding:"6px 2px",borderBottom:`2px solid ${page===id?C.teal:"transparent"}`}}>{label}</button>);
 return(<header style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 34px",borderBottom:`1px solid ${C.line}`,background:"rgba(252,251,247,.8)",backdropFilter:"blur(6px)",position:"sticky",top:0,zIndex:20}}>
  <button onClick={()=>go("home")} style={{display:"flex",alignItems:"center",gap:12,border:"none",background:"none",cursor:"pointer"}}><div style={{width:36,height:36,borderRadius:9,background:C.tealDeep,display:"flex",alignItems:"center",justifyContent:"center"}}><Ekg color="#EAF3EF" w={22}/></div><span style={{fontFamily:C.display,fontSize:18,fontWeight:600,color:C.ink}}>Greenfield Cardiology</span></button>
  <nav style={{display:"flex",gap:26,alignItems:"center"}}>{link("home","Home")}{link("console","Intake Console")}</nav>
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
    <div style={{display:"flex",gap:14,alignItems:"center"}}>
     <button onClick={onCall} style={{display:"inline-flex",alignItems:"center",gap:9,fontFamily:C.sans,fontSize:15,fontWeight:600,color:"#fff",background:C.tealDeep,border:"none",borderRadius:10,padding:"14px 24px",cursor:"pointer",boxShadow:"0 6px 20px rgba(10,74,62,.22)"}}><PhoneWave/>Talk to the front desk</button>
     <button onClick={()=>go("console")} style={{fontFamily:C.sans,fontSize:15,fontWeight:600,color:C.tealDeep,background:"none",border:`1px solid ${C.line}`,borderRadius:10,padding:"14px 22px",cursor:"pointer"}}>View intake console</button>
    </div>
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
function CallScreen({onFinish,onCancel}){
 const[status,setStatus]=useState("connecting");const[secs,setSecs]=useState(0);const[tr,setTr]=useState([]);
 const timers=useRef([]);const tick=useRef(null);const bodyRef=useRef(null);
 useEffect(()=>{
  tick.current=setInterval(()=>setSecs(s=>s+1),1000);
  BOOKING.forEach(step=>timers.current.push(setTimeout(()=>{if(step.status)setStatus(step.status);if(step.line)setTr(t=>[...t,step.line]);if(step.status==="ended"&&tick.current){clearInterval(tick.current);tick.current=null;}},step.at)));
  return()=>{timers.current.forEach(clearTimeout);if(tick.current)clearInterval(tick.current);};
 },[]);
 useEffect(()=>{if(bodyRef.current)bodyRef.current.scrollTop=bodyRef.current.scrollHeight;},[tr.length]);
 const s=CALL_STATUS[status];const mm=String(Math.floor(secs/60)).padStart(2,"0");const ss=String(secs%60).padStart(2,"0");
 const ended=status==="ended";
 return(<div style={{minHeight:"calc(100vh - 69px)",display:"flex",flexDirection:"column",alignItems:"center",padding:"40px 20px 60px",animation:"panelIn .35s ease both"}}>
  <div style={{position:"relative",width:150,height:150,display:"flex",alignItems:"center",justifyContent:"center",marginTop:20}}>
   {!ended&&[0,1].map(i=>(<div key={i} style={{position:"absolute",width:110,height:110,borderRadius:"50%",border:`1.5px solid ${s.c}`,animation:`ring 2.4s ease-out ${i*1.2}s infinite`}}/>))}
   <div style={{width:110,height:110,borderRadius:"50%",background:C.tealDeep,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1}}><Ekg color="#EAF3EF" w={54}/></div>
  </div>
  <div style={{display:"flex",alignItems:"center",gap:9,marginTop:22}}><span style={{width:9,height:9,borderRadius:"50%",background:s.c,animation:ended?"none":"pulse 1.4s ease infinite"}}/><span style={{fontFamily:C.sans,fontSize:14,fontWeight:600,color:s.c}}>{s.t}</span><span style={{fontFamily:C.mono,fontSize:13,color:C.inkFaint,marginLeft:6}}>{mm}:{ss}</span></div>
  <div ref={bodyRef} style={{width:"100%",maxWidth:560,marginTop:30,maxHeight:"42vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:14}}>
   {tr.map((t,i)=>(<div key={i} style={{alignSelf:t.who==="agent"?"flex-start":"flex-end",maxWidth:"82%",animation:"fadeUp .25s ease both"}}>
    <div style={{fontFamily:C.sans,fontSize:9.5,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:t.who==="agent"?C.teal:C.inkFaint,marginBottom:3,textAlign:t.who==="agent"?"left":"right"}}>{t.who==="agent"?"Front desk":"You"}</div>
    <div style={{fontFamily:C.sans,fontSize:14,lineHeight:1.5,color:C.ink,background:t.who==="agent"?C.card:"rgba(15,110,91,.08)",border:`1px solid ${t.who==="agent"?C.line:"rgba(15,110,91,.2)"}`,padding:"10px 14px",borderRadius:12}}>{t.text}</div>
   </div>))}
  </div>
  <div style={{marginTop:30,display:"flex",gap:12}}>
   {!ended?(<button onClick={onCancel} style={{fontFamily:C.sans,fontSize:14,fontWeight:600,color:"#fff",background:C.red,border:"none",borderRadius:10,padding:"12px 28px",cursor:"pointer"}}>End call</button>)
   :(<button onClick={()=>onFinish({...CAPTURED,durationLabel:`${mm}:${ss}`,transcript:tr})} style={{fontFamily:C.sans,fontSize:14,fontWeight:600,color:"#fff",background:C.tealDeep,border:"none",borderRadius:10,padding:"12px 28px",cursor:"pointer"}}>View call summary →</button>)}
  </div>
 </div>);
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
  <div ref={b} style={{maxHeight:200,overflowY:"auto",padding:"12px 18px",display:"flex",flexDirection:"column",gap:10}}>{call.transcript.map((t,i)=>{const sys=t.who==="system";return(<div key={i} style={{animation:"fadeUp .25s ease both"}}>{!sys&&<div style={{fontFamily:C.sans,fontSize:9.5,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:t.who==="agent"?C.teal:C.inkFaint,marginBottom:2}}>{t.who==="agent"?"Agent":"Caller"}</div>}<div style={{fontFamily:sys?C.mono:C.sans,fontSize:sys?11.5:13,color:sys?C.amber:C.ink,fontStyle:sys?"italic":"normal",lineHeight:1.5}}>{t.text}</div></div>);})}</div>
  <div style={{padding:"12px 18px",borderTop:`1px solid ${C.line}`}}><button onClick={onEnd} style={{width:"100%",fontFamily:C.sans,fontSize:13,fontWeight:600,color:call.status==="ended"?C.inkSoft:"#fff",background:call.status==="ended"?C.paper:C.red,border:call.status==="ended"?`1px solid ${C.line}`:"none",borderRadius:8,padding:"10px",cursor:"pointer"}}>{call.status==="ended"?"Close":"End call"}</button></div>
 </div>);
}
const OUTBOUND=[{at:0,status:"dialing"},{at:1000,status:"ringing"},{at:3200,status:"voicemail",line:{who:"system",text:"Voicemail detected — leaving PHI-free message only"}},{at:4400,line:{who:"agent",text:"This is a message from Greenfield Cardiology. Please call us back at 415-555-0120. Thank you."}},{at:7600,status:"ended",line:{who:"system",text:"Attempt 1 of 3 logged · next attempt eligible in 48 hours"}}];
function Console(){
 const[sel,setSel]=useState(FAXES[0].id);const[call,setCall]=useState(null);const timers=useRef([]);const tick=useRef(null);
 const fax=FAXES.find(f=>f.id===sel);const counts={cleared:FAXES.filter(f=>f.disposition==="cleared").length,flagged:FAXES.filter(f=>f.disposition==="flagged").length,held:FAXES.filter(f=>f.disposition==="held").length};
 const clear=()=>{timers.current.forEach(clearTimeout);timers.current=[];if(tick.current){clearInterval(tick.current);tick.current=null;}};
 useEffect(()=>clear,[]);
 const outbound=(to)=>{setCall({status:"dialing",seconds:0,transcript:[],to});tick.current=setInterval(()=>setCall(c=>c&&c.status!=="ended"?{...c,seconds:c.seconds+1}:c),1000);OUTBOUND.forEach(st=>timers.current.push(setTimeout(()=>setCall(c=>{if(!c)return c;const n={...c};if(st.status)n.status=st.status;if(st.line)n.transcript=[...c.transcript,st.line];if(st.status==="ended"&&tick.current){clearInterval(tick.current);tick.current=null;}return n;}),st.at)));};
 const end=()=>{clear();setCall(null);};
 return(<div style={{display:"grid",gridTemplateColumns:"320px 1fr",minHeight:"calc(100vh - 69px)"}}>
  <aside style={{borderRight:`1px solid ${C.line}`,padding:"18px 16px"}}>
   <div style={{display:"flex",justifyContent:"space-between",padding:"0 8px 14px"}}>{[["Cleared",counts.cleared,C.green],["Flagged",counts.flagged,C.amber],["Held",counts.held,C.red]].map(([l,n,c])=>(<div key={l} style={{textAlign:"center"}}><div style={{fontFamily:C.mono,fontSize:18,color:c,fontWeight:500}}>{n}</div><div style={{fontFamily:C.sans,fontSize:9,letterSpacing:".06em",textTransform:"uppercase",color:C.inkFaint}}>{l}</div></div>))}</div>
   <div style={{fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:".09em",textTransform:"uppercase",color:C.inkFaint,padding:"0 8px 10px"}}>Incoming · Today</div>
   {FAXES.map((f,i)=>{const a=f.id===sel;const x=DISPOSITION[f.disposition];return(<button key={f.id} onClick={()=>setSel(f.id)} style={{display:"block",width:"100%",textAlign:"left",cursor:"pointer",padding:"13px 14px",marginBottom:8,borderRadius:9,border:`1px solid ${a?C.teal:C.line}`,background:a?C.card:"transparent",borderLeft:`3px solid ${a?x.color:"transparent"}`,animation:"fadeUp .4s ease both",animationDelay:`${.05*i}s`}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}><span style={{fontFamily:C.sans,fontSize:10.5,fontWeight:600,letterSpacing:".05em",textTransform:"uppercase",color:C.teal}}>{f.typeLabel}</span><span style={{width:8,height:8,borderRadius:"50%",background:x.color}}/></div><div style={{fontFamily:C.display,fontSize:16,color:C.ink}}>{f.patient}</div><div style={{fontFamily:C.sans,fontSize:11.5,color:C.inkFaint,marginTop:3}}>{f.from}</div></button>);})}
   <div style={{marginTop:14,padding:"14px",border:`1px dashed ${C.line}`,borderRadius:9,textAlign:"center"}}><div style={{fontFamily:C.sans,fontSize:12,color:C.inkSoft,marginBottom:8}}>Drop a fax to process</div><button style={{fontFamily:C.sans,fontSize:12,fontWeight:600,color:C.card,background:C.tealDeep,border:"none",borderRadius:7,padding:"8px 16px",cursor:"pointer"}}>Upload PDF / image</button></div>
  </aside>
  <main key={sel} style={{padding:"28px 40px",animation:"panelIn .32s ease both",maxWidth:860}}>
   <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:20}}><div><div style={{fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.teal,marginBottom:6}}>{fax.typeLabel}</div><h1 style={{fontFamily:C.display,fontSize:28,fontWeight:600,margin:0}}>{fax.patient}</h1><div style={{fontFamily:C.sans,fontSize:13,color:C.inkSoft,marginTop:6}}>From {fax.from} · received {fax.received}</div></div><Disposition d={fax.disposition}/></div>
   <div style={{display:"flex",alignItems:"center",gap:14,marginTop:20,padding:"14px 18px",background:C.card,border:`1px solid ${C.line}`,borderRadius:9}}><span style={{fontFamily:C.sans,fontSize:12,color:C.inkSoft}}>Classified as</span><span style={{fontFamily:C.display,fontSize:15,fontWeight:600}}>{fax.classification.label}</span><div style={{flex:1,height:6,background:C.paper,borderRadius:3,overflow:"hidden",marginLeft:8}}><div style={{width:`${fax.classification.confidence*100}%`,height:"100%",background:C.teal,borderRadius:3}}/></div><span style={{fontFamily:C.mono,fontSize:13,color:C.teal,fontWeight:500}}>{(fax.classification.confidence*100).toFixed(0)}%</span></div>
   {fax.callback&&(<div style={{marginTop:16,padding:"16px 18px",background:"rgba(15,110,91,.05)",border:`1px solid rgba(15,110,91,.22)`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}><div><div style={{fontFamily:C.sans,fontSize:13,fontWeight:600,color:C.tealDeep}}>{fax.callback.reason}</div><div style={{fontFamily:C.mono,fontSize:12,color:C.inkSoft,marginTop:3}}>{fax.phone} · up to 3 attempts, 48h apart · PHI-free voicemail</div></div><button onClick={()=>outbound(fax.phone)} style={{display:"inline-flex",alignItems:"center",gap:8,fontFamily:C.sans,fontSize:13,fontWeight:600,color:"#fff",background:C.tealDeep,border:"none",borderRadius:8,padding:"10px 16px",cursor:"pointer",whiteSpace:"nowrap"}}><PhoneWave/>Initiate callback</button></div>)}
   <ST>Extracted fields</ST><div>{fax.fields.map(f=><Field key={f.label} f={f}/>)}</div>
   {fax.labs&&(<><ST>Complete blood count</ST><LabTable labs={fax.labs}/></>)}
   <ST>Human review queue</ST>{fax.review.length===0?(<div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",background:"rgba(47,125,50,.06)",border:`1px solid rgba(47,125,50,.2)`,borderRadius:9}}><span style={{width:8,height:8,borderRadius:"50%",background:C.green}}/><span style={{fontFamily:C.sans,fontSize:13}}>Nothing flagged. {fax.note}</span></div>):(<div style={{border:`1px solid ${C.line}`,borderRadius:9,overflow:"hidden"}}>{fax.review.map((r,i)=>(<div key={r.field} style={{display:"flex",gap:14,padding:"13px 16px",alignItems:"baseline",borderTop:i?`1px solid ${C.line}`:"none",background:C.card}}><span style={{fontFamily:C.mono,fontSize:13,color:C.red,fontWeight:500,minWidth:130}}>{r.field}</span><span style={{fontFamily:C.sans,fontSize:12.5,color:C.inkSoft}}>{r.reason}</span></div>))}</div>)}
   {fax.denyBack&&(<><ST>Deny-back letter</ST><DenyBackCard patient={fax.patient} missing={fax.denyBack}/></>)}
   <div style={{height:60}}/>
  </main>
  {call&&<CallDock call={call} onEnd={end}/>}
 </div>);
}

export default function App(){
 const[page,setPage]=useState("home");const[captured,setCaptured]=useState(null);
 const go=p=>setPage(p);
 return(<div style={{minHeight:"100vh",background:C.paper,color:C.ink,fontFamily:C.sans,backgroundImage:`url("${GRAIN}")`,backgroundSize:"120px 120px"}}>
  <style>{FONTS}</style>
  <Nav page={page} go={go}/>
  {page==="home"&&<Landing onCall={()=>go("call")} go={go}/>}
  {page==="call"&&<CallScreen onCancel={()=>go("home")} onFinish={c=>{setCaptured(c);go("summary");}}/>}
  {page==="summary"&&<Summary captured={captured||CAPTURED} go={go}/>}
  {page==="console"&&<Console/>}
 </div>);
}
