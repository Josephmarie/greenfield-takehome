import React from "react";
import { K } from "../kioskTheme.js";

// The concentric-ring motif from the existing call screen (App.jsx:177),
// scaled to kiosk size. Reusing it is deliberate: it is the visual signature
// visitors already meet on the web app and on the phone-call screen, so the
// kiosk reads as the same product. It also doubles as the avatar's stand-in
// until the 3D head loads, and as a live "the mic is open" indicator.
export default function PresenceRings({ u, size = 34, level = 0, active = true, count = 3 }) {
  const px = u * size;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: px,
        height: px,
        marginLeft: -px / 2,
        marginTop: -px / 2,
        pointerEvents: "none",
      }}
    >
      {active &&
        Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: `${Math.max(1, u * 0.15)}px solid ${K.ringLine}`,
              animation: `kioskRing ${3.6 - level * 0.9}s cubic-bezier(.22,.61,.36,1) ${i * 1.2}s infinite`,
            }}
          />
        ))}
    </div>
  );
}
