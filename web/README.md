# Greenfield Cardiology — Web App (Part 4)

A Vite + React (+ Tailwind) front end. `src/App.jsx` is the provided
`greenfield-app.jsx` multi-page app:

- **Landing** — marketing page with a "Talk to the front desk" live-call entry.
- **Call → Summary** — a simulated inbound booking call, then an editable
  post-call summary of what was captured.
- **Intake Console** — the OCR review surface (extracted fields + confidence,
  human-review queue, lab out-of-range flags, deny-back letter) with an
  outbound-callback dock that demonstrates the PHI-free voicemail.

The call lifecycle is **simulated** (`LIVE = false` in `App.jsx`), so the whole
flow demos with no backend running. To run against the real services, set
`LIVE = true` and point `API_BASE` at the voice-agent backend.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```
