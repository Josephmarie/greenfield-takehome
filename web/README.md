# Pareto Health — Web App (Part 4)

A Vite + React (+ Tailwind) front end. `src/App.jsx` is a multi-page app:

- **Landing** — marketing page with a "Talk to the front desk" live-call entry.
  **Public** — no sign-in needed to try the number.
- **Call → Summary** — an inbound booking call, then an editable post-call
  summary of what was captured.
- **Dashboard (Intake Console)** — the OCR review surface (extracted fields +
  confidence, human-review queue, lab out-of-range flags, deny-back letter)
  with an outbound-callback dock that demonstrates the PHI-free voicemail.
  **Gated** — requires a real account (sign up / sign in).

### Auth

The dashboard is protected by real sign-up / sign-in backed by the OCR service
(`OCR_BASE` → `/auth/signup`, `/auth/login`); the JWT + user are kept in
`localStorage`. Sign-up runs a short GTM onboarding (organization, role, org
type, size, interest, phone) — every signup is written to Postgres **and**
mirrored to a Google Sheet as a sales lead (see `greenfield-ocr/README.md`).
Landing and the call flow stay public.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```
