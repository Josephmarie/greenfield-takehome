# Claude Code Kickoff — Greenfield Cardiology Take-Home

Paste this as your first message to Claude Code (with Superpowers installed).
It tells Claude Code what's already built, what to finish, and what only YOU can
do. Superpowers' methodology (spec → plan → TDD → verify) should wrap all of it.

---

## Context

This is a job take-home with three parts, due Tuesday. Most of it is already
built and tested. Two folders exist in this directory:

- `greenfield-ocr/` — a runnable, tested OCR pipeline (Part 2). 5 logic tests
  pass offline. It classifies/extracts/validates fax documents and generates a
  deny-back letter for incomplete referrals.
- `voice-agent/` — a Retell voice agent (Part 1): `retell_system_prompt.md`
  (paste-ready), `backend.py` (FastAPI tool server), `provision_retell.py`
  (creates the agent + number via API), and `LOOM_SCRIPTS.md`.
- `reflection.md` — Part 3, written.

Your job is to finish, verify, and ship everything possible from the CLI, and
to clearly tell me the steps only I can do.

## Use the Superpowers workflow

Before touching code, run the brainstorming/verification skills. Treat the
existing code as a baseline to verify, not gospel — re-run the tests, read the
modules, confirm they do what the README claims. Use TDD discipline for any new
code (e.g. if you extend the pipeline). Use verification-before-completion
before declaring any step done.

## CLI tasks — do these yourself

1. **OCR pipeline.**
   - `cd greenfield-ocr && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
   - `pytest -v` — confirm 5 green.
   - With my `ANTHROPIC_API_KEY` set, run the CLI on all three docs in
     `examples/` and save the outputs to a `sample_outputs/` folder so I can
     show them in the Loom. Confirm the referral triggers the deny-back naming
     Group number + Referring provider NPI, the insurance card extracts all six
     fields, and the lab flags Neutrophils as out of range.
   - Initialize git, then `gh repo create greenfield-ocr --public --source=. --push`.

2. **Voice agent backend.**
   - `cd voice-agent && pip install -r requirements.txt`
   - Run it: `uvicorn backend:app --host 0.0.0.0 --port 8000`
   - Expose it with a zero-signup tunnel: `cloudflared tunnel --url http://localhost:8000`
     (or ngrok if I have it configured). Capture the public URL as `BACKEND_URL`.

3. **Provision Retell.**
   - First, VERIFY `provision_retell.py` against the installed `retell-sdk`
     version and the current Retell API reference (create-retell-llm,
     create-agent, create-phone-number). Field names drift between versions —
     read the SDK, fix any mismatched names, do not assume mine are current.
     Confirm the chosen LLM model string is one Retell currently supports; if
     not, pick the closest Claude option Retell exposes.
   - With `RETELL_API_KEY` and `BACKEND_URL` set: `python provision_retell.py`
   - Print the callable number.

4. **Reflection.** Convert `reflection.md` to PDF: `pandoc reflection.md -o reflection.pdf`
   (install pandoc if missing).

## Manual steps — tell me, then pause

These are not CLI-able. List them back to me clearly and wait where you need a
value from me:

- [ ] **Retell account + API key + billing** — I create the account at
  retellai.com, generate an API key, add a payment method, and export
  `RETELL_API_KEY`. (~5 min, web. HIPAA/BAA not needed — data is synthetic.)
- [ ] **Anthropic API key** — export `ANTHROPIC_API_KEY` if not already set.
- [ ] **GitHub auth** — `gh auth login` if not already authenticated.
- [ ] **Call the agent + record the voice Loom** — I phone the number and walk
  through all 4 scenarios (including saying "severe chest pain, left arm numb"
  to trigger the 911 path, and "downtown office" to trigger disambiguation),
  and let an outbound call hit my voicemail. I record this. See
  `voice-agent/LOOM_SCRIPTS.md`.
- [ ] **Record the OCR Loom** — I screen-record the pytest run + the three CLI
  outputs + the deny-back letter. See `LOOM_SCRIPTS.md`.
- [ ] **Submit** — I send the email with the number, repo link, two Loom links,
  and the reflection PDF.

## Ground rules

- After each CLI task, state plainly whether it passed and show the evidence
  (test output, the printed number, the repo URL). No "should work."
- If a step needs a secret or a value only I have, stop and ask — don't fake it.
- Never commit secrets. Confirm `.env` is gitignored before any push.
- The emergency-override behavior and the PHI-free voicemail are the two things
  that fail the take-home if wrong. If you change the system prompt, re-verify
  both.
