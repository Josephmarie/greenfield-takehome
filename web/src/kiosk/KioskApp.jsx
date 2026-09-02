import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FONTS } from "../theme.jsx";
import { K, KIOSK_BASE } from "./kioskTheme.js";
import { useViewport } from "./useViewport.js";
import { createSignals } from "./signals/Signals.js";
import { createAudioFeatures } from "./signals/AudioFeatures.js";
import { createAnimators } from "./animators/animators.js";
import { createTargetBuffer } from "./animators/TargetBuffer.js";
import { S } from "./state/kioskMachine.js";
import { useKioskMachine } from "./state/useKioskMachine.js";
import Backdrop from "./ui/Backdrop.jsx";
import BrandBar from "./ui/BrandBar.jsx";
import AttractScreen from "./ui/AttractScreen.jsx";
import AvatarFallback2D from "./ui/AvatarFallback2D.jsx";
import Captions from "./ui/Captions.jsx";
import StatusRibbon from "./ui/StatusRibbon.jsx";
import UnlockScreen from "./ui/UnlockScreen.jsx";
import DebugHud from "./ui/DebugHud.jsx";

const KioskCanvas = React.lazy(() => import("./scene/KioskCanvas.jsx"));

const params = new URLSearchParams(window.location.search);
export const FLAGS = {
  debug: params.get("debug") === "1",
  mock: params.get("mock") === "1",
  wake: params.get("wake") || "presence",
  force: params.get("force") || null,
  no3d: params.get("no3d") === "1",
  // Visitor captions are OFF by default: a scrolling transcript of a medical
  // conversation on a waiting-room wall is a real privacy problem.
  userCaptions: params.get("userCaptions") === "1",
};

export default function KioskApp() {
  const vp = useViewport();

  // Created once and mutated in place for the life of the kiosk. None of these
  // are React state, and nothing on the 60 Hz path re-renders React.
  const signals = useMemo(() => createSignals(), []);
  const audio = useMemo(() => createAudioFeatures(), []);
  const animators = useMemo(() => createAnimators(), []);

  const [use3D, setUse3D] = useState(!FLAGS.no3d);
  const [avatarInfo, setAvatarInfo] = useState(null);

  const machine = useKioskMachine({
    signals,
    audio,
    mock: FLAGS.mock,
    wakeEngine: FLAGS.wake,
  });

  const ctx = machine.ctx;
  const state = FLAGS.force || ctx.state;
  signals.state = state;

  // The 2D fallback has no <Canvas>, and therefore no useFrame, so it needs its
  // own clock. Without one the audio features would never advance and the
  // fallback's pulse would sit dead still during a live conversation.
  //
  // It runs the real animator pipeline against a real buffer even though
  // nothing reads the morph channels: the gaze animator publishes into
  // signals.attention and the others keep their internal state coherent, so
  // switching between 3D and 2D mid-session does not produce a jump.
  const fallbackBuf = useMemo(() => createTargetBuffer(), []);
  const rafRef = useRef(0);
  useEffect(() => {
    if (use3D) return undefined;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      signals.t += dt;
      signals.dt = dt;
      signals.frame++;
      audio.update(signals, dt, now);
      animators.update(dt, signals, fallbackBuf);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [use3D, signals, audio, animators, fallbackBuf]);

  const focus = useMemo(() => ({ x: 0.5, y: vp.portrait ? 0.34 : 0.42 }), [vp.portrait]);
  const onFail = useCallback(() => setUse3D(false), []);
  const onAvatarReady = useCallback((info) => {
    setAvatarInfo(info);
    machine.assetsReady();
  }, [machine]);

  // In 2D fallback there is no model to wait for, so the kiosk is ready at once.
  useEffect(() => { if (!use3D) machine.assetsReady(); }, [use3D, machine]);

  const stageW = vp.portrait ? vp.w : Math.min(vp.w, vp.h * 1.15);
  const stageH = vp.portrait ? vp.h * 0.58 : vp.h * 0.84;

  const inCall = state === S.LISTENING || state === S.THINKING || state === S.SPEAKING || state === S.WRAPPING;
  const showAttract = state === S.IDLE || state === S.BOOT;

  return (
    <div
      onPointerDown={machine.touch}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: K.paper,
        color: K.ink,
        fontFamily: K.sans,
      }}
    >
      <style>{FONTS}</style>
      <style>{KIOSK_BASE}</style>

      <Backdrop vp={vp} focusX={focus.x} focusY={focus.y} />

      <div
        style={{
          position: "absolute",
          left: `${focus.x * 100}%`,
          top: `${focus.y * 100}%`,
          width: stageW,
          height: stageH,
          transform: "translate(-50%,-50%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {use3D ? (
          <Suspense fallback={<AvatarFallback2D u={vp.u} level={0} listening />}>
            <KioskCanvas
              signals={signals}
              animators={animators}
              audio={audio}
              onFail={onFail}
              onAvatarReady={onAvatarReady}
            />
          </Suspense>
        ) : (
          <AvatarFallback2D u={vp.u} level={signals.amp} listening={state !== S.ERROR} />
        )}
      </div>

      {showAttract && <AttractScreen u={vp.u} />}

      {inCall && (
        <Captions
          u={vp.u}
          agentLine={ctx.agentLine}
          userLine={ctx.userLine}
          showUser={FLAGS.userCaptions}
          dim={state === S.WRAPPING}
        />
      )}

      <StatusRibbon
        u={vp.u}
        state={state}
        warming={ctx.warming}
        error={ctx.error}
        nudge={ctx.nudge}
      />

      <BrandBar u={vp.u} />

      {state === S.LOCKED && <UnlockScreen u={vp.u} onUnlock={machine.touch} />}

      {FLAGS.debug && (
        <DebugHud
          signals={signals}
          extra={{
            vp: `${vp.w}x${vp.h}`,
            render: use3D ? "3D" : "2D fallback",
            mic: machine.micOwner() || "none",
            session: FLAGS.mock ? "mock" : "retell",
            morphs: avatarInfo ? `${avatarInfo.found} found / ${avatarInfo.missing.length} missing` : "loading",
          }}
        />
      )}
    </div>
  );
}
