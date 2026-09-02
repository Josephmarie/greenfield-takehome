# Lobby kiosk — setup and operation

The avatar front desk lives at **`/kiosk`** on the same deployment as the web
app. This document covers getting it onto a screen and keeping it there.

---

## 1. The part that actually breaks kiosks

A machine that boots unattended **cannot** satisfy Chrome's autoplay policy or
answer a microphone permission prompt by itself. Miss this and the kiosk looks
completely broken on day one: a beautiful face that never speaks and never
hears anything. Everything below exists to prevent that.

### Chrome launch

`web/kiosk/launch-kiosk.ps1` in this repo does the following. Run it from
Task Scheduler at logon, not from a shortcut, so it survives a reboot.

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --kiosk `
  --app="https://web-cortif-ai.vercel.app/kiosk" `
  --user-data-dir="C:\kiosk-profile" `
  --autoplay-policy=no-user-gesture-required `
  --disable-features=CalculateNativeWinOcclusion,Translate `
  --disable-background-timer-throttling `
  --disable-renderer-backgrounding `
  --disable-session-crashed-bubble `
  --disable-infobars `
  --noerrdialogs `
  --check-for-update-interval=31536000
```

`--autoplay-policy=no-user-gesture-required` removes the gesture requirement
for audio outright. That one flag solves half the problem.

A **persistent `--user-data-dir` is mandatory**. Never add `--incognito`: it
discards the microphone grant on every launch, so the kiosk would prompt (and
therefore fail) every single morning.

### Microphone permission

Prefer the enterprise policy over a flag. Set once, as Administrator:

```
HKLM\SOFTWARE\Policies\Google\Chrome\AudioCaptureAllowedUrls\1
  = "https://web-cortif-ai.vercel.app"
