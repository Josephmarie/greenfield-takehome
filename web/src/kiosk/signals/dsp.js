// Pure DSP for the avatar's mouth. No Web Audio, no React, no allocation in
// any hot path — every function either returns a number or fills an array the
// caller owns. That is what makes this file unit-testable in plain node, which
// matters because tuning lipsync by starting phone calls is unbearable.

// Band edges chosen around vowel formants, not round numbers.
//   b0  voicing / f0        b1  F1 of CLOSE vowels (i, u)
//   b2  F1 of OPEN vowels   b3  F2 back      b4  F2 front + F3
//   b5  sibilance
// Splitting F1 across b1/b2 is what lets a ratio distinguish "ee" from "ah";
// a single F1 band conflates mouth openness with how loud the talker is.
export const BAND_EDGES_HZ = [80, 250, 550, 1100, 2000, 3500, 8000];
export const BAND_COUNT = BAND_EDGES_HZ.length - 1;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Frame-rate-independent one-pole smoothing.
 *
 * Uses k = 1 - exp(-dt/tau) rather than a fixed lerp factor on purpose: with a
 * fixed factor the character visibly changes when frames drop, which is
 * exactly the moment you least want a second artefact on screen.
 */
export function onePole(cur, target, dt, tau) {
  if (tau <= 0) return target;
  return cur + (target - cur) * (1 - Math.exp(-dt / tau));
}

/** Asymmetric envelope: fast to rise, slow to fall — how a real jaw behaves. */
export function envelope(cur, target, dt, tauAttack, tauRelease) {
  return onePole(cur, target, dt, target > cur ? tauAttack : tauRelease);
}

/** Hard limit on rate of change. A jaw cannot slam; neither should this one. */
export function slew(cur, target, dt, maxPerSec) {
  const d = target - cur;
  const max = maxPerSec * dt;
  return d > max ? cur + max : d < -max ? cur - max : target;
}

/**
 * Mean magnitude per band from getByteFrequencyData output.
 * The 0.7 exponent is a perceptual loudness curve, so quiet consonants still
 * register instead of vanishing under the vowels.
 */
export function bandEnergies(spec, sampleRate, fftSize, out) {
  const binHz = sampleRate / fftSize;
  const nBins = spec.length;
  for (let b = 0; b < BAND_COUNT; b++) {
    const lo = Math.max(0, Math.floor(BAND_EDGES_HZ[b] / binHz));
    const hi = Math.min(nBins - 1, Math.ceil(BAND_EDGES_HZ[b + 1] / binHz));
    let sum = 0;
    let n = 0;
    for (let i = lo; i <= hi; i++) { sum += spec[i]; n++; }
    const mean = n ? sum / n / 255 : 0;
    out[b] = Math.pow(mean, 0.7);
  }
  return out;
}

