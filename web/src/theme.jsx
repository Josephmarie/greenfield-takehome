import React, { useState, useEffect } from "react";

// Shared design system for the Pareto Health surfaces.
//
// These tokens used to live at the top of App.jsx. They were lifted out
// verbatim so the kiosk (src/kiosk/) can consume the exact same palette,
// type stack and grain rather than forking a near-copy that drifts.
// Nothing here changed in the move.

export const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes panelIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes ring{0%{transform:scale(.7);opacity:.7}100%{transform:scale(2.2);opacity:0}}
@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
`;

export const C={paper:"#F6F4ED",card:"#FCFBF7",ink:"#1B1D1A",inkSoft:"#5A5E56",inkFaint:"#8A8E84",line:"#E4DFD2",
  teal:"#0F6E5B",tealDeep:"#0A4A3E",green:"#2F7D32",amber:"#A86A12",red:"#A6402F",
  display:"'Spectral',Georgia,serif",sans:"'IBM Plex Sans',system-ui,sans-serif",mono:"'IBM Plex Mono',ui-monospace,monospace"};

export const GRAIN="data:image/svg+xml;utf8,"+encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.025'/></svg>`);

export const Ekg=({color=C.teal,w=30})=>(<svg width={w} height={w*0.5} viewBox="0 0 60 30" fill="none"><path d="M0 15 H14 L19 5 L25 25 L31 15 H60" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
export const PhoneWave=({color="#fff",s=15})=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M5 4h3l2 5-2 1a11 11 0 005 5l1-2 5 2v3a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/></svg>);
export const Logo=({s=36,full=false})=>(<img src={full?"/pareto-health-logo.png":"/pareto-health-mark.png"} alt="Pareto Health" style={{height:s,width:"auto",display:"block",objectFit:"contain",flexShrink:0}}/>);

// True when the viewport is phone-width. Lets components apply mobile-only
// style overrides; desktop keeps its exact original values.
export function useIsMobile(bp=760){
 const[m,setM]=useState(typeof window!=="undefined"&&window.innerWidth<=bp);
 useEffect(()=>{const f=()=>setM(window.innerWidth<=bp);window.addEventListener("resize",f);return()=>window.removeEventListener("resize",f);},[bp]);
 return m;
}
