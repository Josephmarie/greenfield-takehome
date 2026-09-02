import React from "react";
import { K } from "../kioskTheme.js";
import { S } from "../state/kioskMachine.js";

// One line of status under the figure, and the small dots that stand in for
// "she is thinking". Deliberately quiet: on a lobby screen the face carries the
// state, and text is only there to remove ambiguity.

function Dots({ u, color }) {
  return (
    <span style={{ display: "inline-flex", gap: u * 0.42, alignItems: "center", marginLeft: u * 0.8 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: u * 0.5,
            height: u * 0.5,
            borderRadius: "50%",
            background: color,
            animation: `kioskDot 1.25s ease-in-out ${i * 0.16}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

export default function StatusRibbon({ u, state, warming, error, nudge, phone = "+1 (415) 650-4518" }) {
  let label = null;
  let color = K.teal;
  let dots = false;

  switch (state) {
    case S.WAKING:
      label = "One moment";
      break;
    case S.CONNECTING:
      // Honest about a cold start rather than pretending. Because a person
      // appears to be waiting WITH you, 30 seconds reads as patience instead of
      // breakage - which is most of the reason a 3D avatar earns its keep.
      label = warming ? "Waking the front desk - the first call of the day can take a minute" : "Connecting you";
      dots = true;
      color = warming ? K.amber : K.teal;
      break;
    case S.LISTENING:
      label = nudge ? "Still there?" : "Listening";
      break;
    case S.THINKING:
      label = "Thinking";
      dots = true;
      break;
    case S.WRAPPING:
      label = "Thanks for stopping by";
      break;
    case S.ERROR:
      label = `${error || "Something went wrong"} - touch to try again, or call ${phone}`;
      color = K.red;
      break;
    default:
      return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: u * 4.4,
        display: "flex",
        alignItems: "center",
        gap: u * 0.9,
        fontFamily: K.sans,
        fontSize: u * 1.5,
        color,
        letterSpacing: ".005em",
        pointerEvents: "none",
        animation: "kioskRise .4s ease both",
        maxWidth: "82vw",
        textAlign: "center",
      }}
    >
      <span
        style={{
          width: u * 0.75,
          height: u * 0.75,
          borderRadius: "50%",
          background: color,
          animation: state === S.LISTENING ? "pulse 1.6s ease infinite" : "none",
          flexShrink: 0,
        }}
      />
      <span>{label}</span>
      {dots && <Dots u={u} color={color} />}
    </div>
  );
}
