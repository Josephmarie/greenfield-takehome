import React from "react";
import { Logo } from "../../theme.jsx";
import { K } from "../kioskTheme.js";

// Persistent chrome: the mark top-left, the human fallback bottom-left.
// The phone number is on screen in every state on purpose — it is the one
// path in this building we are forbidden to touch, and therefore the most
// reliable thing a visitor can be pointed at when anything else fails.
export default function BrandBar({ u, phone = "+1 (415) 650-4518" }) {
  return (
    <>
      <div style={{ position: "absolute", left: u * 5, top: u * 4.2, display: "flex", alignItems: "center", gap: u * 1.4 }}>
        <Logo s={u * 3.4} />
        <span
          style={{
            fontFamily: K.sans,
            fontSize: u * 1.15,
            fontWeight: 600,
            letterSpacing: ".085em",
            textTransform: "uppercase",
            color: K.inkFaint,
          }}
        >
          Greenfield Cardiology
        </span>
      </div>

      <div style={{ position: "absolute", left: u * 5, bottom: u * 4.2 }}>
        <div
          style={{
            fontFamily: K.sans,
            fontSize: u * 0.98,
            fontWeight: 600,
            letterSpacing: ".085em",
            textTransform: "uppercase",
            color: K.inkFaint,
            marginBottom: u * 0.5,
          }}
        >
          Prefer to call
        </div>
        <div style={{ fontFamily: K.mono, fontSize: u * 1.6, color: K.inkSoft, letterSpacing: ".01em" }}>{phone}</div>
      </div>
    </>
  );
}
