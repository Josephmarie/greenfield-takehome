// Behavioural tests for the kiosk state machine. Pure node: no browser, no
// audio device, no network, no Retell minutes. Every failure mode a lobby
// kiosk actually hits is expressed here as an event sequence.
import assert from "node:assert/strict";
import { reduce, run, initialContext, S, T, MS } from "./kioskMachine.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const has = (effects, type, extra = {}) =>
  effects.some((f) => f.type === type && Object.entries(extra).every(([k, v]) => f[k] === v));

const booted = () => run(initialContext(), ["ASSETS_READY", "AUDIO_UNLOCKED"]).ctx;
const tmr = (id) => ({ type: "TIMER", id });

// ── boot ────────────────────────────────────────────────────────────────────
{
  // Assets first, then unlock.
  let r = run(initialContext(), ["ASSETS_READY"]);
  eq(r.ctx.state, S.LOCKED, "assets without unlock must wait at the unlock screen");
  r = reduce(r.ctx, { type: "AUDIO_UNLOCKED" });
  eq(r.ctx.state, S.IDLE, "unlocking after assets reaches idle");

  // Unlock first, then assets. Order must not matter.
  let r2 = run(initialContext(), ["AUDIO_UNLOCKED"]);
  eq(r2.ctx.state, S.BOOT, "unlock alone is not enough to leave boot");
  r2 = reduce(r2.ctx, { type: "ASSETS_READY" });
  eq(r2.ctx.state, S.IDLE, "assets after unlock reaches idle");
  ok(has(r2.effects, "PING_WARM"), "entering idle warms the backend immediately");
  ok(has(r2.effects, "ACQUIRE_MIC", { owner: "wake" }), "idle hands the mic to the wake listener");
}

// ── the cancellable wake: a false trigger must cost nothing ─────────────────
{
  const idle = booted();
  const woke = reduce(idle, { type: "WAKE_DETECTED" });
  eq(woke.ctx.state, S.WAKING, "wake enters the performance state");
  ok(!has(woke.effects, "MINT_TOKEN"), "waking must NOT mint a token yet");
  ok(!has(woke.effects, "START_CALL"), "waking must NOT start a call yet");
  ok(has(woke.effects, "PING_WARM"), "waking warms the backend ahead of the token");

  const cancelled = reduce(woke.ctx, { type: "WAKE_CANCELLED" });
  eq(cancelled.ctx.state, S.IDLE, "a cancelled wake returns to idle");
  ok(!has(cancelled.effects, "MINT_TOKEN"), "a cancelled wake never spends anything");

  const held = reduce(woke.ctx, tmr(T.WAKE_HOLD));
  eq(held.ctx.state, S.CONNECTING, "holding through the wake window connects");
  ok(has(held.effects, "MINT_TOKEN"), "only a sustained wake mints a token");
  ok(has(held.effects, "ACQUIRE_MIC", { owner: "call" }), "the call takes the mic from the wake listener");
}

// ── the happy path ──────────────────────────────────────────────────────────
{
  let c = booted();
  let r = run(c, ["WAKE_DETECTED", tmr(T.WAKE_HOLD), { type: "TOKEN_OK", token: "t" }]);
  ok(has(r.effects, "START_CALL", { token: "t" }), "a token starts the call");
  eq(r.ctx.state, S.CONNECTING, "still connecting until the agent audio track arrives");

  r = reduce(r.ctx, { type: "CALL_CONNECTED" });
  eq(r.ctx.state, S.CONNECTING, "call_started alone must not go live - audio may not exist yet");

  r = reduce(r.ctx, { type: "CALL_READY" });
  eq(r.ctx.state, S.LISTENING, "call_ready is what goes live");
  ok(has(r.effects, "CONFIGURE_ANALYSER"), "the analyser must be reconfigured on ready");

  r = reduce(r.ctx, { type: "AGENT_SPEAK_START" });
  eq(r.ctx.state, S.SPEAKING, "agent speech drives the speaking state");
  r = reduce(r.ctx, { type: "AGENT_SPEAK_END" });
  eq(r.ctx.state, S.LISTENING, "agent silence returns to listening");
  r = reduce(r.ctx, { type: "USER_SPEAK_START" });
  r = reduce(r.ctx, { type: "USER_SPEAK_END" });
  eq(r.ctx.state, S.THINKING, "the gap after the visitor speaks is the thinking pause");
  r = reduce(r.ctx, { type: "AGENT_SPEAK_START" });
  eq(r.ctx.state, S.SPEAKING, "the agent answering ends the pause");

  r = reduce(r.ctx, { type: "CALL_ENDED" });
  eq(r.ctx.state, S.WRAPPING, "hangup wraps");
  r = reduce(r.ctx, tmr(T.WRAP));
  eq(r.ctx.state, S.IDLE, "wrapping returns to attract");
  ok(has(r.effects, "ACQUIRE_MIC", { owner: "wake" }), "the wake listener gets the mic back");
}

