import { createMouthPose } from "./dsp.js";

// The single mutable object every 60 Hz consumer reads and writes.
//
// This exists so the render loop never touches React state. It is created once
// and mutated in place: no new objects per frame, no hook dependencies, no
// re-render when the jaw moves. React only re-renders on discrete transitions
// and caption changes, a handful of times per conversation.
export function createSignals() {
  return {
    // clock
    t: 0,
    dt: 1 / 60,
    frame: 0,

    // conversation state, mirrored from the machine for the animators
    state: "boot",
    stateEnteredAt: 0,
    prevState: null,
    agentTalking: false,
    userTalking: false,
    warming: false,

    // audio-derived
    amp: 0,        // fast envelope, drives jaw magnitude
    ampSlow: 0,    // ~250 ms envelope, drives head dips on stressed syllables
    micLevel: 0,   // wake listener RMS; drives the attract ring
    closure: 0,    // bilabial closure pulse
    talkGate: 0,   // 1 while the agent is speaking, with a short release tail

    // mouth pose, in ARKit channel names
    mouth: createMouthPose(),

    // where the avatar is looking, in normalised units
    attention: { x: 0, y: 0 },

    // adaptive performance scalar, 1 = full quality
    quality: 1,
  };
}

/** Mirror the machine's context onto the signal bus for the animators. */
export function syncState(signals, ctx, now) {
  if (signals.state !== ctx.state) {
    signals.prevState = signals.state;
    signals.state = ctx.state;
    signals.stateEnteredAt = now;
  }
  signals.warming = !!ctx.warming;
}