/** RMS from getByteTimeDomainData output (128 = silence). */
export function rmsFromBytes(time) {
  let sum = 0;
  for (let i = 0; i < time.length; i++) {
    const v = (time[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / time.length);
}

/**
 * Magnitude-weighted spectral centroid over a frequency window, in Hz.
 * Squared weighting emphasises formant peaks over the noise between them.
 */
export function spectralCentroid(spec, binHz, loHz, hiHz) {
  const lo = Math.max(1, Math.floor(loHz / binHz));
  const hi = Math.min(spec.length - 1, Math.ceil(hiHz / binHz));
  let num = 0, den = 0;
  for (let i = lo; i <= hi; i++) {
    const m = spec[i] / 255;
    const w = m * m;
    num += w * i * binHz;
    den += w;
  }
  return den > 1e-9 ? num / den : 0;
}

const norm = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);

/**
 * Mouth control signals.
 *
 * `open` and `front` are estimated as the centroid of the F1 and F2 search
 * windows rather than as a ratio between two fixed bands. A two-band ratio was
 * tried first and fails on back vowels: F3 (~2400 Hz) lands in the "front"
 * band and drags /o/ and /u/ towards /i/. A centroid over a window that stops
 * below F3 does not have that problem, and it costs one pass over the bins.
 *
 * Both are shape signals only — deliberately free of absolute level, so the
 * mouth does not change shape merely because the talker got louder.
 */
export function controls(spec, bands, binHz, out) {
  const eps = 1e-6;
  const f1 = spectralCentroid(spec, binHz, 200, 1050);
  const f2 = spectralCentroid(spec, binHz, 820, 2650);

  out.f1 = f1;
  out.f2 = f2;
  out.open  = norm(f1, 320, 790);
  out.front = norm(f2, 1000, 2300);
  out.round = 1 - out.front;

  const low  = bands[0] + bands[1];
  const high = bands[4] + bands[5];
  const all  = bands[0] + bands[1] + bands[2] + bands[3] + bands[4] + bands[5] + eps;
  out.sib   = clamp((bands[5] * 1.35 + bands[4] * 0.35) / all * 2.6, 0, 1);
  out.voice = clamp(low / (low + high + eps) * 1.45, 0, 1);
  return out;
}

/**
 * Evidence for each viseme, sharpened so ONE shape dominates.
 *
 * The sharpening (w = e^2 / sum e^2) is not cosmetic. Averaging every vowel
 * together every frame produces a permanently half-open, mushy mouth, which is
 * the second-biggest cause of a dead-looking avatar after amplitude flutter.
 */
// Mouth channels we drive, all ARKit blendshape names. Kept as a flat list so
// the renderer can precompute a name -> morph index map once at load and never
// do a string lookup inside the frame loop.
export const MOUTH_CHANNELS = [
  "jawOpen", "mouthFunnel", "mouthPucker", "mouthClose",
  "mouthStretch_L", "mouthStretch_R", "mouthUpperUp_L", "mouthUpperUp_R",
  "mouthLowerDown_L", "mouthLowerDown_R", "mouthPress_L", "mouthPress_R",
  "mouthRollLower", "mouthShrugUpper",
];

export const JAW_MAX = 0.55;   // a fully open jaw is a scream, never speech

/**
 * Continuous mouth pose from the control signals.
 *
 * An earlier version classified each frame into one of nine discrete visemes
 * and blended the winner. Two problems killed it. First, a 512-bin FFT cannot
 * reliably separate /a/ from /o/ — their F1/F2 estimates overlap — so the
 * classifier flickered between them mid-vowel. Second, discrete classes pop:
 * switching class between frames moves several channels at once.
 *
 * A continuous (open x front) vowel space plus a rounding term has neither
 * problem. Nothing to flicker between, interpolation is inherent, and /o/
 * simply lands between /a/ and /u/ where it belongs.
 *
 * `amp` scales the whole pose. `closure` overrides it towards sealed lips.
 */
export function mouthPose(c, amp, closure, out) {
  const open = c.open, front = c.front, round = c.round, sib = c.sib, voice = c.voice;
  const vowel = clamp(1 - sib * 0.85, 0, 1);       // sibilants are not vowels
  const a = clamp(amp, 0, 1);

  // Jaw: amplitude leads, openness modulates. An earlier version multiplied
  // openness, vowel-ness and amplitude together, and because all three sit
  // below 1 most of the time the product never rose past a mumble - the face
  // "talked" with a jaw that moved about a tenth of its range. Amplitude has to
  // dominate; the vowel only decides how far past the baseline it goes.
  const jaw = a * (0.42 + 0.58 * open) * vowel;
  out.jawOpen = clamp(jaw, 0, 1) * JAW_MAX;

  // Rounding: /o/ and /u/. Funnel is the open-round shape, pucker the closed one.
  out.mouthFunnel = round * open * vowel * a * 0.72;
  out.mouthPucker = round * (1 - open) * vowel * a * 0.85;

  // Spreading: /i/ and /e/ pull the corners wide.
  const spread = front * vowel * a * (0.34 + 0.46 * (1 - open));
  out.mouthStretch_L = spread;
  out.mouthStretch_R = spread;

  // Sibilants: corners back, upper lip raised off the teeth, jaw almost shut.
  const s = sib * a;
  out.mouthUpperUp_L = s * 0.42 + spread * 0.22;
  out.mouthUpperUp_R = s * 0.42 + spread * 0.22;
  out.mouthStretch_L += s * 0.34;
  out.mouthStretch_R += s * 0.34;

  // Labiodentals /f/ /v/: lower lip tucks to the upper teeth.
  const fv = clamp(sib * (1 - voice) * 1.15, 0, 1) * a;
  out.mouthLowerDown_L = fv * 0.38;
  out.mouthLowerDown_R = fv * 0.38;
  out.mouthRollLower   = fv * 0.30;
  out.mouthShrugUpper  = out.mouthFunnel * 0.18;

  // Bilabial closure wins over everything: lips seal, jaw shuts.
  const k = clamp(closure, 0, 1);
  if (k > 0) {
    for (const ch of MOUTH_CHANNELS) if (ch !== "mouthClose") out[ch] *= 1 - k * 0.9;
    out.mouthClose   = k * 0.8;
    out.mouthPress_L = k * 0.45;
    out.mouthPress_R = k * 0.45;
  } else {
    out.mouthClose = 0;
    out.mouthPress_L = 0;
    out.mouthPress_R = 0;
  }

  return out;
}

export function createMouthPose() {
  const o = {};
  for (const ch of MOUTH_CHANNELS) o[ch] = 0;
  return o;
}

/**
 * Bilabial closure detector.
 *
 * A sudden RMS collapse immediately after voicing is a /p/ /b/ /m/. Spectral
 * mapping alone never produces a visible lip closure, and its absence is
 * conspicuous — you notice a face saying "appointment" without ever closing
 * its lips. Fifteen lines for a disproportionate amount of realism.
 */
export function createClosureDetector({ ringSize = 6, dropRatio = 0.28, decayTau = 0.075 } = {}) {
  const ring = new Float32Array(ringSize);
  let idx = 0, filled = 0, value = 0, wasVoiced = false;
  return {
    reset() { ring.fill(0); idx = 0; filled = 0; value = 0; wasVoiced = false; },
    update(rms, voiced, dt) {
      let peak = 0;
      for (let i = 0; i < filled; i++) if (ring[i] > peak) peak = ring[i];
      if (wasVoiced && peak > 0.03 && rms < peak * dropRatio) value = 0.85;
      ring[idx] = rms;
      idx = (idx + 1) % ringSize;
      if (filled < ringSize) filled++;
      wasVoiced = voiced;
      value = onePole(value, 0, dt, decayTau);
      return value;
    },
  };
}

/**
 * Adaptive loudness ceiling. TTS output level varies between utterances and
 * voices; normalising against a slowly-decaying observed peak means a quiet
 * line still drives the mouth to full range instead of barely moving it.
 */
export function createLoudness({ decay = 0.9993, minCeil = 0.015, floorFrac = 0.07 } = {}) {
  let ceil = minCeil;
  return {
    reset() { ceil = minCeil; },
    /**
     * Normalise RMS against a slowly-decaying observed peak.
     *
     * The floor is a FRACTION of the ceiling rather than an absolute value.
     * With an absolute floor, quiet audio - a soft TTS voice, a low output
     * gain - leaves floor and ceiling almost touching, the usable range
     * collapses, and the mouth barely moves however loud the speech sounds to
     * a listener. Scaling the floor with the ceiling makes the whole chain
     * independent of absolute level, which matters because we do not control
     * how loud the agent's audio arrives.
     */
    update(rms) {
      ceil = Math.max(ceil * decay, rms, minCeil);
      const floor = ceil * floorFrac;
      return clamp((rms - floor) / Math.max(1e-6, ceil - floor), 0, 1);
    },
    get ceiling() { return ceil; },
  };
}
