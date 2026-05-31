import React, { useState, useEffect, useRef } from "react";

// Greenfield Cardiology — Fax Intake Console
// Review surface for the OCR pipeline + live call triggering (Retell).
// Seeded with the three real sample documents so it demos immediately.
//
// LIVE mode: set LIVE=true and run against your backend (api.py). It will
// POST to /calls/web (mint a web-call token) and /calls/outbound (dial a
// phone). The Retell API key lives ONLY on the backend, never here.
// Verify retell-client-js-sdk method names against the installed version.
const LIVE = false;
const API_BASE = "http://localhost:8000";

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
@keyframes fadeUp { from { opacity:0; transform:translateY(8px);} to {opacity:1; transform:translateY(0);} }
@keyframes panelIn { from { opacity:0; transform:translateY(6px);} to {opacity:1; transform:translateY(0);} }
@keyframes dockIn { from { opacity:0; transform:translateY(16px) scale(0.98);} to {opacity:1; transform:translateY(0) scale(1);} }
@keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.35;} }
`;

const C = {
  paper:"#F6F4ED", card:"#FCFBF7", ink:"#1B1D1A", inkSoft:"#5A5E56", inkFaint:"#8A8E84",
  line:"#E4DFD2", teal:"#0F6E5B", tealDeep:"#0A4A3E", green:"#2F7D32", amber:"#A86A12", red:"#A6402F",
  display:"'Spectral', Georgia, serif", sans:"'IBM Plex Sans', system-ui, sans-serif", mono:"'IBM Plex Mono', ui-monospace, monospace",
};

const GRAIN = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.025'/></svg>`);

const FAXES = [
  { id:"fax-001", type:"referral", typeLabel:"Referral", from:"Bay Area Internal Medicine Group",
    patient:"James Patterson", phone:"415-555-7892", received:"May 26, 2026",
    classification:{label:"Referral", confidence:0.97}, disposition:"held",
    callback:{ referralId:"ref-james-patterson", reason:"Referral received — patient contact required" },
    fields:[
      {label:"Patient name", value:"James Patterson", confidence:"high", quote:"Patient Name: James Patterson"},
      {label:"Date of birth", value:"04/22/1958", confidence:"high", quote:"Date of Birth: 04/22/1958"},
      {label:"Phone", value:"(415) 555-7892", confidence:"high", quote:"Phone: (415) 555-7892"},
      {label:"Insurance carrier", value:"Aetna PPO", confidence:"high", quote:"Insurance Carrier: Aetna PPO"},
      {label:"Member ID", value:"AET-992847162", confidence:"high", quote:"Member ID: AET-992847162"},
      {label:"Group number", value:null, confidence:"missing", quote:"Group Number: [FIELD LEFT BLANK]"},
      {label:"Referring provider", value:"Dr. Michael Torres, MD", confidence:"high", quote:"Referring Provider: Dr. Michael Torres, MD"},
      {label:"Referring provider NPI", value:null, confidence:"missing", quote:"Referring Provider NPI: [FIELD LEFT BLANK]"},
      {label:"Reason for referral", value:"Exertional chest pain with shortness of breath", confidence:"high", quote:"Chief Complaint: Exertional chest pain with shortness of breath"},
      {label:"Urgency", value:"Routine", confidence:"high", quote:"Urgency: [X] ROUTINE"},
    ],
    review:[{field:"Group number", reason:"Field left blank on document"},{field:"Referring provider NPI", reason:"Field left blank on document"}],
    denyBack:["Group number","Referring provider NPI"] },
  { id:"fax-002", type:"insurance_card", typeLabel:"Insurance Card", from:"Maria Gonzalez",
    patient:"Maria Gonzalez", received:"May 26, 2026", classification:{label:"Insurance Card", confidence:0.96},
    disposition:"cleared", note:"Cigna is in-network. Ready to attach to the patient record.",
    fields:[
      {label:"Member name", value:"GONZALEZ, MARIA", confidence:"high", quote:"Member Name: GONZALEZ, MARIA"},
      {label:"Member ID", value:"CIG-4471829304", confidence:"high", quote:"Member ID: CIG-4471829304"},
      {label:"Group number", value:"00456781", confidence:"high", quote:"Group Number: 00456781"},
      {label:"Payer ID", value:"62308", confidence:"high", quote:"Payer ID: 62308"},
      {label:"Co-pay (specialist)", value:"$60", confidence:"high", quote:"Copay - Specialist: $60"},
      {label:"Effective date", value:"01/01/2026", confidence:"high", quote:"Effective: 01/01/2026"},
    ], review:[] },
  { id:"fax-003", type:"lab_result", typeLabel:"Lab Result", from:"Quest Diagnostics",
    patient:"Robert Kim", received:"May 24, 2026", classification:{label:"Lab Result", confidence:0.95}, disposition:"flagged",
    fields:[
      {label:"Patient name", value:"Robert Kim", confidence:"high", quote:"PATIENT: Robert Kim"},
      {label:"Date of birth", value:"11/03/1965", confidence:"high", quote:"Date of Birth: 11/03/1965"},
      {label:"Ordering provider", value:"Dr. Sarah Chen, MD", confidence:"high", quote:"Ordering Provider: Dr. Sarah Chen, MD"},
      {label:"Report date", value:"05/24/2026", confidence:"high", quote:"Date Reported: 05/24/2026"},
    ],
    labs:[
      {c:"WBC", v:"11.2", unit:"K/uL", range:"4.5 – 11.0", out:true, computed:"H", labFlag:"H"},
      {c:"RBC", v:"4.1", unit:"M/uL", range:"4.2 – 5.8", out:true, computed:"L", labFlag:null},
      {c:"Hemoglobin", v:"12.8", unit:"g/dL", range:"13.5 – 17.5", out:true, computed:"L", labFlag:"L"},
      {c:"Hematocrit", v:"38.2", unit:"%", range:"41 – 53", out:true, computed:"L", labFlag:"L"},
      {c:"MCV", v:"79", unit:"fL", range:"80 – 100", out:true, computed:"L", labFlag:"L"},
      {c:"MCH", v:"26.1", unit:"pg", range:"27 – 33", out:true, computed:"L", labFlag:"L"},
      {c:"MCHC", v:"33.4", unit:"g/dL", range:"32 – 36", out:false, computed:"normal", labFlag:null},
      {c:"RDW", v:"15.8", unit:"%", range:"11.5 – 14.5", out:true, computed:"H", labFlag:"H"},
      {c:"Platelets", v:"428", unit:"K/uL", range:"150 – 400", out:true, computed:"H", labFlag:"H"},
      {c:"Neutrophils", v:"72", unit:"%", range:"50 – 70", out:true, computed:"H", labFlag:null},
      {c:"Lymphocytes", v:"18", unit:"%", range:"20 – 40", out:true, computed:"L", labFlag:"L"},
    ],
    review:[{field:"RBC", reason:"4.1 below 4.2–5.8 (computed L) — lab printed no flag"},{field:"Neutrophils", reason:"72 above 50–70 (computed H) — lab printed no flag"}] },
];