// ── Render cold start ───────────────────────────────────────────────────────
{
  let c = booted();
  let r = run(c, ["WAKE_DETECTED", tmr(T.WAKE_HOLD)]);
  eq(r.ctx.warming, false, "not warming immediately");
  r = reduce(r.ctx, tmr(T.TOKEN_SLOW));
  eq(r.ctx.warming, true, "a slow token switches to the waiting performance");
  eq(r.ctx.state, S.CONNECTING, "warming is a flag on connecting, not a separate state");

  // Cold start that eventually succeeds.
  r = reduce(r.ctx, { type: "TOKEN_OK", token: "t" });
  r = reduce(r.ctx, { type: "CALL_READY" });
  eq(r.ctx.state, S.LISTENING, "a slow-but-successful connect still goes live");
  eq(r.ctx.warming, false, "the warming flag clears once live");

  // Cold start that never answers.
  let r2 = run(booted(), ["WAKE_DETECTED", tmr(T.WAKE_HOLD), tmr(T.TOKEN_SLOW), tmr(T.TOKEN_TIMEOUT)]);
  eq(r2.ctx.state, S.ERROR, "a token that never arrives errors out");
  ok(/did not answer/.test(r2.ctx.error), "the error says what happened");
}

// ── failure backoff ─────────────────────────────────────────────────────────
{
  let c = booted();
  const waits = [];
  for (let i = 0; i < 4; i++) {
    const r = run(c, ["WAKE_DETECTED", tmr(T.WAKE_HOLD), { type: "TOKEN_FAIL", message: "boom" }]);
    waits.push(r.effects.find((f) => f.type === "TIMER" && f.id === T.ERROR_CLEAR).ms);
    c = reduce(r.ctx, tmr(T.ERROR_CLEAR)).ctx;
    eq(c.state, S.IDLE, "an error clears back to attract");
  }
  ok(waits[0] < waits[1] && waits[1] < waits[2], `consecutive failures must back off, got ${waits}`);
  eq(waits[3], waits[2], "backoff plateaus rather than growing without bound");

  // A success resets the counter, so one bad afternoon does not punish tomorrow.
  const good = run(booted(), ["WAKE_DETECTED", tmr(T.WAKE_HOLD), { type: "TOKEN_OK", token: "t" }, "CALL_READY"]);
  eq(good.ctx.failures, 0, "a successful connect resets the failure count");
}

// ── the visitor walks away ──────────────────────────────────────────────────
{
  const live = run(booted(), ["WAKE_DETECTED", tmr(T.WAKE_HOLD), { type: "TOKEN_OK", token: "t" }, "CALL_READY"]).ctx;
  let r = reduce(live, tmr(T.SILENCE_NUDGE));
  eq(r.ctx.nudge, true, "prolonged silence nudges first");
  eq(r.ctx.state, S.LISTENING, "a nudge does not end the call");
  r = reduce(r.ctx, tmr(T.SILENCE_END));
  eq(r.ctx.state, S.WRAPPING, "continued silence ends the call");
  ok(has(r.effects, "STOP_CALL"), "the call is actually stopped, not just hidden");

  // And the hard session cap, so nothing runs all afternoon.
  const capped = reduce(live, tmr(T.SESSION_CAP));
  eq(capped.ctx.state, S.WRAPPING, "the session cap wraps the call");
  ok(has(capped.effects, "STOP_CALL"), "the session cap stops the call");
  ok(MS.sessionCap <= 10 * 60 * 1000, "the session cap is short enough to bound cost");
}