```

This pre-grants the microphone for that origin with no prompt at all.

If you cannot set policy, open the kiosk URL once in that profile and click
Allow. The grant persists in `C:\kiosk-profile`.

> Do **not** use `--use-fake-device-for-media-stream`. It does not fake the
> permission, it fakes the *audio*, and the kiosk will hear a test tone instead
> of a visitor. (`--use-fake-ui-for-media-stream` auto-accepts the prompt and is
> acceptable for a demo, but the policy above is the right answer.)

### The in-app backstop

If audio is still locked, the kiosk shows a branded **"Touch anywhere to
begin"** screen rather than an error. One touch by a staff member at opening
arms audio for the whole day. A watchdog re-checks every five seconds and
brings that screen back if Windows changes the default audio device or the
machine wakes from sleep with the audio context suspended.

---

## 2. Hardware

Targeted at a 1080p landscape TV driven by a small Windows PC.

- **Display**: 1920×1080 landscape. The layout is expressed in a single derived
  design unit, so 4K and portrait work with no code change. At 4K the renderer
  deliberately draws at ~1080p and lets the panel upscale — a face at 4K native
  on integrated graphics is not a fight worth having, and at viewing distance it
  is invisible.
- **Microphone**: a *directional* USB mic, mounted near the screen at roughly
  head height. This matters more than any software setting: wake detection uses
  a proximity gate, and an omnidirectional mic hears the whole waiting room.
- **Speakers**: anything, but placed so the mic does not face them.
- **Network**: wired if possible. The kiosk keeps its own backend warm and needs
  connectivity for the conversation itself.

---

## 3. Deployment

The kiosk ships with the existing web app; there is no second deploy.

```bash
cd web
npm install
npm run build          # dist/
npm test               # 1198 assertions, no browser needed
npm run check:bundle   # asserts "/" never downloads the 3D renderer
```

`web/vercel.json` adds a rewrite for `/kiosk` only. It is deliberately scoped
rather than a catch-all, so it provably cannot change the behaviour of any
existing URL.

### Backend

One additive change to `voice-agent/backend.py`: a `kiosk` entry in `AGENTS`,
optional `metadata` / `dynamic_variables` on `POST /calls/web`, and a trivial
`GET /healthz`. With no new environment variable set, `kiosk` resolves to the
existing front-desk agent and behaviour is identical to before.

To give the kiosk its own agent:

```bash
cd voice-agent
set -a; . ../.secrets.env; set +a
BACKEND_URL=https://greenfield-voice-agent.onrender.com python provision_kiosk_agent.py
# then set RETELL_KIOSK_AGENT_ID=<printed id> on the Render service
```

### ⚠️ Never do these

| Action | Consequence |
| --- | --- |
| Re-run `setup_sip_trunk.py` | Creates a new SIP trunk and re-imports **+1 (415) 650-4518**, rebinding it. This is the one command that breaks the phone. |
| Repoint `RETELL_AGENT_ID` at the kiosk agent | The PSTN path survives (it resolves by literal agent id) but the web "front_desk" caller and the outbound fallback silently retarget. |
| Re-run `provision_retell.py` to "update" the agent | It has no update path; it always creates new ids. A prompt change made this way appears on the web and never on the phone. |

After any backend deploy: **call +1 (415) 650-4518** and confirm it still
answers *"Thank you for calling Greenfield Cardiology"*. Thirty seconds, and it
is the only thing that truly verifies the constraint.

---

## 4. Tuning on site

Append `?debug=1` to the kiosk URL for a HUD showing frame times, heap, current
state, and — the reason it exists — live microphone RMS against the adaptive
noise floor and the wake threshold. Setting wake sensitivity for a specific room
takes about five minutes with this on screen and is impossible to do from a desk.

Useful URL parameters:

| Parameter | Effect |
| --- | --- |
| `?debug=1` | HUD, plus `window.__kiosk` for inspection |
| `?mock=1` | Full scripted conversation with synthesised speech. No backend, no microphone, no Retell minutes. |
| `?no3d=1` | Force the 2D fallback |
| `?force=speaking` | Pin a state for screenshots |
| `?userCaptions=1` | Show visitor speech (**off by default — see PHI below**) |
| `?wake=porcupine` | Switch wake engine without a redeploy |
| `?cam=x,y,z&look=x,y,z&fov=n` | Live camera framing, for dialling in against the real panel |
| `?key=&fill=&rim=&env=&amb=&exposure=` | Live lighting |

---

## 5. Privacy

This is a screen on a wall in a cardiology waiting room, which is a PHI exposure
surface the phone line never had.

- Only the **agent's** most recent line is displayed. Visitor speech is **not
  rendered at all** unless `?userCaptions=1` is set.
- There is no transcript history on screen and nothing is persisted by the kiosk.
- The kiosk agent's prompt (`voice-agent/retell_kiosk_prompt.md`) forbids
  speaking dates of birth, member IDs, diagnoses or results aloud, and replaces
  the phone agent's letter-by-letter name readback — a phone technique that in a
  lobby broadcasts the name to the whole room.

**Open item requiring sign-off:** the kiosk prompt also replaces the emergency
script. Telling someone standing in your waiting room to hang up and call 911 is
wrong when staff are metres away, so the kiosk directs them to the front desk
*and* 911. That wording is clinically material and is marked in the prompt file
as needing review by whoever owns the clinical script before real use.

---

## 6. Keeping it alive

- The kiosk pings `GET /healthz` every four minutes while idle, which stops the
  free-tier Render instance sleeping so a visitor never waits out a 30–60s cold
  start. It also fires the moment a wake is detected, ~900 ms before the token
  is needed. The real fix remains a paid instance; this is the free one.
- The conversation has a 45-second silence timeout and a hard 8-minute session
  cap, so a visitor who walks away mid-sentence cannot leave a call billing.
- WebGL context loss is caught and recovered; if the 3D scene cannot start at
  all the kiosk falls back to the 2D presence motif and remains **fully
  conversational**. A blank screen in a lobby is worse than no avatar.
- Recommended: a scheduled `location.reload()` at 03:00. Crude, and effective
  insurance for anything that leaks over a twelve-hour day.

---

## 7. Swapping the avatar

The committed model is three.js's `facecap.glb`: a neutral face scan with the
full 52-shape ARKit set. The entire animation pipeline was built and tuned
against it, and it is **a development stand-in, not a designed receptionist** —
it is bald, has no shoulders, and its texture is a flat scan.

Replacing it is a file drop:

1. Put any GLB with ARKit-named morph targets in `web/public/avatar/`.
2. Point `VITE_AVATAR_MODEL` at it (or `?model=/avatar/yours.glb` to try it).

On load the kiosk logs exactly which channels it found and which are missing, so
a model with a partial morph set fails loudly instead of quietly refusing to
move its mouth. `?debug=1` shows the same as `morphs: N found / M missing`.
