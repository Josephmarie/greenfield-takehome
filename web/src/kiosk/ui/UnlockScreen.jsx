import React from "react";
import { Logo } from "../../theme.jsx";
import { K } from "../kioskTheme.js";

// The screen a kiosk shows when the browser has not yet allowed it to make
// sound or open a microphone.
//
// This is the failure most likely to make the whole feature look broken on day
// one: a machine that boots unattended cannot satisfy Chrome's autoplay policy
// or a microphone permission prompt on its own. The production answer is the
// launch flags and the enterprise policy in KIOSK_SETUP.md. This is the
// belt-and-braces: one touch by a staff member at open of business arms audio
// for the whole day.
//
// So it is designed as a warm invitation, not an error. A visitor who walks up
// to an un-armed kiosk should see something beautiful that invites a touch,
// and touching it both starts their conversation and fixes the machine.
export default function UnlockScreen({ u, onUnlock }) {
  return (
    <div
      onPointerDown={onUnlock}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: u * 2.2,
        background: K.paper,
        cursor: "none",
        animation: "kioskRise .6s ease both",
      }}
    >
      <Logo s={u * 5.2} full />

      <div
        style={{
          fontFamily: K.display,
          fontSize: u * 5.0,
          fontWeight: 600,
          letterSpacing: "-0.018em",
          color: K.ink,
          marginTop: u * 1.2,
          textAlign: "center",
        }}
      >
        Meet our front desk
      </div>

      <div style={{ fontFamily: K.sans, fontSize: u * 1.9, color: K.inkSoft, textAlign: "center" }}>
        Touch anywhere to begin
      </div>

      <div
        style={{
          marginTop: u * 3,
          width: u * 9,
          height: u * 9,
          borderRadius: "50%",
          border: `${Math.max(1, u * 0.16)}px solid ${K.ringLine}`,
          animation: "kioskBreathe 3.6s ease-in-out infinite",
        }}
      />
    </div>
  );
}
