import React from "react";
import { K } from "../kioskTheme.js";

// What the screen says during a conversation.
//
// A privacy decision is baked in here, not a styling one. This is a display on
// a wall in a cardiology waiting room, and a scrolling transcript of a medical
// conversation on it would be a genuine PHI exposure that the phone line never
// had. So: only the agent's most recent line is shown, large; the visitor's own
// speech is NOT rendered at all unless explicitly enabled, and even then it is
// small and truncated. Nothing is ever persisted and there is no history.
//
// It is a lobby display, not a chat window - and the constraint makes it better
// looking as well as safer.
export default function Captions({ u, agentLine, userLine, showUser = false, dim = false }) {
  const hasAgent = !!agentLine;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: u * 9,
        width: Math.min(u * 120, u * 1000),
        maxWidth: "84vw",
        textAlign: "center",
        pointerEvents: "none",
        opacity: dim ? 0.45 : 1,
        transition: "opacity .5s ease",
      }}
    >
      {showUser && userLine && (
        <div
          style={{
            fontFamily: K.mono,
            fontSize: u * 1.35,
            color: K.inkFaint,
            marginBottom: u * 1.6,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {userLine}
        </div>
      )}

      <div
        key={agentLine}
        style={{
          fontFamily: K.display,
          fontSize: u * 3.9,
          fontWeight: 500,
          lineHeight: 1.22,
          letterSpacing: "-0.012em",
          color: K.ink,
          minHeight: u * 5,
          animation: hasAgent ? "kioskRise .45s cubic-bezier(.22,.61,.36,1) both" : "none",
        }}
      >
        {agentLine}
      </div>
    </div>
  );
}
