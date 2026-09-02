import { ANALYSER_SETTINGS } from "../signals/AudioFeatures.js";

// A thin, defensive wrapper around retell-client-js-sdk.
//
// The SDK is fine for a demo page but has three behaviours that matter a lot
// for a kiosk that starts and ends hundreds of calls a day. All three are
// verified against the installed build (node_modules/retell-client-js-sdk/
// dist/index.m.js) and handled here:
//
//  1. stopCall() is guarded by `this.connected &&`. If startCall throws during
//     room.connect() - which is exactly what a cold backend or a network blip
//     produces - the SDK's own catch calls stopCall(), which then does NOTHING.
//     The LiveKit Room, its PeerConnection, the AudioContext inside
//     analyzerComponent and the rAF all survive. Repeat that a few dozen times
//     and audio hard-fails. forceTeardown() below flips `connected` back to
//     true first so the real teardown actually runs.
//
//  2. captureAudioSamples() allocates `new Float32Array(fftSize)` EVERY frame
//     to emit an `audio` event, ~8 KB a frame. We read the analyser directly,
//     so we cancel that loop.
//
//  3. The analyser it builds is unusable as configured: LiveKit's
//     createAudioAnalyser defaults to maxDecibels = -80, which saturates
//     getByteFrequencyData to 255 across the whole spectrum for normal speech.
//     It has to be reconfigured before it carries any formant information.

const EVENTS = ["connected", "ready", "ended", "error", "agentStart", "agentEnd", "transcript"];

function emitter() {
  const map = new Map(EVENTS.map((e) => [e, new Set()]));
  return {
    on(ev, fn) { map.get(ev)?.add(fn); return () => map.get(ev)?.delete(fn); },
    off(ev, fn) { map.get(ev)?.delete(fn); },
    emit(ev, ...args) { map.get(ev)?.forEach((fn) => { try { fn(...args); } catch (e) { console.error(e); } }); },
    clear() { map.forEach((s) => s.clear()); },
  };
}

export function createRetellSession() {
  const bus = emitter();
  let client = null;
  let ended = false;

  /**
   * Tear the SDK down even when it believes there is nothing to tear down.
   * See note 1 above - this is the whole reason this wrapper exists.
   */
  function forceTeardown() {
    const c = client;
    client = null;
    if (!c) return;
    try {
      if (c.connected === false) c.connected = true;
      c.stopCall();
    } catch (e) {
      console.warn("[kiosk] forced teardown threw (continuing):", e);
    }
    try {
      if (c.captureAudioFrame != null) {
        cancelAnimationFrame(c.captureAudioFrame);
        c.captureAudioFrame = undefined;
      }
    } catch {}
    try { c.analyzerComponent?.cleanup?.(); } catch {}
    try { c.removeAllListeners?.(); } catch {}
  }

  return {
    kind: "retell",
    on: bus.on,
    off: bus.off,

    get isAgentTalking() { return !!client?.isAgentTalking; },
    getAnalyser() { return client?.analyzerComponent?.analyser ?? null; },

    async start(accessToken, { captureDeviceId, playbackDeviceId } = {}) {
      forceTeardown();
      ended = false;

      const mod = await import("retell-client-js-sdk");
      const c = new mod.RetellWebClient();
      client = c;

      // call_started fires when the LiveKit room connects, which can be a
      // second or more before the agent's audio track exists. Going "live" on
      // it puts the avatar in a conversation with silence, so the kiosk waits
      // for call_ready instead and only reports "connected" here.
      c.on("call_started", () => bus.emit("connected"));

      c.on("call_ready", () => {
        // The analyser only exists at all because emitRawAudioSamples is set,
        // and it is useless until reconfigured. Both happen here.
        const a = c.analyzerComponent?.analyser;
        if (a) Object.assign(a, ANALYSER_SETTINGS);
        try {
          if (c.captureAudioFrame != null) {
            cancelAnimationFrame(c.captureAudioFrame);
            c.captureAudioFrame = undefined;
          }
        } catch {}
        bus.emit("ready");
      });

      c.on("agent_start_talking", () => bus.emit("agentStart"));
      c.on("agent_stop_talking", () => bus.emit("agentEnd"));

      c.on("update", (u) => {
        if (!u || !Array.isArray(u.transcript)) return;
        let agent = null, user = null;
        for (const t of u.transcript) {
          if (t.role === "agent") agent = t.content;
          else user = t.content;
        }
        bus.emit("transcript", { agent, user });
      });

      c.on("call_ended", () => { if (!ended) { ended = true; bus.emit("ended"); } });

      // The SDK emits a bare string here, not an Error.
      c.on("error", (e) => {
        const message = typeof e === "string" ? e : e?.message || "call error";
        bus.emit("error", message);
        forceTeardown();
      });

      await c.startCall({
        accessToken,
        // Required: without it the SDK never builds analyzerComponent, and
        // there is no other way to reach the agent's audio - the SDK attaches
        // the track to its own element and keeps `room` private.
        emitRawAudioSamples: true,
        ...(captureDeviceId ? { captureDeviceId } : {}),
        ...(playbackDeviceId ? { playbackDeviceId } : {}),
      });
    },

    /** Must be called from a user gesture on browsers enforcing autoplay policy. */
    async startAudioPlayback() {
      if (!client) throw new Error("no active call");
      await client.startAudioPlayback();
    },

    stop() {
      if (!ended) { ended = true; bus.emit("ended"); }
      forceTeardown();
    },

    dispose() { forceTeardown(); bus.clear(); },
  };
}
