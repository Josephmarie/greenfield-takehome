import { clamp, onePole, lerp } from "../signals/dsp.js";
import { S } from "../state/kioskMachine.js";

// Six independent animators, each owning exactly one channel group.
//
// Every one has the same shape: { id, update(dt, signals, buf), reset() }.
// They keep their own private state, communicate only through the signal bus
// and the target buffer, and never touch React, WebGL or the model. That makes
// each one testable on its own by running it against a synthetic signal bus
// for a few simulated seconds and reading the buffer back.
//
// Pipeline order matters: breath -> head -> gaze -> blink -> emotion -> viseme.
// The viseme layer runs last and writes the mouth exclusively.

// Deterministic value noise, so the idle motion never visibly loops but is
// still reproducible frame-for-frame in a test.
function hash(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
function valueNoise(t) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
}
/** Three octaves at mutually prime periods, so the loop is not perceptible. */
function drift(t, p0, p1, p2) {
  return valueNoise(t / p0) * 0.6 + valueNoise(t / p1) * 0.3 + valueNoise(t / p2) * 0.1;
}

const DEG = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);

// ── breath ──────────────────────────────────────────────────────────────────
// Tiny, and its absence is instantly noticeable: a face that does not breathe
// reads as a photograph no matter how good the lipsync is.
export function createBreath() {
  let phase = 0;
  return {
    id: "breath",
    reset() { phase = 0; },
    update(dt, s, buf) {
      const hz = s.state === S.SPEAKING ? 0.30 : 0.22;   // ~13-18 breaths/min
      phase += dt * hz * Math.PI * 2;
      const w = Math.sin(phase);
      buf.add("spine.pitch", w * 0.5 * DEG);
      buf.add("chest.scale", w * 0.006);
      buf.add("head.pitch", w * 0.22 * DEG);
    },
  };
}

// ── head ────────────────────────────────────────────────────────────────────
export function createHead() {
  let nodT = 0, nodUntil = 0, nextNod = 3;
  return {
    id: "head",
    reset() { nodT = 0; nodUntil = 0; nextNod = 3; },
    update(dt, s, buf) {
      const t = s.t;
      const speaking = s.state === S.SPEAKING;
      const amp = speaking ? 1.45 : 1.0;

      buf.add("head.yaw",   drift(t, 4.1, 6.7, 11.3) * 2.2 * DEG * amp);
      buf.add("head.pitch", drift(t + 31, 5.3, 8.9, 13.7) * 1.6 * DEG * amp);
      buf.add("head.roll",  drift(t + 67, 6.1, 9.7, 15.1) * 1.1 * DEG * amp);

      // Head dips on stressed syllables. This coupling is most of what reads
      // as "actually talking" - more than the mouth does, at a distance.
      if (speaking) buf.add("head.pitch", -s.ampSlow * 1.8 * DEG);

      // A slight tilt while listening: the universal "go on, I'm following".
      const tilt = s.state === S.LISTENING || s.state === S.THINKING ? 3.0 : s.state === S.WAKING ? 4.0 : 0;
      buf.add("head.roll", tilt * DEG * 0.5);

      // Listening nods while the visitor is actually talking.
      if (s.userTalking && t > nextNod) { nodUntil = t + 0.55; nextNod = t + rand(3, 5); }
      if (t < nodUntil) {
        nodT = (nodUntil - t) / 0.55;
        buf.add("head.pitch", Math.sin((1 - nodT) * Math.PI * 2) * 2.4 * DEG);
      }

      // The head follows the eyes, lagging and at partial gain.
      buf.add("neck.yaw", s.attention.x * 6 * DEG);
      buf.add("neck.pitch", s.attention.y * 4 * DEG);
    },
  };
}

