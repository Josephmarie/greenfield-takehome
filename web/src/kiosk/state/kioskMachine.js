// The kiosk's conversation state machine.
//
// This file is deliberately pure: no fetch, no timers, no React, no audio. It
// takes a context and an event and returns the next context plus a list of
// effect descriptors for the caller to execute. Everything that can go wrong
// with a lobby kiosk - a cold backend, a dropped network, a visitor who walks
// away mid-sentence, a false wake trigger - is a sequence of events against
// this reducer, which means all of it is testable in milliseconds with no
// browser and without spending a single Retell minute.

export const S = {
  BOOT: "boot",
  LOCKED: "locked",
  IDLE: "idle",
  WAKING: "waking",
  CONNECTING: "connecting",
  LISTENING: "listening",
  THINKING: "thinking",
  SPEAKING: "speaking",
  WRAPPING: "wrapping",
  ERROR: "error",
};

export const T = {
  WAKE_HOLD: "wakeHold",
  TOKEN_SLOW: "tokenSlow",
  TOKEN_TIMEOUT: "tokenTimeout",
  WRAP: "wrap",
  ERROR_CLEAR: "errorClear",
  SILENCE_NUDGE: "silenceNudge",
  SILENCE_END: "silenceEnd",
  SESSION_CAP: "sessionCap",
  KEEPWARM: "keepwarm",
};

export const MS = {
  // How long the avatar performs "I noticed you" before spending anything.
  // A false trigger costs exactly this and nothing else.
  wakeHold: 900,
  tokenSlow: 2500,
  tokenTimeout: 45000,
  wrap: 2500,
  errorClear: 6000,
  silenceNudge: 25000,
  silenceEnd: 45000,
  sessionCap: 8 * 60 * 1000,
  keepwarm: 4 * 60 * 1000,
};

// Backoff between retries after consecutive failures, so a dead backend is not
// hammered all night by a kiosk that will happily keep trying.
const ERROR_BACKOFF_MS = [6000, 15000, 45000];

export function initialContext(overrides = {}) {
  return {
    state: S.BOOT,
    since: 0,
    agentLine: "",
    userLine: "",
    error: null,
    warming: false,
    nudge: false,
    failures: 0,
    unlocked: false,
    assetsReady: false,
    ...overrides,
  };
}

const timer = (id, ms) => ({ type: "TIMER", id, ms });
const cancel = (id) => ({ type: "CANCEL_TIMER", id });

const CLEAR_CALL_TIMERS = [
  cancel(T.TOKEN_SLOW),
  cancel(T.TOKEN_TIMEOUT),
  cancel(T.SILENCE_NUDGE),
  cancel(T.SILENCE_END),
  cancel(T.SESSION_CAP),
];

/** Enter the attract loop, releasing the mic back to the wake listener. */
function toIdle(ctx, now, extra = []) {
  return {
    ctx: {
      ...ctx,
      state: S.IDLE,
      since: now,
      agentLine: "",
      userLine: "",
      warming: false,
      nudge: false,
      error: null,
    },
    effects: [
      ...CLEAR_CALL_TIMERS,
      cancel(T.WAKE_HOLD),
      cancel(T.WRAP),
      cancel(T.ERROR_CLEAR),
      { type: "ACQUIRE_MIC", owner: "wake" },
      timer(T.KEEPWARM, MS.keepwarm),
      ...extra,
    ],
  };
}

function toError(ctx, now, message) {
  const failures = ctx.failures + 1;
  const wait = ERROR_BACKOFF_MS[Math.min(failures - 1, ERROR_BACKOFF_MS.length - 1)];
  return {
    ctx: { ...ctx, state: S.ERROR, since: now, error: message, warming: false, nudge: false, failures },
    effects: [...CLEAR_CALL_TIMERS, { type: "STOP_CALL" }, timer(T.ERROR_CLEAR, wait)],
  };
}