const DISPOSITION = { cleared:{label:"Cleared", color:C.green}, flagged:{label:"Flagged", color:C.amber}, held:{label:"Held — deny-back", color:C.red} };
const CALL_STATUS = {
  connecting:{t:"Connecting", c:C.amber, pulse:true}, dialing:{t:"Dialing", c:C.amber, pulse:true},
  ringing:{t:"Ringing", c:C.amber, pulse:true}, live:{t:"Live", c:C.green, pulse:true},
  voicemail:{t:"Voicemail", c:C.teal, pulse:true}, ended:{t:"Ended", c:C.inkFaint, pulse:false},
};

function Ekg({color=C.teal, w=30}){return(<svg width={w} height={w*0.5} viewBox="0 0 60 30" fill="none"><path d="M0 15 H14 L19 5 L25 25 L31 15 H60" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);}
function PhoneWave({color=C.card}){return(<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 4h3l2 5-2 1a11 11 0 005 5l1-2 5 2v3a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" stroke={color} strokeWidth="1.8" strokelinejoin="round"/></svg>);}

function ConfidenceChip({confidence}){
  const m={high:{t:"High",c:C.green,bg:"rgba(47,125,50,0.10)"},medium:{t:"Medium",c:C.amber,bg:"rgba(168,106,18,0.12)"},low:{t:"Low",c:C.red,bg:"rgba(166,64,47,0.12)"},missing:{t:"Missing",c:C.red,bg:"rgba(166,64,47,0.12)"}}[confidence];
  return(<span style={{fontFamily:C.mono,fontSize:10.5,fontWeight:500,letterSpacing:"0.04em",textTransform:"uppercase",color:m.c,background:m.bg,padding:"2px 7px",borderRadius:4,whiteSpace:"nowrap"}}>{m.t}</span>);
}

function Field({f}){
  const [open,setOpen]=useState(false);
  const missing=f.confidence==="missing"||f.value===null;
  return(<div style={{borderBottom:`1px solid ${C.line}`,padding:"11px 0"}}>
    <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:16}}>
      <span style={{fontFamily:C.sans,fontSize:12.5,color:C.inkSoft,minWidth:150}}>{f.label}</span>
      <span style={{flex:1,textAlign:"left"}}><span style={{fontFamily:C.mono,fontSize:13.5,color:missing?C.red:C.ink,fontStyle:missing?"italic":"normal"}}>{missing?"not found":f.value}</span></span>
      <span style={{display:"flex",alignItems:"center",gap:10}}>
        <ConfidenceChip confidence={f.confidence}/>
        {f.quote&&<button onClick={()=>setOpen(!open)} style={{border:"none",background:"none",cursor:"pointer",padding:0,fontFamily:C.mono,fontSize:11,color:C.inkFaint,textDecoration:"underline",textUnderlineOffset:2}}>{open?"hide":"source"}</button>}
      </span>
    </div>
    {open&&f.quote&&<div style={{marginTop:8,padding:"8px 11px",background:C.paper,borderLeft:`2px solid ${C.teal}`,borderRadius:"0 4px 4px 0",fontFamily:C.mono,fontSize:12,color:C.inkSoft}}>“{f.quote}”</div>}
  </div>);
}

