import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import Stage from "./Stage.jsx";
import Avatar from "./Avatar.jsx";

// Camera framing. A 22 degree field of view is a portrait lens: it compresses
// facial perspective the way a real headshot does, which is both more
// flattering and much more forgiving of a generated model's proportions.
// Anything wider pushes the nose forward and the result reads as a video-game
// character no matter how good the lighting is.
// The model's own bounding box is ~3.3 units tall, so a portrait framing sits
// a long way back: at a 22 degree vertical FOV the visible height is 0.389*d,
// and we want the head to occupy a little over half of it.
const DEFAULT_CAMERA = { fov: 22, near: 1, far: 40, position: [0.55, 0.55, 11.4] };
const DEFAULT_LOOK_AT = [0, 0.05, -0.34];

// Framing is overridable from the URL in debug mode (?cam=x,y,z&look=x,y,z&fov=n)
// so it can be dialled in against the real display without a rebuild - which is
// the only way to get it right, since "how big should a face be" depends on the
// panel size and how far away people stand.
const qp = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const nums = (v, dflt) => {
  if (!v) return dflt;
  const parts = v.split(",").map(Number);
  return parts.length === dflt.length && parts.every(Number.isFinite) ? parts : dflt;
};
export const CAMERA = {
  ...DEFAULT_CAMERA,
  fov: Number(qp.get("fov")) || DEFAULT_CAMERA.fov,
  position: nums(qp.get("cam"), DEFAULT_CAMERA.position),
};
const LOOK_AT = nums(qp.get("look"), DEFAULT_LOOK_AT);

/**
 * A WebGL failure must never be a blank screen in a lobby, so anything thrown
 * below this point - a GLB that will not parse, a driver that will not give us
 * a context - falls back to the 2D presence motif and the kiosk stays fully
 * conversational.
 */
class CanvasBoundary extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error("[kiosk] 3D scene failed, falling back to 2D:", err); this.props.onFail?.(err); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function KioskCanvas({ signals, animators, audio, onFail, onAvatarReady, paused = false }) {
  const [quality, setQuality] = useState(1);
  const [dpr, setDpr] = useState(1);
  const glRef = useRef(null);

  // Adaptive quality. Measured on the machine that is actually running, not
  // assumed from a dev laptop: p95 frame time over a rolling window steps the
  // renderer down before a visitor ever sees a stutter, and only steps back up
  // after a sustained period of headroom so it cannot oscillate.
  const frames = useRef([]);
  const lastAdjust = useRef(0);
  const onFrame = useCallback((dt) => {
    const f = frames.current;
    f.push(dt * 1000);
    if (f.length > 180) f.shift();
    const now = performance.now();
    if (f.length < 180 || now - lastAdjust.current < 3000) return;
    const sorted = [...f].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    if (p95 > 15 && quality > 0.6) { setQuality(0.6); setDpr(1); lastAdjust.current = now; }
    else if (p95 < 8 && quality < 1) { setQuality(1); lastAdjust.current = now; }
  }, [quality]);

  const handleCreated = useCallback(({ gl, camera }) => {
    glRef.current = gl;
    camera.lookAt(...LOOK_AT);

    // A 24/7 display will eventually lose its GL context to a driver reset.
    // Without preventDefault() that is permanent and the screen stays black
    // until a human notices, which in a lobby could be days.
    const canvas = gl.domElement;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      console.warn("[kiosk] WebGL context lost; requesting restore");
    });
    canvas.addEventListener("webglcontextrestored", () => {
      console.info("[kiosk] WebGL context restored");
    });
  }, []);

  useEffect(() => () => { glRef.current = null; }, []);

  return (
    <CanvasBoundary onFail={onFail}>
      <Canvas
        frameloop={paused ? "never" : "always"}
        dpr={dpr}
        shadows={false}
        gl={{
          antialias: true,
          alpha: true,
          stencil: false,
          depth: true,
          powerPreference: "high-performance",
          preserveDrawingBuffer: false,
          failIfMajorPerformanceCaveat: false,
        }}
        camera={CAMERA}
        onCreated={handleCreated}
        style={{ width: "100%", height: "100%", background: "transparent" }}
      >
        <Stage quality={quality} />
        <Suspense fallback={null}>
          <Avatar
            signals={signals}
            animators={animators}
            audio={audio}
            quality={quality}
            onReady={onAvatarReady}
          />
        </Suspense>
        <FrameProbe onFrame={onFrame} />
      </Canvas>
    </CanvasBoundary>
  );
}

// Separate component so the probe keeps measuring even while the model is
// still suspended, and so Avatar's frame loop stays the only place that
// touches the face. This is the one place a setState can originate from a
// frame callback, and it is throttled to at most one adjustment every three
// seconds - never per frame.
function FrameProbe({ onFrame }) {
  useFrame((_, dt) => onFrame(dt));
  return null;
}