// ── gaze ────────────────────────────────────────────────────────────────────
// Saccades are ballistic on purpose: real eyes snap, they do not glide.
// Smoothly interpolated eye motion is the single clearest tell of a fake face.
export function createGaze() {
  let tx = 0, ty = 0, cx = 0, cy = 0, next = 0, snap = 0, lastBig = 0;
  return {
    id: "gaze",
    reset() { tx = ty = cx = cy = 0; next = 0; snap = 0; },
    lastSaccade: () => lastBig,
    update(dt, s, buf) {
      const t = s.t;
      if (t >= next) {
        const st = s.state;
        if (st === S.THINKING) {
          // Break away up and to the left, the classic recall posture.
          tx = rand(-0.55, -0.28); ty = rand(0.30, 0.55);
          next = t + rand(0.7, 1.3);
        } else if (st === S.LISTENING || st === S.SPEAKING || st === S.WAKING) {
          // Hold the visitor's eyes, with micro-saccades around them.
          const away = st === S.SPEAKING && Math.random() < 0.22;
          tx = away ? rand(-0.30, 0.30) : rand(-0.06, 0.06);
          ty = away ? rand(-0.12, 0.20) : rand(-0.05, 0.05);
          next = t + rand(0.4, 1.6);
        } else {
          // Idle: look around the room, occasionally back at the camera.
          const toCamera = Math.random() < 0.35;
          tx = toCamera ? rand(-0.05, 0.05) : rand(-0.5, 0.5);
          ty = toCamera ? rand(-0.04, 0.04) : rand(-0.25, 0.3);
          next = t + rand(1.6, 4.2);
        }
        const dist = Math.hypot(tx - cx, ty - cy);
        if (dist > 0.25) lastBig = t;      // blink animator listens for this
        snap = 2;                           // ballistic: arrive within 2 frames
      }

      if (snap > 0) { cx = lerp(cx, tx, 0.65); cy = lerp(cy, ty, 0.65); snap--; }
      else { cx = onePole(cx, tx, dt, 0.05); cy = onePole(cy, ty, dt, 0.05); }

      s.attention.x = cx;
      s.attention.y = cy;

      const ax = clamp(cx, -1, 1), ay = clamp(cy, -1, 1);
      buf.add(ax < 0 ? "eyeLookOut_L" : "eyeLookIn_L", Math.abs(ax) * 0.85);
      buf.add(ax < 0 ? "eyeLookIn_R" : "eyeLookOut_R", Math.abs(ax) * 0.85);
      buf.add(ay > 0 ? "eyeLookUp_L" : "eyeLookDown_L", Math.abs(ay) * 0.8);
      buf.add(ay > 0 ? "eyeLookUp_R" : "eyeLookDown_R", Math.abs(ay) * 0.8);
    },
  };
}

// ── blink ───────────────────────────────────────────────────────────────────
export function createBlink(gaze) {
  let next = 1.5, phase = -1, isDouble = false, seenSaccade = -1, lastState = null;
  const CLOSE = 0.06, HOLD = 0.02, OPEN = 0.14;
  const TOTAL = CLOSE + HOLD + OPEN;

  const curve = (p) => {
    if (p < CLOSE) { const x = p / CLOSE; return x * x; }               // fast close
    if (p < CLOSE + HOLD) return 1;
    const x = (p - CLOSE - HOLD) / OPEN;
    return 1 - x * (2 - x);                                             // eased open
  };

  return {
    id: "blink",
    reset() { next = 1.5; phase = -1; isDouble = false; lastState = null; },
    update(dt, s, buf) {
      const t = s.t;

      // Blink on every state change and after every large saccade. Both are
      // physiologically correct and both read as a thought landing.
      if (lastState !== s.state) { lastState = s.state; if (phase < 0) phase = 0; }
      const sac = gaze?.lastSaccade?.() ?? -1;
      if (sac > 0 && sac !== seenSaccade) { seenSaccade = sac; if (phase < 0) phase = 0; }

      if (phase < 0 && t >= next) {
        phase = 0;
        isDouble = Math.random() < 0.12;
        // Blink rate rises while listening, falls while speaking - as in people.
        next = t + (s.state === S.LISTENING ? rand(1.2, 3.0) : rand(2.6, 6.5));
      }

      if (phase >= 0) {
        phase += dt;
        if (phase >= TOTAL) {
          if (isDouble) { phase = 0; isDouble = false; }
          else phase = -1;
        }
      }

      const v = phase >= 0 ? curve(phase) : 0;
      buf.add("eyeBlink_L", v);
      buf.add("eyeBlink_R", v);
    },
  };
}

