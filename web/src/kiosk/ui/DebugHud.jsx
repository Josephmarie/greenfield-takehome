import React, { useEffect, useRef, useState } from "react";
import { K } from "../kioskTheme.js";

// Enabled with ?debug=1. This is also the on-site tuning instrument: the mic
// RMS / noise-floor / threshold readout is how you set the wake sensitivity
// for a specific lobby in five minutes instead of guessing from a desk.
export default function DebugHud({ signals, extra }) {
  const [, force] = useState(0);
  const frames = useRef([]);
  const last = useRef(performance.now());

  useEffect(() => {
    let raf = 0;
    let n = 0;
    const tick = () => {
      const now = performance.now();
      const dt = now - last.current;
      last.current = now;
      const f = frames.current;
      f.push(dt);
      if (f.length > 600) f.shift();
      if (++n % 15 === 0) force((x) => x + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const f = frames.current;
  const stat = (q) => {
    if (!f.length) return 0;
    const s = [...f].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * q))];
  };
  const p50 = stat(0.5), p95 = stat(0.95), p99 = stat(0.99);
  const dropped = f.filter((d) => d > 20).length;
  const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + " MB" : "n/a";

  const rows = [
    ["state", signals?.state ?? "—"],
    ["fps", f.length ? (1000 / p50).toFixed(1) : "—"],
    ["p50 / p95 / p99", `${p50.toFixed(1)} / ${p95.toFixed(1)} / ${p99.toFixed(1)} ms`],
    ["dropped (>20ms)", `${dropped} / ${f.length}`],
    ["heap", mem],
    ["amp", (signals?.amp ?? 0).toFixed(3)],
    ["mic", (signals?.micLevel ?? 0).toFixed(3)],
    ...Object.entries(extra || {}),
  ];

  return (
    <div
      style={{
        position: "absolute",
        right: 12,
        top: 12,
        zIndex: 50,
        background: "rgba(252,251,247,.94)",
        border: `1px solid ${K.line}`,
        borderRadius: 8,
        padding: "10px 12px",
        fontFamily: K.mono,
        fontSize: 11.5,
        lineHeight: 1.65,
        color: K.inkSoft,
        minWidth: 250,
        boxShadow: K.shadowMd,
        pointerEvents: "none",
      }}
    >
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
          <span style={{ color: K.inkFaint }}>{k}</span>
          <span style={{ color: p99 > 16.6 && k.startsWith("p50") ? K.red : K.ink }}>{String(v)}</span>
        </div>
      ))}
    </div>
  );
}
