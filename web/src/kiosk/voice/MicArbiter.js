// Exclusive microphone ownership.
//
// Chrome will happily give two getUserMedia streams on the same device, so
// this is a policy rather than a hardware lock - but running the wake listener
// and the call at the same time is wrong for two reasons: two AEC-enabled
// capture graphs on one device degrade each other's echo cancellation, and the
// wake listener would hear the agent's own voice through the lobby speakers
// and trigger on it.
//
// Handing the device over needs a settle delay. Re-acquiring too quickly on
// Windows yields NotReadableError, so acquisition retries with backoff and, if
// it still fails, the kiosk degrades to touch-to-talk rather than dying.

const SETTLE_MS = 150;
const RETRY_MS = [250, 600, 1200];

export function createMicArbiter() {
  let owner = null;
  let release = null;
  let queue = Promise.resolve();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function doAcquire(next, releaseFn) {
    if (owner === next) return true;
    if (release) {
      try { await release(); } catch (e) { console.warn("[kiosk] mic release failed:", e); }
      release = null;
      owner = null;
      await sleep(SETTLE_MS);
    }
    owner = next;
    release = releaseFn || null;
    return true;
  }

  return {
    get owner() { return owner; },

    /**
     * Serialised so a wake detection arriving during teardown cannot
     * interleave with the call starting up.
     */
    acquire(next, releaseFn) {
      queue = queue.then(() => doAcquire(next, releaseFn)).catch((e) => {
        console.warn("[kiosk] mic acquire failed:", e);
        return false;
      });
      return queue;
    },

    releaseAll() {
      queue = queue.then(async () => {
        if (release) { try { await release(); } catch {} }
        release = null;
        owner = null;
      });
      return queue;
    },

    /** Open a device stream with backoff. Returns null rather than throwing. */
    async openStream(constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }) {
      for (let i = 0; i <= RETRY_MS.length; i++) {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
          if (e?.name === "NotAllowedError" || i === RETRY_MS.length) {
            console.warn("[kiosk] could not open microphone:", e?.name || e);
            return null;
          }
          await sleep(RETRY_MS[i]);
        }
      }
      return null;
    },
  };
}
