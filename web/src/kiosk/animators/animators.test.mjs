// Each animator is a pure function of (dt, signals) into the target buffer, so
// a "does the face look alive" question becomes a numeric one that runs in
// node in milliseconds: simulate N seconds, read the buffer, assert.
import assert from "node:assert/strict";
import { createAnimators, createBreath, createHead, createGaze, createBlink, createEmotion } from "./animators.js";
import { createTargetBuffer, FACE_CHANNELS } from "./TargetBuffer.js";
import { createSignals } from "../signals/Signals.js";
import { JAW_MAX } from "../signals/dsp.js";
import { S } from "../state/kioskMachine.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const DT = 1 / 60;

function simulate(anim, { seconds = 10, state = S.IDLE, mutate } = {}) {
  const s = createSignals();
  const buf = createTargetBuffer();
  s.state = state;
  const frames = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    s.t += DT;
    s.frame = i;
    if (mutate) mutate(s, i);
    // A single animator does not own the buffer lifecycle - only the composed
    // pipeline does - so clear and clamp around it here. Harmless when the
    // pipeline is what is under test, since begin/finish are idempotent.
    buf.begin();
    anim.update(DT, s, buf);
    buf.finish();
    frames.push({ t: s.t, values: Float32Array.from(buf.values) });
  }
  return { s, buf, frames, index: buf.index };
}

const track = (r, name) => { const i = r.index.get(name); return r.frames.map((f) => f.values[i]); };

// ── every channel stays in range, in every state ────────────────────────────
{
  const anim = createAnimators();
  for (const state of Object.values(S)) {
    anim.reset();
    const r = simulate(anim, {
      seconds: 6,
      state,
      mutate: (s, i) => {
        s.agentTalking = state === S.SPEAKING;
        s.userTalking = state === S.LISTENING && i % 240 < 120;
        s.amp = state === S.SPEAKING ? 0.5 + 0.5 * Math.sin(i * 0.3) : 0;
        s.ampSlow = s.amp * 0.8;
        s.mouth.jawOpen = s.amp * JAW_MAX;
        s.mouth.mouthStretch_L = s.amp * 0.4;
      },
    });
    for (let ci = 0; ci < FACE_CHANNELS.length; ci++) {
      const name = FACE_CHANNELS[ci];
      const vals = track(r, name);
      const bad = vals.find((v) => !(v >= 0 && v <= 1));
      ok(bad === undefined, `${state}: ${name} left [0,1] (${bad})`);
    }
    ok(Math.max(...track(r, "jawOpen")) <= JAW_MAX + 1e-6, `${state}: jaw exceeded the cap`);
  }
}

// ── blink: rate, shape, and full closure ────────────────────────────────────
{
  const gaze = createGaze();
  const blink = createBlink(gaze);
  const r = simulate(blink, { seconds: 30, state: S.IDLE });
  const v = track(r, "eyeBlink_L");

  let count = 0;
  for (let i = 1; i < v.length; i++) if (v[i - 1] === 0 && v[i] > 0) count++;
  ok(count >= 4 && count <= 26, `blink rate over 30s out of range: ${count}`);
  ok(Math.max(...v) > 0.98, "a blink must fully close the eye");
  ok(v.filter((x) => x > 0).length / v.length < 0.25, "eyes must be open most of the time");

  // Both eyes blink together.
  const rr = track(r, "eyeBlink_R");
  ok(v.every((x, i) => Math.abs(x - rr[i]) < 1e-9), "both eyes must blink in sync");

  // A blink is fast: no single closure lasts longer than ~350ms.
  let run = 0, longest = 0;
  for (const x of v) { if (x > 0.02) { run++; longest = Math.max(longest, run); } else run = 0; }
  ok(longest * DT < 0.35, `a blink lasted ${(longest * DT).toFixed(2)}s - too slow`);
}