function LabTable({labs}){
  return(<div style={{border:`1px solid ${C.line}`,borderRadius:8,overflow:"hidden"}}>
    <div style={{display:"grid",gridTemplateColumns:"1.4fr 0.7fr 0.5fr 1fr 1.3fr",background:C.paper,padding:"9px 14px",fontFamily:C.sans,fontSize:10.5,fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase",color:C.inkFaint}}>
      <span>Component</span><span>Result</span><span>Unit</span><span>Reference</span><span>Status</span></div>
    {labs.map((l,i)=>{const unflagged=l.out&&!l.labFlag;return(
      <div key={l.c} style={{display:"grid",gridTemplateColumns:"1.4fr 0.7fr 0.5fr 1fr 1.3fr",padding:"10px 14px",alignItems:"center",borderTop:`1px solid ${C.line}`,background:l.out?"rgba(166,64,47,0.04)":C.card}}>
        <span style={{fontFamily:C.sans,fontSize:13,color:C.ink,fontWeight:l.out?600:400}}>{l.c}</span>
        <span style={{fontFamily:C.mono,fontSize:13,color:l.out?C.red:C.ink}}>{l.v}</span>
        <span style={{fontFamily:C.mono,fontSize:11.5,color:C.inkFaint}}>{l.unit}</span>
        <span style={{fontFamily:C.mono,fontSize:12,color:C.inkSoft}}>{l.range}</span>
        <span>{l.out?(<span style={{display:"inline-flex",alignItems:"center",gap:6}}>
          <span style={{fontFamily:C.mono,fontSize:11,fontWeight:500,color:C.red,background:"rgba(166,64,47,0.12)",padding:"1px 6px",borderRadius:4}}>{l.computed==="H"?"High":"Low"}</span>
          {unflagged&&<span title="Out of range by our computation; the lab printed no flag" style={{fontFamily:C.mono,fontSize:10,color:C.amber,fontStyle:"italic"}}>lab unflagged</span>}
        </span>):(<span style={{fontFamily:C.mono,fontSize:11.5,color:C.green}}>in range</span>)}</span>
      </div>);})}
  </div>);
}

function DenyBackCard({patient,missing}){
  return(<div style={{position:"relative",marginTop:6,padding:"22px 24px",background:C.card,border:`1px solid ${C.line}`,borderRadius:8,boxShadow:"0 1px 2px rgba(0,0,0,0.03)"}}>
    <div style={{position:"absolute",top:16,right:16,transform:"rotate(6deg)",border:`2px solid ${C.red}`,color:C.red,fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:"0.08em",padding:"4px 9px",borderRadius:5,opacity:0.85}}>HELD · NOT SCHEDULED</div>
    <div style={{fontFamily:C.display,fontSize:17,color:C.ink,marginBottom:2}}>Greenfield Cardiology</div>
    <div style={{fontFamily:C.mono,fontSize:11,color:C.inkFaint,marginBottom:16}}>450 Market Street, Suite 300, San Francisco, CA 94105 · Fax 415-555-0121</div>
    <div style={{fontFamily:C.sans,fontSize:13,color:C.ink,marginBottom:4}}><strong>Re:</strong> Incomplete referral — {patient}</div>
    <p style={{fontFamily:C.sans,fontSize:13,color:C.inkSoft,lineHeight:1.6,margin:"10px 0"}}>Thank you for your referral. We are unable to process it as received because the following required field(s) are missing or could not be verified:</p>
    <ul style={{margin:"10px 0",paddingLeft:0,listStyle:"none"}}>{missing.map(m=><li key={m} style={{fontFamily:C.mono,fontSize:13,color:C.red,padding:"3px 0"}}>— {m}</li>)}</ul>
    <p style={{fontFamily:C.sans,fontSize:13,color:C.inkSoft,lineHeight:1.6,margin:"10px 0 0"}}>Please resubmit with the item(s) above completed and we will schedule the patient promptly.</p>
  </div>);
}

function Disposition({d}){const x=DISPOSITION[d];return(<span style={{display:"inline-flex",alignItems:"center",gap:7,fontFamily:C.sans,fontSize:12,fontWeight:600,color:x.color,background:`${x.color}14`,padding:"5px 11px",borderRadius:20}}><span style={{width:7,height:7,borderRadius:"50%",background:x.color}}/>{x.label}</span>);}
function SectionTitle({children}){return(<div style={{fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:"0.09em",textTransform:"uppercase",color:C.inkFaint,margin:"26px 0 12px"}}>{children}</div>);}

// ---- Call Dock --------------------------------------------------------------
function CallDock({call, onEnd}){
  const s=CALL_STATUS[call.status]||CALL_STATUS.connecting;
  const mm=String(Math.floor(call.seconds/60)).padStart(2,"0");
  const ss=String(call.seconds%60).padStart(2,"0");
  const bodyRef=useRef(null);
  useEffect(()=>{ if(bodyRef.current) bodyRef.current.scrollTop=bodyRef.current.scrollHeight; },[call.transcript.length]);
  return(<div style={{position:"fixed",right:26,bottom:26,width:360,background:C.card,border:`1px solid ${C.line}`,borderRadius:14,boxShadow:"0 12px 40px rgba(10,74,62,0.18)",overflow:"hidden",zIndex:50,animation:"dockIn 0.3s ease both"}}>
    <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:C.tealDeep}}>
      <div style={{display:"flex",alignItems:"center",gap:9}}>
        <Ekg color="#EAF3EF" w={22}/>
        <span style={{fontFamily:C.sans,fontSize:13,fontWeight:600,color:"#EAF3EF"}}>{call.mode==="web"?"Web call · Front desk":"Outbound callback"}</span>
      </div>
      <span style={{fontFamily:C.mono,fontSize:12,color:"#BFE0D6"}}>{mm}:{ss}</span>
    </div>
    <div style={{padding:"10px 18px",display:"flex",alignItems:"center",gap:8,borderBottom:`1px solid ${C.line}`}}>
      <span style={{width:8,height:8,borderRadius:"50%",background:s.c,animation:s.pulse?"pulse 1.4s ease infinite":"none"}}/>
      <span style={{fontFamily:C.sans,fontSize:12.5,fontWeight:600,color:s.c}}>{s.t}</span>
      {call.to&&<span style={{fontFamily:C.mono,fontSize:11.5,color:C.inkFaint,marginLeft:"auto"}}>{call.to}</span>}
    </div>
    <div ref={bodyRef} style={{maxHeight:200,overflowY:"auto",padding:"12px 18px",display:"flex",flexDirection:"column",gap:10}}>
      {call.transcript.length===0&&<span style={{fontFamily:C.sans,fontSize:12,color:C.inkFaint,fontStyle:"italic"}}>Establishing connection…</span>}
      {call.transcript.map((t,i)=>{
        const sys=t.who==="system";
        return(<div key={i} style={{animation:"fadeUp 0.25s ease both"}}>
          {!sys&&<div style={{fontFamily:C.sans,fontSize:9.5,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:t.who==="agent"?C.teal:C.inkFaint,marginBottom:2}}>{t.who==="agent"?"Agent":"Caller"}</div>}
          <div style={{fontFamily:sys?C.mono:C.sans,fontSize:sys?11.5:13,color:sys?C.amber:C.ink,fontStyle:sys?"italic":"normal",lineHeight:1.5}}>{t.text}</div>
        </div>);
      })}
    </div>
    <div style={{padding:"12px 18px",borderTop:`1px solid ${C.line}`}}>
      <button onClick={onEnd} style={{width:"100%",fontFamily:C.sans,fontSize:13,fontWeight:600,color:call.status==="ended"?C.inkSoft:"#fff",background:call.status==="ended"?C.paper:C.red,border:call.status==="ended"?`1px solid ${C.line}`:"none",borderRadius:8,padding:"10px",cursor:"pointer"}}>{call.status==="ended"?"Close":"End call"}</button>
    </div>
  </div>);
}

