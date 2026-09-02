import React from "react";
import { Ekg } from "../../theme.jsx";
import { K } from "../kioskTheme.js";
import PresenceRings from "./PresenceRings.jsx";

// The kiosk with no 3D at all.
//
// This is both the Phase-0/1 stand-in and the permanent fallback for WebGL
// failure, a lost GL context, or a GLB that will not load. It is the existing
// tealDeep disc + EKG glyph from App.jsx:178, scaled up and driven by the
// same amplitude signal the avatar's jaw uses — so the kiosk stays fully
// conversational and on-brand even when the face is unavailable. A blank
// screen in a lobby is far worse than a beautiful circle.
export default function AvatarFallback2D({ u, level = 0, listening = true }) {
  const disc = u * 27;
  const scale = 1 + level * 0.06;
  return (
    <div style={{ position: "relative", width: u * 52, height: u * 52 }}>
      <PresenceRings u={u} size={32} level={level} active={listening} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: disc,
          height: disc,
          marginLeft: -disc / 2,
          marginTop: -disc / 2,
          borderRadius: "50%",
          background: K.tealDeep,
          boxShadow: K.shadowXL,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${scale.toFixed(4)})`,
          transition: "transform 90ms linear",
          animation: listening ? "kioskBreathe 5.2s ease-in-out infinite" : "none",
        }}
      >
        <Ekg color="#EAF3EF" w={disc * 0.52} />
      </div>
    </div>
  );
}