// ── gaze: bounded, and ballistic rather than gliding ────────────────────────
{
  const gaze = createGaze();
  const r = simulate(gaze, { seconds: 20, state: S.IDLE });
  ok(r.s.attention.x >= -1 && r.s.attention.x <= 1, "gaze x stays in range");

  // Ballistic, stated properly: the eye's fastest steps must be dramatically
  // faster than its typical ones. An eye that is merely smoothed has a flat
  // step distribution, and that evenness is exactly what looks fake. Comparing
  // the peak to the median says "it snaps" without depending on how far any
  // particular random saccade happened to travel.
  const xs = r.frames.map((f) => f.values[r.index.get("eyeLookOut_L")] - f.values[r.index.get("eyeLookIn_L")]);
  const steps = [];
  for (let i = 1; i < xs.length; i++) steps.push(Math.abs(xs[i] - xs[i - 1]));
  const sorted = [...steps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const peak = sorted[sorted.length - 1];
  ok(peak > 0.1, `saccades must actually move the eye (peak step ${peak.toFixed(3)})`);
  ok(peak > median * 20, `gaze glides instead of snapping (peak ${peak.toFixed(4)} vs median ${median.toFixed(4)})`);

  // Listening locks onto the visitor: the gaze should stay near centre.
  const lg = createGaze();
  const lr = simulate(lg, { seconds: 20, state: S.LISTENING });
  const mean = Math.abs(lr.frames.reduce((a, f) => a + f.values[lr.index.get("eyeLookOut_L")], 0) / lr.frames.length);
  ok(mean < 0.25, `listening gaze should hold the visitor, mean offset ${mean.toFixed(3)}`);

  // Thinking looks away and up.
  const tg = createGaze();
  const tr = simulate(tg, { seconds: 20, state: S.THINKING });
  const up = tr.frames.reduce((a, f) => a + f.values[tr.index.get("eyeLookUp_L")], 0) / tr.frames.length;
  ok(up > 0.15, `thinking should break gaze upward, got ${up.toFixed(3)}`);
}

// ── breath: always moving, never large ──────────────────────────────────────
{
  const r = simulate(createBreath(), { seconds: 20, state: S.IDLE });
  const p = track(r, "spine.pitch");
  const span = Math.max(...p) - Math.min(...p);
  ok(span > 0.008, "breath must actually move the chest");
  ok(span < 0.04, "breath must stay subtle");

  let zc = 0;
  for (let i = 1; i < p.length; i++) if (Math.sign(p[i]) !== Math.sign(p[i - 1])) zc++;
  const bpm = (zc / 2 / 20) * 60;
  ok(bpm > 8 && bpm < 26, `breath rate ${bpm.toFixed(1)}/min is not human`);
}

// ── head: idle motion never loops visibly, and dips on stressed syllables ───
{
  const r = simulate(createHead(), { seconds: 180, state: S.IDLE });
  const yaw = track(r, "head.yaw");
  ok(Math.max(...yaw.map(Math.abs)) < 0.09, "idle head sway must stay small");

  const mean = yaw.reduce((a, b) => a + b, 0) / yaw.length;
  const dev = yaw.map((v) => v - mean);
  const denom = dev.reduce((a, v) => a + v * v, 0);
  const autocorr = (lagS) => {
    const lag = Math.round(lagS / DT);
    let num = 0;
    for (let i = 0; i + lag < dev.length; i++) num += dev[i] * dev[i + lag];
    return num / denom;
  };

  // Smoothness and periodicity are different things and an earlier version of
  // this test confused them: ANY smooth signal correlates strongly with itself
  // at short lags, so a high value there is desirable, not a bug. Real looping
  // would show up as recurrence at lags LONGER than the slowest octave (11.3s),
  // which is what is actually asserted.
  ok(autocorr(0.25) > 0.5, "idle motion should be smooth frame to frame");
  let worst = 0;
  for (let lagS = 15; lagS <= 60; lagS += 0.5) worst = Math.max(worst, Math.abs(autocorr(lagS)));
  ok(worst < 0.55, `idle head motion repeats itself (autocorrelation ${worst.toFixed(2)} at a long lag)`);

  const speak = simulate(createHead(), {
    seconds: 6, state: S.SPEAKING,
    mutate: (s, i) => { s.ampSlow = i % 60 < 30 ? 0.9 : 0.0; },
  });
  const pitch = track(speak, "head.pitch");
  const loud = pitch.filter((_, i) => i % 60 < 30).reduce((a, b) => a + b, 0) / (pitch.length / 2);
  const quiet = pitch.filter((_, i) => i % 60 >= 30).reduce((a, b) => a + b, 0) / (pitch.length / 2);
  ok(loud < quiet, "the head must dip on stressed syllables");
}

// ── emotion: eased, never switched ──────────────────────────────────────────
{
  const em = createEmotion();
  em.reset();
  const r = simulate(em, {
    seconds: 4, state: S.IDLE,
    mutate: (s, i) => { s.state = i < 120 ? S.IDLE : S.THINKING; },
  });
  const brow = track(r, "browInnerUp");
  let maxStep = 0;
  for (let i = 1; i < brow.length; i++) maxStep = Math.max(maxStep, Math.abs(brow[i] - brow[i - 1]));
  ok(maxStep < 0.03, `emotion must ease, not cut (max step ${maxStep.toFixed(4)})`);
  ok(brow[brow.length - 1] > 0.3, "thinking must actually raise the inner brow");
}

// ── the viseme layer owns the mouth ─────────────────────────────────────────
{
  const anim = createAnimators();
  const r = simulate(anim, {
    seconds: 2, state: S.SPEAKING,
    mutate: (s) => { s.agentTalking = true; s.amp = 1; s.ampSlow = 1; s.mouth.mouthSmile_L = 0; s.mouth.jawOpen = 0.3; },
  });
  const last = r.frames[r.frames.length - 1];
  ok(Math.abs(last.values[r.index.get("jawOpen")] - 0.3) < 1e-6,
    "the viseme layer must win the mouth outright, unaffected by other layers");
}

// ── determinism of the noise field ──────────────────────────────────────────
{
  const a = simulate(createHead(), { seconds: 3, state: S.IDLE });
  const b = simulate(createHead(), { seconds: 3, state: S.IDLE });
  const ya = track(a, "head.yaw"), yb = track(b, "head.yaw");
  ok(ya.every((v, i) => Math.abs(v - yb[i]) < 1e-9), "head noise must be deterministic for reproducible tests");
}

console.log(`animators: ${checks} assertions passed`);
