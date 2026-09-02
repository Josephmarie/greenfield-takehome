// Golden tests for the mouth pipeline. Pure node, no browser, no audio device.
// Fixtures are synthesised from published vowel formant frequencies, so these
// exercise the real banding and centroid code rather than asserting against
// numbers reverse-engineered from the implementation.
import assert from "node:assert/strict";
import * as dsp from "./dsp.js";
import { synthSpectrum } from "./formantFixtures.js";

const SR = 48000, FFT = 1024, binHz = SR / FFT;
const spec = new Uint8Array(FFT / 2);
const bands = new Float32Array(6);
const c = {};

const read = (p) => {
  synthSpectrum(spec, p, { sampleRate: SR, fftSize: FFT });
  dsp.bandEnergies(spec, SR, FFT, bands);
  return dsp.controls(spec, bands, binHz, c);
};

// Expected regions of the (open x front) vowel space, plus voicing.
const EXPECT = {
  aa: { open: [0.75, 1.00], front: [0.00, 0.35], voice: [0.6, 1.0] },
  E:  { open: [0.30, 0.75], front: [0.55, 1.00], voice: [0.6, 1.0] },
  I:  { open: [0.00, 0.35], front: [0.80, 1.00], voice: [0.6, 1.0] },
  O:  { open: [0.45, 0.90], front: [0.00, 0.40], voice: [0.6, 1.0] },
  U:  { open: [0.00, 0.50], front: [0.00, 0.40], voice: [0.6, 1.0] },
  S:  { sib:  [0.70, 1.00], voice: [0.0, 0.30] },
  F:  { sib:  [0.55, 1.00], voice: [0.0, 0.40] },
};

let pass = 0;
for (const [p, exp] of Object.entries(EXPECT)) {
  const got = read(p);
  for (const [k, [lo, hi]] of Object.entries(exp)) {
    assert.ok(got[k] >= lo && got[k] <= hi,
      `${p}.${k} = ${got[k].toFixed(3)} outside [${lo}, ${hi}]`);
    pass++;
  }
}

// The vowel space must actually separate the extremes it claims to.
assert.ok(read("aa").open - read("I").open > 0.6, "aa and I must differ in openness");
assert.ok(read("I").front - read("U").front > 0.5, "I and U must differ in frontness");
assert.ok(read("aa").open - read("O").open > 0.1, "aa must read more open than O");
pass += 3;

// mouthPose invariants — these are the ones that keep the face out of the
// uncanny valley, so they are asserted rather than eyeballed.
const pose = dsp.createMouthPose();
const closure = dsp.createClosureDetector();
for (const p of Object.keys(EXPECT)) {
  const ctl = read(p);
  for (const amp of [0, 0.25, 0.5, 0.75, 1]) {
    dsp.mouthPose(ctl, amp, 0, pose);
    for (const ch of dsp.MOUTH_CHANNELS) {
      assert.ok(pose[ch] >= 0 && pose[ch] <= 1, `${p}@${amp} ${ch}=${pose[ch]} out of [0,1]`);
    }
    assert.ok(pose.jawOpen <= dsp.JAW_MAX + 1e-9, `jaw exceeded cap: ${pose.jawOpen}`);
    pass += 2;
  }
}

// Silence must close the mouth; closure must seal it.
dsp.mouthPose(read("aa"), 0, 0, pose);
assert.ok(pose.jawOpen < 1e-6, "silence must close the jaw");
dsp.mouthPose(read("aa"), 1, 1, pose);
assert.ok(pose.mouthClose > 0.5 && pose.jawOpen < 0.12, "closure must seal the lips");
pass += 2;

// Envelopes must be frame-rate independent: the same elapsed time must give
// the same value whether it arrived in 1 step or 20.
let a = 0, b = 0;
for (let i = 0; i < 20; i++) a = dsp.envelope(a, 1, 0.005, 0.04, 0.14);
b = dsp.envelope(b, 1, 0.1, 0.04, 0.14);
assert.ok(Math.abs(a - b) < 0.02, `envelope not dt-independent: ${a} vs ${b}`);
pass++;

// Slew must bound the rate of change.
assert.equal(dsp.slew(0, 1, 1 / 60, 6), 6 / 60);
pass++;

// The closure detector must fire on a voiced-then-silent transition.
closure.reset();
let fired = 0;
for (let i = 0; i < 10; i++) fired = Math.max(fired, closure.update(0.30, true, 1 / 60));
for (let i = 0; i < 3; i++)  fired = Math.max(fired, closure.update(0.02, false, 1 / 60));
assert.ok(fired > 0.5, `closure detector did not fire (${fired})`);
pass++;

console.log(`dsp: ${pass} assertions passed`);