export function reduce(ctx, event, now = 0) {
  const e = event.type;

  // Global transitions, valid from any state.
  if (e === "AUDIO_BLOCKED" || e === "UNLOCK_FAILED") {
    // Deliberately does NOT end the call: the visitor taps once and hears the
    // agent again, rather than losing the conversation to a browser policy.
    return { ctx: { ...ctx, state: S.LOCKED, since: now, unlocked: false }, effects: [] };
  }
  if (e === "SDK_ERROR") return toError(ctx, now, event.message || "call error");
  if (e === "OFFLINE" && ctx.state !== S.IDLE && ctx.state !== S.LOCKED && ctx.state !== S.BOOT) {
    return toError(ctx, now, "network unavailable");
  }

  switch (ctx.state) {
    case S.BOOT: {
      if (e === "ASSETS_READY") {
        const next = { ...ctx, assetsReady: true };
        return next.unlocked
          ? toIdle(next, now, [{ type: "PING_WARM" }])
          : { ctx: { ...next, state: S.LOCKED, since: now }, effects: [] };
      }
      if (e === "AUDIO_UNLOCKED") {
        const next = { ...ctx, unlocked: true };
        return next.assetsReady
          ? toIdle(next, now, [{ type: "PING_WARM" }])
          : { ctx: next, effects: [] };
      }
      return { ctx, effects: [] };
    }

    case S.LOCKED: {
      if (e === "AUDIO_UNLOCKED" || e === "TOUCH") {
        return toIdle({ ...ctx, unlocked: true }, now, [{ type: "UNLOCK_AUDIO" }, { type: "PING_WARM" }]);
      }
      if (e === "ASSETS_READY") return { ctx: { ...ctx, assetsReady: true }, effects: [] };
      return { ctx, effects: [] };
    }

    case S.IDLE: {
      if (e === "WAKE_DETECTED" || e === "TOUCH") {
        // Perform first, spend later. No token is minted until the hold expires,
        // so a false trigger costs one head turn and nothing else.
        return {
          ctx: { ...ctx, state: S.WAKING, since: now, error: null },
          effects: [cancel(T.KEEPWARM), { type: "PING_WARM" }, timer(T.WAKE_HOLD, MS.wakeHold)],
        };
      }
      if (e === "TIMER" && event.id === T.KEEPWARM) {
        // Keeps the free-tier backend from sleeping so a real visitor never
        // meets a cold start. This is the fix; the waiting copy is the backstop.
        return { ctx, effects: [{ type: "PING_WARM" }, timer(T.KEEPWARM, MS.keepwarm)] };
      }
      return { ctx, effects: [] };
    }

    case S.WAKING: {
      if (e === "WAKE_CANCELLED") return toIdle(ctx, now);
      if (e === "TIMER" && event.id === T.WAKE_HOLD) {
        return {
          ctx: { ...ctx, state: S.CONNECTING, since: now, warming: false },
          effects: [
            { type: "ACQUIRE_MIC", owner: "call" },
            { type: "MINT_TOKEN" },
            timer(T.TOKEN_SLOW, MS.tokenSlow),
            timer(T.TOKEN_TIMEOUT, MS.tokenTimeout),
          ],
        };
      }
      return { ctx, effects: [] };
    }

    case S.CONNECTING: {
      if (e === "TIMER" && event.id === T.TOKEN_SLOW) return { ctx: { ...ctx, warming: true }, effects: [] };
      if (e === "TIMER" && event.id === T.TOKEN_TIMEOUT) return toError(ctx, now, "the front desk did not answer");
      if (e === "TOKEN_OK") {
        return { ctx, effects: [{ type: "START_CALL", token: event.token, callId: event.callId }] };
      }
      if (e === "TOKEN_FAIL") return toError(ctx, now, event.message || "could not reach the front desk");
      if (e === "CALL_CONNECTED") return { ctx, effects: [] }; // room joined; agent audio not up yet
      if (e === "CALL_READY") {
        // Only now does agent audio exist, and only now does the analyser.
        return {
          ctx: { ...ctx, state: S.LISTENING, since: now, warming: false, failures: 0 },
          effects: [
            cancel(T.TOKEN_SLOW),
            cancel(T.TOKEN_TIMEOUT),
            { type: "CONFIGURE_ANALYSER" },
            timer(T.SESSION_CAP, MS.sessionCap),
            timer(T.SILENCE_NUDGE, MS.silenceNudge),
          ],
        };
      }
      if (e === "CALL_ENDED") return toError(ctx, now, "the call ended before it connected");
      return { ctx, effects: [] };
    }

    case S.LISTENING:
    case S.THINKING:
    case S.SPEAKING: {
      if (e === "AGENT_SPEAK_START") {
        return {
          ctx: { ...ctx, state: S.SPEAKING, since: now, nudge: false },
          effects: [cancel(T.SILENCE_NUDGE), cancel(T.SILENCE_END)],
        };
      }
      if (e === "AGENT_SPEAK_END") {
        return {
          ctx: { ...ctx, state: S.LISTENING, since: now },
          effects: [timer(T.SILENCE_NUDGE, MS.silenceNudge)],
        };
      }
      if (e === "USER_SPEAK_START") {
        return { ctx: { ...ctx, nudge: false }, effects: [cancel(T.SILENCE_NUDGE), cancel(T.SILENCE_END)] };
      }
      if (e === "USER_SPEAK_END") {
        // The visitor stopped and the agent has not started. Showing that gap
        // as a considered pause rather than a dead face is most of what makes
        // the avatar feel present.
        return ctx.state === S.SPEAKING
          ? { ctx, effects: [] }
          : {
              ctx: { ...ctx, state: S.THINKING, since: now },
              effects: [timer(T.SILENCE_NUDGE, MS.silenceNudge)],
            };
      }
      if (e === "TRANSCRIPT") {
        return {
          ctx: { ...ctx, agentLine: event.agent ?? ctx.agentLine, userLine: event.user ?? ctx.userLine },
          effects: [],
        };
      }
      if (e === "TIMER" && event.id === T.SILENCE_NUDGE) {
        return { ctx: { ...ctx, nudge: true }, effects: [timer(T.SILENCE_END, MS.silenceEnd - MS.silenceNudge)] };
      }
      if (e === "TIMER" && (event.id === T.SILENCE_END || event.id === T.SESSION_CAP)) {
        return {
          ctx: { ...ctx, state: S.WRAPPING, since: now, nudge: false },
          effects: [...CLEAR_CALL_TIMERS, { type: "STOP_CALL" }, timer(T.WRAP, MS.wrap)],
        };
      }
      if (e === "CALL_ENDED") {
        return {
          ctx: { ...ctx, state: S.WRAPPING, since: now, nudge: false },
          effects: [...CLEAR_CALL_TIMERS, timer(T.WRAP, MS.wrap)],
        };
      }
      return { ctx, effects: [] };
    }

    case S.WRAPPING: {
      if (e === "TIMER" && event.id === T.WRAP) return toIdle(ctx, now);
      if (e === "TOUCH") return toIdle(ctx, now);
      if (e === "CALL_ENDED") return { ctx, effects: [] }; // idempotent: it can arrive twice
      return { ctx, effects: [] };
    }

    case S.ERROR: {
      if (e === "TIMER" && event.id === T.ERROR_CLEAR) return toIdle(ctx, now);
      if (e === "TOUCH") return toIdle(ctx, now);
      if (e === "CALL_ENDED") return { ctx, effects: [] };
      return { ctx, effects: [] };
    }

    default:
      return { ctx, effects: [] };
  }
}

/** Fold a list of events. Used by the tests and the mock timeline. */
export function run(ctx, events, now = 0) {
  const all = [];
  for (const ev of events) {
    const r = reduce(ctx, typeof ev === "string" ? { type: ev } : ev, now);
    ctx = r.ctx;
    all.push(...r.effects);
  }
  return { ctx, effects: all };
}
