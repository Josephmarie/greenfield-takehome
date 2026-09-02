import React from "react";
import { GRAIN } from "../../theme.jsx";
import { K } from "../kioskTheme.js";

// The surface the kiosk lives on: the same paper + grain as the rest of the
// app, plus a soft teal halo where the avatar sits. The halo is a CSS radial
// gradient rather than a bloom pass in Three — free, GPU-composited, and it
// keeps the 3D canvas transparent so the avatar sits *inside* the brand
// surface instead of on top of a separate 3D background.
export default function Backdrop({ vp, focusX = 0.5, focusY = 0.42 }) {
  const fx = (focusX * 100).toFixed(1) + "%";
  const fy = (focusY * 100).toFixed(1) + "%";
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, background: K.paper, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse ${vp.u * 62}px ${vp.u * 54}px at ${fx} ${fy}, ${K.halo}, ${K.haloEdge} 70%)`,
        }}
      />
      {/* vignette: keeps the eye on the face on a large panel */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(27,29,26,.045) 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url("${GRAIN}")`,
          backgroundSize: `${Math.round(vp.u * 12)}px ${Math.round(vp.u * 12)}px`,
          opacity: 0.9,
        }}
      />
    </div>
  );
}
