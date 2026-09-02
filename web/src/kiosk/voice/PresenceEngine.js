// Wake detection by voice presence and proximity.
//
// Why not Picovoice Porcupine as the default, despite it being the better
// detector: a CUSTOM wake word (".ppn") on the free tier is licensed for
// personal use and EXPIRES AFTER 30 DAYS. An unattended lobby kiosk would
// therefore go silently deaf about a month after installation, which is the
// worst failure mode available - it looks like the product simply stopped
// working. The built-in keywords never expire but are all off-brand
// ("porcupine", "jarvis", "computer"), and the AccessKey licence check assumes
// a working network at boot. Porcupine remains available behind the WakeEngine
// interface via ?wake=porcupine, for an on-site A/B without a redeploy.
//
// What makes plain presence detection good enough here is not better accuracy.
// It is that the kiosk makes a false trigger FREE: waking is a 900 ms
// performance during which no token is minted and no call is placed, and it
// silently cancels if presence does not hold. A false trigger costs one head
// turn that nobody was looking at.
//
// Signals per 20 ms hop: broadband RMS, the 300-3400 Hz speech-band ratio,
// zero-crossing rate, and a slowly-adapting noise floor. The proximity gate
// (floor + 15 dB) does most of the work of ignoring conversations across the
// room, and it is a single number an operator can tune on site in five minutes
// with ?debug=1 showing live RMS against the floor.

export const PRESENCE_DEFAULTS = {
  bandRatioMin: 0.55,
  presenceDb: 9,      // above the noise floor to count as speech at all
  proximityDb: 15,    // above the noise floor to count as speech AT the kiosk
  sustainMs: 800,
  cooldownMs: 3000,
  floorPercentile: 0.1,
  floorWindowS: 30,
};

export function createPresenceEngine(opts = {}) {
  const cfg = { ...PRESENCE_DEFAULTS, ...opts };
  let ctx = null, src = null, analyser = null, raf = 0, stream = null;
  let spec = null, time = null;
  let floor = 0.004;
  const history = [];
  let sustainedSince = 0;
  let lastWake = -1e9;
  let onWake = null, onLevel = null;

  const db = (a, b) => 20 * Math.log10((a + 1e-9) / (b + 1e-9));

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!analyser) return;

    analyser.getByteTimeDomainData(time);
    analyser.getByteFrequencyData(spec);

    let sum = 0, zc = 0, prev = 0;
    for (let i = 0; i < time.length; i++) {
      const v = (time[i] - 128) / 128;
      sum += v * v;
      if (i && Math.sign(v) !== Math.sign(prev)) zc++;
      prev = v;
    }
    const rms = Math.sqrt(sum / time.length);
    const zcr = zc / time.length;

    const binHz = (ctx?.sampleRate || 48000) / analyser.fftSize;
    let speech = 0, total = 0;
    for (let i = 1; i < spec.length; i++) {
      const hz = i * binHz;
      const m = spec[i];
      total += m;
      if (hz >= 300 && hz <= 3400) speech += m;
    }
    const bandRatio = total > 0 ? speech / total : 0;

    // Adaptive noise floor: the 10th percentile of a rolling 30 s window, so a
    // lobby with air conditioning does not read as constant speech.
    history.push(rms);
    const maxLen = Math.round(cfg.floorWindowS * 60);
    if (history.length > maxLen) history.shift();
    if (history.length > 30 && history.length % 30 === 0) {
      const sorted = [...history].sort((a, b) => a - b);
      floor = Math.max(1e-4, sorted[Math.floor(sorted.length * cfg.floorPercentile)]);
    }

    const above = db(rms, floor);
    const voiced = bandRatio > cfg.bandRatioMin && above > cfg.presenceDb && zcr > 0.01 && zcr < 0.35;
    const near = above > cfg.proximityDb;

    const now = performance.now();
    if (voiced && near) {
      if (!sustainedSince) sustainedSince = now;
      if (now - sustainedSince > cfg.sustainMs && now - lastWake > cfg.cooldownMs) {
        lastWake = now;
        sustainedSince = 0;
        onWake?.();
      }
    } else {
      sustainedSince = 0;
    }

    onLevel?.({ rms, floor, above, bandRatio, zcr, near, voiced });
  }

  return {
    kind: "presence",
    cfg,

    async start(mediaStream, handlers = {}) {
      onWake = handlers.onWake;
      onLevel = handlers.onLevel;
      stream = mediaStream;
      ctx = handlers.audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") { try { await ctx.resume(); } catch {} }

      src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.3;
      analyser.minDecibels = -95;
      analyser.maxDecibels = -20;
      spec = new Uint8Array(analyser.frequencyBinCount);
      time = new Uint8Array(analyser.fftSize);
      src.connect(analyser);
      history.length = 0;
      sustainedSince = 0;
      raf = requestAnimationFrame(loop);
    },

    async stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      try { src?.disconnect(); } catch {}
      try { analyser?.disconnect(); } catch {}
      src = null; analyser = null;
      // Stop the tracks so the device is genuinely free for the call, but keep
      // the AudioContext: Chrome caps concurrent contexts and creating and
      // closing one per conversation leaks across a twelve-hour day.
      try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
      stream = null;
      onWake = null; onLevel = null;
    },
  };
}