// ── emotion ─────────────────────────────────────────────────────────────────
// A target pose per conversation state, eased rather than switched. The eased
// transition is why the face reads as changing its mind instead of cutting.
const POSES = {
  [S.BOOT]:       { smile: 0.05, browInner: 0.00, browOuter: 0.00, squint: 0.00, wide: 0.00 },
  [S.LOCKED]:     { smile: 0.14, browInner: 0.05, browOuter: 0.06, squint: 0.00, wide: 0.00 },
  [S.IDLE]:       { smile: 0.18, browInner: 0.00, browOuter: 0.04, squint: 0.02, wide: 0.00 },
  [S.WAKING]:     { smile: 0.35, browInner: 0.15, browOuter: 0.22, squint: 0.00, wide: 0.10 },
  [S.CONNECTING]: { smile: 0.20, browInner: 0.22, browOuter: 0.10, squint: 0.04, wide: 0.00 },
  [S.LISTENING]:  { smile: 0.12, browInner: 0.08, browOuter: 0.12, squint: 0.05, wide: 0.02 },
  [S.THINKING]:   { smile: 0.06, browInner: 0.40, browOuter: 0.00, squint: 0.18, wide: 0.00 },
  [S.SPEAKING]:   { smile: 0.10, browInner: 0.06, browOuter: 0.08, squint: 0.02, wide: 0.00 },
  [S.WRAPPING]:   { smile: 0.42, browInner: 0.05, browOuter: 0.14, squint: 0.10, wide: 0.00 },
  [S.ERROR]:      { smile: 0.04, browInner: 0.50, browOuter: 0.00, squint: 0.12, wide: 0.00 },
};

export function createEmotion() {
  const cur = { smile: 0.05, browInner: 0, browOuter: 0, squint: 0, wide: 0 };
  const TAU = 0.4;
  return {
    id: "emotion",
    reset() { Object.assign(cur, POSES[S.BOOT]); },
    update(dt, s, buf) {
      const goal = POSES[s.state] || POSES[S.IDLE];
      for (const k of Object.keys(cur)) cur[k] = onePole(cur[k], goal[k], dt, TAU);

      // While speaking, the smile breathes with the voice rather than sitting
      // fixed - a static smile under moving lips looks pasted on.
      const smile = cur.smile + (s.state === S.SPEAKING ? s.ampSlow * 0.15 : 0);

      // Damped while the mouth is busy so it cannot fight the visemes.
      const k = s.state === S.SPEAKING ? 0.4 : 1;
      buf.add("mouthSmile_L", smile * k);
      buf.add("mouthSmile_R", smile * k);
      buf.add("mouthDimple_L", smile * 0.35 * k);
      buf.add("mouthDimple_R", smile * 0.35 * k);

      buf.add("browInnerUp", cur.browInner);
      buf.add("browOuterUp_L", cur.browOuter);
      buf.add("browOuterUp_R", cur.browOuter);
      buf.add("cheekSquint_L", cur.squint + smile * 0.30);
      buf.add("cheekSquint_R", cur.squint + smile * 0.30);
      buf.add("eyeSquint_L", cur.squint * 0.6 + smile * 0.18);
      buf.add("eyeSquint_R", cur.squint * 0.6 + smile * 0.18);
      buf.add("eyeWide_L", cur.wide);
      buf.add("eyeWide_R", cur.wide);
    },
  };
}

// ── viseme ──────────────────────────────────────────────────────────────────
// Writes the mouth exclusively from the pose AudioFeatures already computed.
// All the DSP lives in signals/, so this layer is a straight copy - which is
// the point: the hard part is unit-tested in plain node, not in here.
export function createViseme() {
  return {
    id: "viseme",
    reset() {},
    update(dt, s, buf) {
      const m = s.mouth;
      for (const ch in m) buf.set(ch, m[ch]);
    },
  };
}

/** The pipeline, in fixed order. */
export function createAnimators() {
  const gaze = createGaze();
  const list = [createBreath(), createHead(), gaze, createBlink(gaze), createEmotion(), createViseme()];
  return {
    list,
    byId: Object.fromEntries(list.map((a) => [a.id, a])),
    reset() { list.forEach((a) => a.reset()); },
    update(dt, signals, buf) {
      buf.begin();
      for (let i = 0; i < list.length; i++) list[i].update(dt, signals, buf);
      buf.finish();
      return buf;
    },
  };
}
