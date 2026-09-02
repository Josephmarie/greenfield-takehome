// A tiny formant synthesiser, used to drive the avatar with no live call.
//
// The obvious way to build a lipsync harness is to play a recorded WAV. This is
// better for two reasons. First, it needs no asset, so the harness works on a
// fresh clone with no network. Second, and the real point: we know exactly
// which phoneme is sounding at every instant, so the harness can ASSERT that
// the mouth arrived at the right shape rather than leaving it to be eyeballed.
//
// It is a source-filter model: a glottal pulse train through three bandpass
// resonators at F1/F2/F3 for voiced sounds, shaped noise for fricatives. It is
// not meant to sound like a person - it is meant to have a person's spectrum.

import { FORMANTS } from "../signals/formantFixtures.js";

// Bandwidths widen with frequency, as real formants do.
const bw = (f) => 80 + f * 0.08;

export const PHRASES = {
  greeting: [
    { text: "Welcome to Greenfield Cardiology.", ph: "w E l k aa m t U . g r I n f I l d . k aa r d I aa l aa j I ." },
    { text: "How can I help you today?", ph: "h aW k a n aI . h E l p . y U . t U d eI ." },
  ],
  scheduling: [
    { text: "I can book you with Doctor Chen on Friday at ten.", ph: "aI k a n . b U k y U . w I th . d aa k t E r . CH E n . aa n . f r aI d eI . a t . t E n ." },
    { text: "Does that work for you?", ph: "d ^ z . th a t . w E r k . f O r . y U ." },
  ],
  insurance: [
    { text: "Blue Cross is in network with us.", ph: "b l U . k r O s . I z . I n . n E t w E r k . w I th . ^ s ." },
  ],
};

// Map the shorthand above onto formant targets. Anything unrecognised becomes
// a short neutral vowel, so a typo degrades to a mumble rather than a crash.
const PHONE = {
  aa: { f: [730, 1090, 2440], v: true, d: 0.13 },
  a:  { f: [660, 1720, 2410], v: true, d: 0.10 },
  E:  { f: [530, 1840, 2480], v: true, d: 0.10 },
  I:  { f: [270, 2290, 3010], v: true, d: 0.09 },
  i:  { f: [390, 1990, 2550], v: true, d: 0.09 },
  O:  { f: [570,  840, 2410], v: true, d: 0.12 },
  U:  { f: [300,  870, 2240], v: true, d: 0.10 },
  "^": { f: [640, 1190, 2390], v: true, d: 0.09 },
  eI: { f: [480, 1900, 2500], v: true, d: 0.15 },
  aI: { f: [700, 1500, 2450], v: true, d: 0.15 },
  aW: { f: [700, 1100, 2400], v: true, d: 0.15 },
  // voiced consonants: brief, low, with a closure before the plosives
  b:  { f: [300,  900, 2200], v: true, d: 0.05, stop: true },
  d:  { f: [300, 1700, 2600], v: true, d: 0.05, stop: true },
  g:  { f: [300, 1800, 2400], v: true, d: 0.05, stop: true },
  m:  { f: [280,  900, 2200], v: true, d: 0.07, nasal: true, stop: true },
  n:  { f: [280, 1700, 2600], v: true, d: 0.06, nasal: true, stop: true },
  l:  { f: [360, 1100, 2600], v: true, d: 0.06 },
  r:  { f: [420, 1300, 1600], v: true, d: 0.06 },
  w:  { f: [300,  800, 2200], v: true, d: 0.05 },
  y:  { f: [300, 2200, 3000], v: true, d: 0.05 },
  z:  { f: [300, 1600, 2500], v: true, d: 0.07, noise: [3000, 7000], mix: 0.6 },
  v:  { f: [300, 1100, 2200], v: true, d: 0.06, noise: [2500, 6500], mix: 0.5 },
  j:  { f: [300, 1800, 2600], v: true, d: 0.07, noise: [2000, 6000], mix: 0.5 },
  // unvoiced
  s:  { v: false, d: 0.10, noise: [4000, 9000] },
  S:  { v: false, d: 0.10, noise: [2500, 6500] },
  CH: { v: false, d: 0.08, noise: [2200, 6500] },
  f:  { v: false, d: 0.08, noise: [2500, 7500] },
  th: { v: false, d: 0.07, noise: [3000, 8000] },
  h:  { v: false, d: 0.05, noise: [1000, 4000] },
  k:  { v: false, d: 0.05, noise: [1500, 5000], stop: true },
  t:  { v: false, d: 0.05, noise: [3000, 7000], stop: true },
  p:  { v: false, d: 0.05, noise: [1000, 4000], stop: true },
  ".": { v: false, d: 0.20, silence: true },
};

