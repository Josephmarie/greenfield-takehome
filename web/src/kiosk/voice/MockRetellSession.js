import { createVoice, PHRASES } from "../dev/speechSynth.js";

// A stand-in for RetellSession with the identical interface, driving the whole
// kiosk from synthesised speech.
//
// This is the most useful tool in the build. It means the state machine, the
// captions, the lipsync, the animators and the framing can all be developed,
// demoed and regression-tested on any laptop with no microphone, no backend,
// no network and no Retell minutes - and it can reproduce on demand the two
// things that are otherwise painful to observe: a 40-second cold start and a
// mid-call failure.

const EVENTS = ["connected", "ready", "ended", "error", "agentStart", "agentEnd", "transcript"];

function emitter() {
  const map = new Map(EVENTS.map((e) => [e, new Set()]));
  return {
    on(ev, fn) { map.get(ev)?.add(fn); return () => map.get(ev)?.delete(fn); },
    off(ev, fn) { map.get(ev)?.delete(fn); },
    emit(ev, ...a) { map.get(ev)?.forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } }); },
    clear() { map.forEach((s) => s.clear()); },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function createMockSession({ audioContext, coldStartMs = 0, failAfterMs = 0, volume = 0.9 } = {}) {
  const bus = emitter();
  let ctx = audioContext || null;
  let voice = null;
  let talking = false;
  let cancelled = false;
  let timers = [];

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clear = () => { timers.forEach(clearTimeout); timers = []; };

  async function say(line) {
    if (cancelled || !voice) return;
    talking = true;
    bus.emit("agentStart");
    bus.emit("transcript", { agent: line.text });
    await voice.speak(line.ph);
    talking = false;
    bus.emit("agentEnd");
  }

  async function conversation() {
    // A greeting, a pause where a visitor would speak, then an answer. The
    // pause is what exercises listening -> thinking -> speaking.
    for (const line of PHRASES.greeting) { if (cancelled) return; await say(line); await wait(180); }
    if (cancelled) return;

    await wait(2200);
    bus.emit("transcript", { user: "I'd like to book an appointment." });
    await wait(900);

    for (const line of PHRASES.scheduling) { if (cancelled) return; await say(line); await wait(180); }
    if (cancelled) return;

    await wait(1800);
    bus.emit("transcript", { user: "Yes, that works. Do you take Blue Cross?" });
    await wait(1100);
    for (const line of PHRASES.insurance) { if (cancelled) return; await say(line); }

    await wait(1200);
    if (!cancelled) bus.emit("ended");
  }

  return {
    kind: "mock",
    on: bus.on,
    off: bus.off,

    get isAgentTalking() { return talking; },
    getAnalyser() { return voice?.analyser ?? null; },

    async start() {
      cancelled = false;
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") { try { await ctx.resume(); } catch {} }

      voice = createVoice(ctx);
      voice.output.connect(ctx.destination);
      voice.setVolume(volume);

      // Reproduce a Render cold start on demand.
      if (coldStartMs) await wait(coldStartMs);
      if (cancelled) return;

      bus.emit("connected");
      await wait(220);
      if (cancelled) return;
      bus.emit("ready");

      if (failAfterMs) later(() => bus.emit("error", "simulated mid-call failure"), failAfterMs);
      conversation();
    },

    async startAudioPlayback() {
      if (ctx?.state === "suspended") await ctx.resume();
    },

    stop() {
      cancelled = true;
      clear();
      voice?.stop();
      if (talking) { talking = false; bus.emit("agentEnd"); }
      bus.emit("ended");
    },

    dispose() {
      cancelled = true;
      clear();
      voice?.dispose();
      voice = null;
      bus.clear();
    },
  };
}