// ── autoplay policy must never destroy a live call ──────────────────────────
{
  const live = run(booted(), ["WAKE_DETECTED", tmr(T.WAKE_HOLD), { type: "TOKEN_OK", token: "t" }, "CALL_READY"]).ctx;
  const blocked = reduce(live, { type: "AUDIO_BLOCKED" });
  eq(blocked.ctx.state, S.LOCKED, "blocked audio shows the unlock screen");
  ok(!has(blocked.effects, "STOP_CALL"), "blocked audio must NOT end the call - one tap should recover it");
  const back = reduce(blocked.ctx, { type: "TOUCH" });
  ok(has(back.effects, "UNLOCK_AUDIO"), "the recovering tap re-arms audio playback");
}

// ── duplicate and out-of-order events must not corrupt state ────────────────
{
  const live = run(booted(), ["WAKE_DETECTED", tmr(T.WAKE_HOLD), { type: "TOKEN_OK", token: "t" }, "CALL_READY"]).ctx;
  const once = reduce(live, { type: "CALL_ENDED" }).ctx;
  const twice = reduce(once, { type: "CALL_ENDED" }).ctx;
  eq(twice.state, S.WRAPPING, "call_ended twice is idempotent");

  // Stray events in idle must be inert, not throw.
  for (const e of ["AGENT_SPEAK_START", "CALL_READY", "TRANSCRIPT", "USER_SPEAK_END", "CALL_ENDED", "TOKEN_OK"]) {
    eq(reduce(booted(), { type: e }).ctx.state, S.IDLE, `${e} in idle must be inert`);
  }

  // Every state must survive every event without throwing.
  const EVENTS = ["ASSETS_READY", "AUDIO_UNLOCKED", "AUDIO_BLOCKED", "UNLOCK_FAILED", "TOUCH",
    "WAKE_DETECTED", "WAKE_CANCELLED", "TOKEN_OK", "TOKEN_FAIL", "CALL_CONNECTED", "CALL_READY",
    "AGENT_SPEAK_START", "AGENT_SPEAK_END", "USER_SPEAK_START", "USER_SPEAK_END", "TRANSCRIPT",
    "CALL_ENDED", "SDK_ERROR", "OFFLINE", "ONLINE"];
  const ALL_TIMERS = Object.values(T).map((id) => ({ type: "TIMER", id }));
  for (const state of Object.values(S)) {
    for (const ev of [...EVENTS.map((type) => ({ type })), ...ALL_TIMERS]) {
      const r = reduce({ ...initialContext(), state }, ev);
      ok(Object.values(S).includes(r.ctx.state), `${state} + ${ev.type}/${ev.id ?? ""} produced ${r.ctx.state}`);
      ok(Array.isArray(r.effects), "effects must always be an array");
    }
  }
}

// ── the mic is never held by two owners ─────────────────────────────────────
{
  // Walk a full conversation and check every ACQUIRE_MIC alternates correctly.
  let c = booted();
  const owners = [];
  const step = (ev) => {
    const r = reduce(c, typeof ev === "string" ? { type: ev } : ev);
    c = r.ctx;
    r.effects.filter((f) => f.type === "ACQUIRE_MIC").forEach((f) => owners.push(f.owner));
  };
  ["WAKE_DETECTED", tmr(T.WAKE_HOLD), { type: "TOKEN_OK", token: "t" }, "CALL_READY",
   "AGENT_SPEAK_START", "AGENT_SPEAK_END", "CALL_ENDED", tmr(T.WRAP)].forEach(step);
  for (let i = 1; i < owners.length; i++) {
    ok(owners[i] !== owners[i - 1], `mic acquired twice in a row by "${owners[i]}": ${owners}`);
  }
  eq(owners[owners.length - 1], "wake", "the wake listener always ends up holding the mic");
}

console.log(`kioskMachine: ${checks} assertions passed`);
