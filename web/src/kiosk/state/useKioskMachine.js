import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reduce, initialContext, S, T } from "./kioskMachine.js";
import { syncState } from "../signals/Signals.js";
import { createRetellSession } from "../voice/RetellSession.js";
import { createMockSession } from "../voice/MockRetellSession.js";
import { createMicArbiter } from "../voice/MicArbiter.js";
import { createPresenceEngine } from "../voice/PresenceEngine.js";
import { API_BASE } from "../../config.js";

// Runs the pure machine and executes the effects it asks for.
//
// Everything impure lives here: fetch, timers, the microphone, the Retell SDK,
// the AudioContext. The reducer itself stays testable in plain node, which is
// where all the conversation-flow confidence comes from.

const TOKEN_TIMEOUT_MS = 60000;

export function useKioskMachine({ signals, audio, mock = false, wakeEngine = "presence", onEvent } = {}) {
  const [ctx, setCtx] = useState(() => initialContext());
  const ctxRef = useRef(ctx);
  const timers = useRef(new Map());
  const session = useRef(null);
  const mic = useRef(null);
  const wake = useRef(null);
  const audioCtx = useRef(null);
  const abort = useRef(null);
  const disposed = useRef(false);

  if (!mic.current) mic.current = createMicArbiter();

  const dispatch = useCallback((event) => {
    if (disposed.current) return;
    const now = performance.now();
    const r = reduce(ctxRef.current, event, now);
    const changed = r.ctx !== ctxRef.current;
    ctxRef.current = r.ctx;
    if (changed) {
      syncState(signals, r.ctx, now);
      setCtx(r.ctx);
    }
    onEvent?.(event, r.ctx);
    r.effects.forEach(runEffect);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the shared AudioContext ───────────────────────────────────────────────
  // One for the life of the kiosk, suspended rather than closed. Chrome caps
  // concurrent contexts, and create/close churn over a full day is a leak.
  const getAudioContext = useCallback(() => {
    if (!audioCtx.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx.current = new AC();
    }
    return audioCtx.current;
  }, []);

  // ── wake listener ─────────────────────────────────────────────────────────
  const startWake = useCallback(async () => {
    if (wake.current) return;
    const engine = createPresenceEngine();
    const stream = await mic.current.openStream();
    if (!stream) { console.warn("[kiosk] no microphone; touch to talk only"); return; }
    wake.current = engine;
    await engine.start(stream, {
      audioContext: getAudioContext(),
      onWake: () => dispatch({ type: "WAKE_DETECTED" }),
      onLevel: (l) => { signals.micLevel = Math.min(1, l.rms * 12); signals.micDebug = l; },
    });
  }, [dispatch, getAudioContext, signals]);

  const stopWake = useCallback(async () => {
    const w = wake.current;
    wake.current = null;
    signals.micLevel = 0;
    if (w) await w.stop();
  }, [signals]);

  // ── effects ───────────────────────────────────────────────────────────────
  function runEffect(fx) {
    switch (fx.type) {
      case "TIMER": {
        clearTimeout(timers.current.get(fx.id));
        timers.current.set(fx.id, setTimeout(() => {
          timers.current.delete(fx.id);
          dispatch({ type: "TIMER", id: fx.id });
        }, fx.ms));
        break;
      }
      case "CANCEL_TIMER": {
        clearTimeout(timers.current.get(fx.id));
        timers.current.delete(fx.id);
        break;
      }
      case "PING_WARM": {
        // Fire and forget. Keeps the free-tier backend awake so a real visitor
        // never meets a 30-60s cold start; also fired the instant a wake is
        // detected, 900ms before the token is actually needed.
        fetch(`${API_BASE}/healthz`, { method: "GET", mode: "no-cors", cache: "no-store" })
          .catch(() => fetch(`${API_BASE}/docs`, { mode: "no-cors", cache: "no-store" }).catch(() => {}));
        break;
      }
      case "ACQUIRE_MIC": {
        if (fx.owner === "wake") mic.current.acquire("wake", stopWake).then(startWake);
        else mic.current.acquire("call", stopWake);
        break;
      }
      case "MINT_TOKEN": {
        abort.current?.abort();
        const ac = new AbortController();
        abort.current = ac;
        const timeout = setTimeout(() => ac.abort(), TOKEN_TIMEOUT_MS);

        if (mock) {
          clearTimeout(timeout);
          dispatch({ type: "TOKEN_OK", token: "mock", callId: "mock" });
          break;
        }
        fetch(`${API_BASE}/calls/web`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent: "kiosk",
            metadata: { surface: "kiosk", location: "sf_lobby" },
          }),
          signal: ac.signal,
        })
          .then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then(({ access_token, call_id }) => {
            clearTimeout(timeout);
            dispatch({ type: "TOKEN_OK", token: access_token, callId: call_id });
          })
          .catch((e) => {
            clearTimeout(timeout);
            if (ac.signal.aborted && ctxRef.current.state !== S.CONNECTING) return;
            dispatch({ type: "TOKEN_FAIL", message: e?.message || "could not reach the front desk" });
          });
        break;
      }
      case "START_CALL": {
        const s = mock
          ? createMockSession({ audioContext: getAudioContext() })
          : createRetellSession();
        session.current?.dispose?.();
        session.current = s;

        s.on("connected", () => dispatch({ type: "CALL_CONNECTED" }));
        // The analyser arrives on its own event because the Retell SDK does
        // not have one yet at the moment it announces the call is ready.
        s.on("analyser", (node) => audio.attach(node, getAudioContext().sampleRate));
        s.on("ready", () => {
          dispatch({ type: "CALL_READY" });
          // Autoplay policy: this can reject on a kiosk nobody has touched.
          // It must NOT end the call - the visitor taps once and hears her.
          s.startAudioPlayback?.().catch(() => dispatch({ type: "AUDIO_BLOCKED" }));
        });
        s.on("agentStart", () => { signals.agentTalking = true; dispatch({ type: "AGENT_SPEAK_START" }); });
        s.on("agentEnd", () => { signals.agentTalking = false; dispatch({ type: "AGENT_SPEAK_END" }); });
        s.on("transcript", (t) => dispatch({ type: "TRANSCRIPT", ...t }));
        s.on("ended", () => dispatch({ type: "CALL_ENDED" }));
        s.on("error", (m) => dispatch({ type: "SDK_ERROR", message: m }));

        s.start(fx.token).catch((e) =>
          dispatch({ type: "SDK_ERROR", message: e?.message || "could not start the call" }));
        break;
      }
      case "STOP_CALL": {
        signals.agentTalking = false;
        audio.detach();
        const s = session.current;
        session.current = null;
        try { s?.stop(); } catch {}
        try { s?.dispose?.(); } catch {}
        break;
      }
      case "CONFIGURE_ANALYSER": {
        // Best-effort: on a real call the analyser usually does not exist yet
        // at this point, and the session's own "analyser" event is what
        // actually wires it up. Harmless when it is already attached.
        const node = session.current?.getAnalyser?.();
        if (node) audio.attach(node, getAudioContext().sampleRate);
        break;
      }
      case "UNLOCK_AUDIO": {
        const ac = getAudioContext();
        ac.resume().then(
          () => dispatch({ type: "AUDIO_UNLOCKED" }),
          () => dispatch({ type: "UNLOCK_FAILED" }),
        );
        session.current?.startAudioPlayback?.().catch(() => {});
        break;
      }
      default:
        break;
    }
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ac = getAudioContext();
    ac.resume().then(
      () => dispatch({ type: "AUDIO_UNLOCKED" }),
      () => dispatch({ type: "UNLOCK_FAILED" }),
    );

    const online = () => dispatch({ type: "ONLINE" });
    const offline = () => dispatch({ type: "OFFLINE" });
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);

    // Watchdog: Windows changes the default audio device, the machine sleeps,
    // and ctx.state silently goes suspended at 2am. Without this the kiosk is
    // mute until someone notices, which in a lobby could be days.
    const watchdog = setInterval(async () => {
      if (ac.state === "suspended") {
        try { await ac.resume(); } catch {}
        if (ac.state === "suspended") dispatch({ type: "AUDIO_BLOCKED" });
      }
    }, 5000);

    return () => {
      disposed.current = true;
      clearInterval(watchdog);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      timers.current.forEach(clearTimeout);
      timers.current.clear();
      abort.current?.abort();
      try { session.current?.stop(); session.current?.dispose?.(); } catch {}
      session.current = null;
      stopWake();
      audio.detach();
      try { ac.close(); } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const api = useMemo(() => ({
    ctx,
    dispatch,
    touch: () => dispatch({ type: "TOUCH" }),
    assetsReady: () => dispatch({ type: "ASSETS_READY" }),
    micOwner: () => mic.current?.owner ?? null,
  }), [ctx, dispatch]);

  return api;
}
