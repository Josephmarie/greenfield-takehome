import {
  bandEnergies, controls, mouthPose, rmsFromBytes, envelope, onePole, slew,
  createClosureDetector, createLoudness, clamp, JAW_MAX,
} from "./dsp.js";

// Turns an AnalyserNode into the avatar's mouth, once per rendered frame.
//
// Two things here are load-bearing and easy to get wrong.
//
// 1. The analyser MUST be reconfigured. LiveKit's createAudioAnalyser defaults
//    to maxDecibels = -80 (livekit-client.esm.mjs, createAudioAnalyser opts),
//    which makes getByteFrequencyData saturate to 255 across the entire
//    spectrum for any normal speech. Straight out of the box it is a flat wall
//    and carries no formant information at all.
//
// 2. Shape and amplitude get SEPARATE envelopes. Amplitude is fast (40/140 ms)
//    so the mouth tracks loudness responsively; the vowel shape is slow
//    (~100 ms) because human speech only changes phoneme 4-8 times a second.
//    Driving shape at the amplitude rate is precisely what produces the
//    flapping-puppet look.

export const ANALYSER_SETTINGS = {
  fftSize: 1024,
  smoothingTimeConstant: 0.2,
  minDecibels: -85,
  maxDecibels: -25,
};

const TAU = {
  ampAttack: 0.04,
  ampRelease: 0.14,
  ampSlow: 0.25,
  shape: 0.10,
  gate: 0.12,
};

const JAW_SLEW_PER_SEC = 6.0;   // a jaw cannot slam
const DEADZONE_ON = 0.09;       // hysteresis, so the mouth does not chatter
const DEADZONE_OFF = 0.06;
const MID_PHRASE_FLOOR = 0.12;  // never fully close between syllables
const MID_PHRASE_MS = 180;

export function createAudioFeatures() {
  let analyser = null;
  let sampleRate = 48000;
  let spec = new Uint8Array(0);
  let time = new Uint8Array(0);

  const bands = new Float32Array(6);
  const ctl = { open: 0, front: 0, round: 1, sib: 0, voice: 0, f1: 0, f2: 0 };
  const smooth = { open: 0, front: 0, round: 1, sib: 0, voice: 0 };
  const target = { ...ctl };

  const loudness = createLoudness();
  const closureDet = createClosureDetector();

  let amp = 0, ampSlow = 0, gate = 0, jaw = 0, open = false;
  let lastLoudAt = -1e9;

  return {
    /**
     * Attach a live analyser and force it into a configuration that can
     * actually resolve formants. Call on call_ready, not on call_started.
     */
    attach(node, rate) {
      analyser = node;
      if (!analyser) return;
      Object.assign(analyser, ANALYSER_SETTINGS);
      sampleRate = rate || analyser.context?.sampleRate || 48000;
      spec = new Uint8Array(analyser.frequencyBinCount);
      time = new Uint8Array(analyser.fftSize);
      this.reset();
    },

    detach() {
      analyser = null;
      this.reset();
    },

    reset() {
      bands.fill(0);
      for (const k of Object.keys(smooth)) smooth[k] = k === "round" ? 1 : 0;
      loudness.reset();
      closureDet.reset();
      amp = ampSlow = gate = jaw = 0;
      open = false;
      lastLoudAt = -1e9;
    },

    get attached() { return !!analyser; },

    /**
     * Advance one frame and write the result into the shared signal bus.
     * Allocation-free: every buffer above is reused.
     */
    update(signals, dt, nowMs) {
      const talking = signals.agentTalking;
      gate = onePole(gate, talking ? 1 : 0, dt, TAU.gate);

      if (!analyser) {
        // No live audio (idle, or the mock harness drives amp directly).
        amp = envelope(amp, 0, dt, TAU.ampAttack, TAU.ampRelease);
        ampSlow = onePole(ampSlow, amp, dt, TAU.ampSlow);
        signals.amp = amp;
        signals.ampSlow = ampSlow;
        signals.talkGate = gate;
        signals.closure = 0;
        mouthPose(smooth, 0, 0, signals.mouth);
        return;
      }

      analyser.getByteFrequencyData(spec);
      analyser.getByteTimeDomainData(time);

      const rms = rmsFromBytes(time);
      let a = loudness.update(rms);

      // Hysteresis around the deadzone: one threshold to open, a lower one to
      // close, so the mouth does not judder at the boundary.
      if (open) { if (a < DEADZONE_OFF) open = false; }
      else if (a > DEADZONE_ON) open = true;
      if (!open) a = 0;
      if (a > DEADZONE_ON) lastLoudAt = nowMs;

      // Between syllables inside a phrase, hold the mouth slightly parted.
      // Snapping shut on every consonant stop reads as a nutcracker.
      if (talking && nowMs - lastLoudAt < MID_PHRASE_MS) a = Math.max(a, MID_PHRASE_FLOOR);

      bandEnergies(spec, sampleRate, ANALYSER_SETTINGS.fftSize, bands);
      controls(spec, bands, sampleRate / ANALYSER_SETTINGS.fftSize, target);

      // Shape on the slow envelope, amplitude on the fast one.
      smooth.open  = onePole(smooth.open,  target.open,  dt, TAU.shape);
      smooth.front = onePole(smooth.front, target.front, dt, TAU.shape);
      smooth.sib   = onePole(smooth.sib,   target.sib,   dt, TAU.shape * 0.6);
      smooth.voice = onePole(smooth.voice, target.voice, dt, TAU.shape);
      smooth.round = 1 - smooth.front;

      amp = envelope(amp, a * gate, dt, TAU.ampAttack, TAU.ampRelease);
      ampSlow = onePole(ampSlow, amp, dt, TAU.ampSlow);

      const closure = closureDet.update(rms, target.voice > 0.5, dt) * gate;

      mouthPose(smooth, amp, closure, signals.mouth);
      // Rate-limit the jaw specifically, after posing, so the cap and the
      // slew limit are both guaranteed regardless of what the pose asked for.
      jaw = slew(jaw, signals.mouth.jawOpen, dt, JAW_SLEW_PER_SEC);
      signals.mouth.jawOpen = clamp(jaw, 0, JAW_MAX);

      signals.amp = amp;
      signals.ampSlow = ampSlow;
      signals.closure = closure;
      signals.talkGate = gate;
    },

    /** Used by the mock harness and the offline lipsync bench. */
    debug() {
      return { ...smooth, f1: target.f1, f2: target.f2, amp, ceiling: loudness.ceiling };
    },
  };
}