const SCRIPTS = {
  web:[
    {at:0,status:"connecting"},
    {at:800,status:"live",line:{who:"agent",text:"Thank you for calling Greenfield Cardiology, how can I help you today?"}},
    {at:3400,line:{who:"caller",text:"Hi, I'd like to book a follow-up with Dr. Chen."}},
    {at:5600,line:{who:"agent",text:"Happy to help with that. May I have your full name?"}},
  ],
  outbound:[
    {at:0,status:"dialing"},
    {at:1000,status:"ringing"},
    {at:3200,status:"voicemail",line:{who:"system",text:"Voicemail detected — leaving PHI-free message only"}},
    {at:4400,line:{who:"agent",text:"This is a message from Greenfield Cardiology. Please call us back at 415-555-0120. Thank you."}},
    {at:7600,status:"ended",line:{who:"system",text:"Attempt 1 of 3 logged · next attempt eligible in 48 hours"}},
  ],
};

export default function App(){
  const [selected,setSelected]=useState(FAXES[0].id);
  const [call,setCall]=useState(null); // {mode,status,seconds,transcript[],to}
  const timers=useRef([]);
  const tick=useRef(null);
  const fax=FAXES.find(f=>f.id===selected);
  const counts={cleared:FAXES.filter(f=>f.disposition==="cleared").length,flagged:FAXES.filter(f=>f.disposition==="flagged").length,held:FAXES.filter(f=>f.disposition==="held").length};

  function clearTimers(){ timers.current.forEach(clearTimeout); timers.current=[]; if(tick.current){clearInterval(tick.current);tick.current=null;} }
  useEffect(()=>clearTimers,[]);

  function runSimulated(mode,to){
    setCall({mode,status:mode==="web"?"connecting":"dialing",seconds:0,transcript:[],to});
    tick.current=setInterval(()=>setCall(c=>c&&c.status!=="ended"?{...c,seconds:c.seconds+1}:c),1000);
    SCRIPTS[mode].forEach(step=>{
      timers.current.push(setTimeout(()=>{
        setCall(c=>{ if(!c) return c;
          const next={...c};
          if(step.status) next.status=step.status;
          if(step.line) next.transcript=[...c.transcript,step.line];
          if(step.status==="ended"&&tick.current){clearInterval(tick.current);tick.current=null;}
          return next;
        });
      },step.at));
    });
  }

  async function startWeb(){
    if(!LIVE) return runSimulated("web");
    // LIVE: backend mints a web-call token; browser SDK connects the mic.
    const r=await fetch(`${API_BASE}/calls/web`,{method:"POST"}); const {access_token}=await r.json();
    const {RetellWebClient}=await import("retell-client-js-sdk");
    const client=new RetellWebClient();
    setCall({mode:"web",status:"connecting",seconds:0,transcript:[],to:null});
    client.on("call_started",()=>setCall(c=>({...c,status:"live"})));
    client.on("update",u=>{ if(u.transcript?.length){const last=u.transcript[u.transcript.length-1]; setCall(c=>({...c,transcript:[...c.transcript.slice(0,-1),{who:last.role==="agent"?"agent":"caller",text:last.content}]}));} });
    client.on("call_ended",()=>setCall(c=>({...c,status:"ended"})));
    window.__retell=client; await client.startCall({accessToken:access_token});
  }
  async function startOutbound(toNumber,referralId){
    if(!LIVE) return runSimulated("outbound",toNumber);
    await fetch(`${API_BASE}/calls/outbound`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to_number:toNumber,referral_id:referralId})});
    setCall({mode:"outbound",status:"dialing",seconds:0,transcript:[],to:toNumber});
    // then poll GET /calls/{id} for status; omitted for brevity
  }
  function endCall(){ clearTimers(); if(LIVE&&window.__retell){try{window.__retell.stopCall();}catch(e){}} setCall(null); }

  return(<div style={{minHeight:"100vh",background:C.paper,color:C.ink,fontFamily:C.sans,backgroundImage:`url("${GRAIN}")`,backgroundSize:"120px 120px"}}>
    <style>{FONTS}</style>

    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 34px",borderBottom:`1px solid ${C.line}`,background:"rgba(252,251,247,0.7)",backdropFilter:"blur(6px)",position:"sticky",top:0,zIndex:5,animation:"fadeUp 0.5s ease both"}}>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <div style={{width:42,height:42,borderRadius:10,background:C.tealDeep,display:"flex",alignItems:"center",justifyContent:"center"}}><Ekg color="#EAF3EF" w={26}/></div>
        <div><div style={{fontFamily:C.display,fontSize:20,fontWeight:600,lineHeight:1.05}}>Greenfield Cardiology</div>
          <div style={{fontFamily:C.sans,fontSize:11.5,letterSpacing:"0.16em",textTransform:"uppercase",color:C.inkFaint,marginTop:1}}>Fax Intake Console</div></div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:24}}>
        <button onClick={startWeb} style={{display:"inline-flex",alignItems:"center",gap:8,fontFamily:C.sans,fontSize:12.5,fontWeight:600,color:"#fff",background:C.teal,border:"none",borderRadius:8,padding:"9px 15px",cursor:"pointer",boxShadow:"0 2px 8px rgba(15,110,91,0.2)"}}><PhoneWave/>Talk to front desk</button>
        <div style={{display:"flex",alignItems:"center",gap:20}}>
          {[["Received",FAXES.length,C.ink],["Cleared",counts.cleared,C.green],["Flagged",counts.flagged,C.amber],["Held",counts.held,C.red]].map(([l,n,c])=>(
            <div key={l} style={{textAlign:"right"}}><div style={{fontFamily:C.mono,fontSize:20,fontWeight:500,color:c,lineHeight:1}}>{n}</div>
              <div style={{fontFamily:C.sans,fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",color:C.inkFaint,marginTop:3}}>{l}</div></div>))}
        </div>
      </div>
    </header>

    <div style={{display:"grid",gridTemplateColumns:"320px 1fr",minHeight:"calc(100vh - 83px)"}}>
      <aside style={{borderRight:`1px solid ${C.line}`,padding:"18px 16px"}}>
        <div style={{fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:"0.09em",textTransform:"uppercase",color:C.inkFaint,padding:"0 8px 12px"}}>Incoming · Today</div>
        {FAXES.map((f,i)=>{const active=f.id===selected;const x=DISPOSITION[f.disposition];return(
          <button key={f.id} onClick={()=>setSelected(f.id)} style={{display:"block",width:"100%",textAlign:"left",cursor:"pointer",padding:"13px 14px",marginBottom:8,borderRadius:9,border:`1px solid ${active?C.teal:C.line}`,background:active?C.card:"transparent",borderLeft:`3px solid ${active?x.color:"transparent"}`,boxShadow:active?"0 2px 8px rgba(15,110,91,0.08)":"none",transition:"all 0.18s ease",animation:"fadeUp 0.4s ease both",animationDelay:`${0.06*i}s`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}><span style={{fontFamily:C.sans,fontSize:10.5,fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase",color:C.teal}}>{f.typeLabel}</span><span style={{width:8,height:8,borderRadius:"50%",background:x.color}}/></div>
            <div style={{fontFamily:C.display,fontSize:16,color:C.ink,lineHeight:1.15}}>{f.patient}</div>
            <div style={{fontFamily:C.sans,fontSize:11.5,color:C.inkFaint,marginTop:3}}>{f.from}</div>
            <div style={{fontFamily:C.mono,fontSize:10.5,color:C.inkFaint,marginTop:6}}>{f.received}</div>
          </button>);})}
        <div style={{marginTop:14,padding:"14px",border:`1px dashed ${C.line}`,borderRadius:9,textAlign:"center"}}>
          <div style={{fontFamily:C.sans,fontSize:12,color:C.inkSoft,marginBottom:8}}>Drop a fax to process</div>
          <button style={{fontFamily:C.sans,fontSize:12,fontWeight:600,color:C.card,background:C.tealDeep,border:"none",borderRadius:7,padding:"8px 16px",cursor:"pointer"}}>Upload PDF / image</button>
          <div style={{fontFamily:C.mono,fontSize:9.5,color:C.inkFaint,marginTop:8}}>POST → /process</div>
        </div>
      </aside>

      <main key={selected} style={{padding:"30px 40px",animation:"panelIn 0.32s ease both",maxWidth:860}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:20}}>
          <div><div style={{fontFamily:C.sans,fontSize:11,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:C.teal,marginBottom:6}}>{fax.typeLabel}</div>
            <h1 style={{fontFamily:C.display,fontSize:30,fontWeight:600,margin:0,lineHeight:1.05}}>{fax.patient}</h1>
            <div style={{fontFamily:C.sans,fontSize:13,color:C.inkSoft,marginTop:6}}>From {fax.from} · received {fax.received}</div></div>
          <Disposition d={fax.disposition}/>
        </div>

        <div style={{display:"flex",alignItems:"center",gap:14,marginTop:22,padding:"14px 18px",background:C.card,border:`1px solid ${C.line}`,borderRadius:9}}>
          <span style={{fontFamily:C.sans,fontSize:12,color:C.inkSoft}}>Classified as</span>
          <span style={{fontFamily:C.display,fontSize:15,fontWeight:600}}>{fax.classification.label}</span>
          <div style={{flex:1,height:6,background:C.paper,borderRadius:3,overflow:"hidden",marginLeft:8}}><div style={{width:`${fax.classification.confidence*100}%`,height:"100%",background:C.teal,borderRadius:3}}/></div>
          <span style={{fontFamily:C.mono,fontSize:13,color:C.teal,fontWeight:500}}>{(fax.classification.confidence*100).toFixed(0)}%</span>
        </div>

        {fax.callback&&(<div style={{marginTop:16,padding:"16px 18px",background:"rgba(15,110,91,0.05)",border:`1px solid rgba(15,110,91,0.22)`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}>
          <div><div style={{fontFamily:C.sans,fontSize:13,fontWeight:600,color:C.tealDeep}}>{fax.callback.reason}</div>
            <div style={{fontFamily:C.mono,fontSize:12,color:C.inkSoft,marginTop:3}}>{fax.phone} · up to 3 attempts, 48h apart · PHI-free voicemail</div></div>
          <button onClick={()=>startOutbound(fax.phone,fax.callback.referralId)} style={{display:"inline-flex",alignItems:"center",gap:8,fontFamily:C.sans,fontSize:13,fontWeight:600,color:"#fff",background:C.tealDeep,border:"none",borderRadius:8,padding:"10px 16px",cursor:"pointer",whiteSpace:"nowrap"}}><PhoneWave/>Initiate callback</button>
        </div>)}

        <SectionTitle>Extracted fields</SectionTitle>
        <div>{fax.fields.map(f=><Field key={f.label} f={f}/>)}</div>
        {fax.labs&&(<><SectionTitle>Complete blood count</SectionTitle><LabTable labs={fax.labs}/></>)}

        <SectionTitle>Human review queue</SectionTitle>
        {fax.review.length===0?(<div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",background:"rgba(47,125,50,0.06)",border:`1px solid rgba(47,125,50,0.2)`,borderRadius:9}}><span style={{width:8,height:8,borderRadius:"50%",background:C.green}}/><span style={{fontFamily:C.sans,fontSize:13,color:C.ink}}>Nothing flagged. {fax.note}</span></div>
        ):(<div style={{border:`1px solid ${C.line}`,borderRadius:9,overflow:"hidden"}}>{fax.review.map((r,i)=>(<div key={r.field} style={{display:"flex",gap:14,padding:"13px 16px",alignItems:"baseline",borderTop:i?`1px solid ${C.line}`:"none",background:C.card}}><span style={{fontFamily:C.mono,fontSize:13,color:C.red,fontWeight:500,minWidth:130}}>{r.field}</span><span style={{fontFamily:C.sans,fontSize:12.5,color:C.inkSoft}}>{r.reason}</span></div>))}</div>)}

        {fax.denyBack&&(<><SectionTitle>Deny-back letter</SectionTitle><DenyBackCard patient={fax.patient} missing={fax.denyBack}/></>)}
        <div style={{height:60}}/>
      </main>
    </div>

    {call&&<CallDock call={call} onEnd={endCall}/>}
  </div>);
}
