import React from "react";
import { K } from "../kioskTheme.js";

// The idle state. This is what the lobby looks at all day, so it is the most
// important screen in the kiosk: calm, unhurried, and clearly an invitation
// rather than an interface.
export default function AttractScreen({ u, hint = "Say hello, or touch anywhere to begin" }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: u * 9,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: u * 1.3,
        animation: "kioskRise .8s cubic-bezier(.22,.61,.36,1) both",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: K.sans,
          fontSize: u * 1.1,
          fontWeight: 600,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: K.teal,
        }}
      >
        Front desk
      </div>

      <div
        style={{
          fontFamily: K.display,
          fontSize: u * 5.6,
          fontWeight: 600,
          letterSpacing: "-0.018em",
          lineHeight: 1.06,
          color: K.ink,
          textAlign: "center",
        }}
      >
        How can we help you today?
      </div>

      <div
        style={{
          fontFamily: K.sans,
          fontSize: u * 1.85,
          color: K.inkSoft,
          textAlign: "center",
          marginTop: u * 0.4,
        }}
      >
        {hint}
      </div>
    </div>
  );
}