function noiseBuffer(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Build a speech-like voice on an AudioContext.
 * Returns { output, analyser, speak(phonemes), stop(), onBoundary }.
 */
export function createVoice(ctx, { f0 = 112 } = {}) {
  const out = ctx.createGain();
  out.gain.value = 0.0001;

  // Voiced source: a sawtooth is a decent stand-in for a glottal pulse train.
  const glottis = ctx.createOscillator();
  glottis.type = "sawtooth";
  glottis.frequency.value = f0;
  const voiceGain = ctx.createGain();
  voiceGain.gain.value = 0;
  glottis.connect(voiceGain);

  // A slow vibrato keeps the spectrum from being unnaturally static.
  const vib = ctx.createOscillator();
  vib.frequency.value = 4.7;
  const vibAmt = ctx.createGain();
  vibAmt.gain.value = 3.2;
  vib.connect(vibAmt).connect(glottis.frequency);

  // Three formant resonators in parallel.
  const formants = [0, 1, 2].map((i) => {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = [730, 1090, 2440][i];
    bp.Q.value = bp.frequency.value / bw(bp.frequency.value);
    const g = ctx.createGain();
    g.gain.value = [1.0, 0.6, 0.32][i];
    voiceGain.connect(bp).connect(g).connect(out);
    return { bp, g };
  });

  // Unvoiced source: shaped noise.
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer(ctx);
  noiseSrc.loop = true;
  const noiseBp = ctx.createBiquadFilter();
  noiseBp.type = "bandpass";
  noiseBp.frequency.value = 5000;
  noiseBp.Q.value = 0.7;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  noiseSrc.connect(noiseBp).connect(noiseGain).connect(out);

  const analyser = ctx.createAnalyser();
  out.connect(analyser);

  glottis.start();
  vib.start();
  noiseSrc.start();

  let timers = [];
  const clear = () => { timers.forEach(clearTimeout); timers = []; };

  return {
    output: out,
    analyser,
    setVolume(v) { out.gain.setTargetAtTime(Math.max(0.0001, v), ctx.currentTime, 0.02); },

    /** Schedule a phoneme string. Resolves when the utterance finishes. */
    speak(phonemeString, { onPhoneme } = {}) {
      const seq = phonemeString.trim().split(/\s+/);
      let t = ctx.currentTime + 0.02;
      const started = t;

      for (const sym of seq) {
        const p = PHONE[sym] || PHONE["^"];
        const dur = p.d;

        if (p.silence) {
          voiceGain.gain.setTargetAtTime(0, t, 0.02);
          noiseGain.gain.setTargetAtTime(0, t, 0.02);
        } else {
          // A stop consonant gets a real closure first. Without it the mouth
          // never seals, and the missing /p/ /b/ /m/ closures are conspicuous.
          if (p.stop) {
            voiceGain.gain.setTargetAtTime(0, t, 0.008);
            noiseGain.gain.setTargetAtTime(0, t, 0.008);
            t += 0.035;
          }
          if (p.v) {
            p.f.forEach((f, i) => {
              formants[i].bp.frequency.setTargetAtTime(f, t, 0.015);
              formants[i].bp.Q.setTargetAtTime(f / bw(f), t, 0.015);
            });
            voiceGain.gain.setTargetAtTime(p.nasal ? 0.16 : 0.30, t, 0.018);
            noiseGain.gain.setTargetAtTime(p.noise ? 0.05 * (p.mix ?? 0) : 0, t, 0.02);
          } else {
            voiceGain.gain.setTargetAtTime(0, t, 0.012);
            if (p.noise) {
              const mid = Math.sqrt(p.noise[0] * p.noise[1]);
              noiseBp.frequency.setTargetAtTime(mid, t, 0.012);
              noiseBp.Q.setTargetAtTime(0.9, t, 0.012);
              noiseGain.gain.setTargetAtTime(0.075, t, 0.012);
            }
          }
        }

        if (onPhoneme) {
          const at = (t - ctx.currentTime) * 1000;
          timers.push(setTimeout(() => onPhoneme(sym, p), Math.max(0, at)));
        }
        t += dur;
      }

      voiceGain.gain.setTargetAtTime(0, t, 0.03);
      noiseGain.gain.setTargetAtTime(0, t, 0.03);

      const ms = (t - started) * 1000 + 120;
      return new Promise((resolve) => timers.push(setTimeout(resolve, ms)));
    },

    stop() {
      clear();
      voiceGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      noiseGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    },

    dispose() {
      clear();
      try { glottis.stop(); vib.stop(); noiseSrc.stop(); } catch {}
      try { out.disconnect(); } catch {}
    },
  };
}
