import { C } from "../theme.jsx";

// Kiosk-only derived tokens. Every value here is either taken from C or
// derived from it — no new hues enter the brand through this file. That is
// what keeps the kiosk reading as the same product rather than a bolt-on.
export const K = {
  ...C,

  halo:      "rgba(15,110,91,.10)",   // C.teal @ 10%
  haloEdge:  "rgba(15,110,91,.00)",
  ringLine:  "rgba(15,110,91,.30)",
  shadowXL:  "0 40px 120px rgba(10,74,62,.22)",   // same teal-tinted family as App.jsx
  shadowMd:  "0 12px 40px rgba(10,74,62,.18)",

  // 3D lighting rig, expressed as brand colours
  keyLight:  "#FFF6E8",   // warm paper
  fillLight: "#CFE3DB",   // teal bounce
  rimLight:  C.teal,
  shadowCol: C.tealDeep,
};

// The kiosk's own base rules. Tailwind's preflight IS active (index.css pulls
// in @tailwind base), so these are stated explicitly rather than assumed.
export const KIOSK_BASE = `
html,body,#root{margin:0;padding:0;height:100%;width:100%}
body{overflow:hidden;overscroll-behavior:none;-webkit-user-select:none;user-select:none;
  -webkit-tap-highlight-color:transparent;text-rendering:optimizeLegibility}
#root{cursor:none}
@keyframes kioskRing{0%{transform:scale(.72);opacity:.55}100%{transform:scale(2.05);opacity:0}}
@keyframes kioskRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes kioskBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.028)}}
@keyframes kioskDot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
@media (prefers-reduced-motion: reduce){
  *{animation-duration:.01ms !important;animation-iteration-count:1 !important}
}
`;
