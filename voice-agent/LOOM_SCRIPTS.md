# Loom Scripts

Two recordings. Keep them tight — graders watch a lot of these. No re-explaining
the assignment, no apologizing. Just show it working.

## Voice Agent Loom (target 4–6 min)

Open: "Here's the Greenfield Cardiology line — [read the number]. I'll walk
through all four scenarios."

**Scenario 1 — routine booking (Dr. Chen follow-up)**
Call in. "Hi, I'd like to book a follow-up with Dr. Chen." Give a name (spell-back
happens), give a DOB when asked, give the reason. Let it find a slot, read it
back, and confirm. Point out: it asked for DOB rather than reading one back, and
it spelled the name back letter by letter.

**Scenario 2 — emergency**
Call in. "I'm having severe chest pain and my left arm is numb." The agent should
immediately give the 911 advisory, not book, not transfer, and end. Say on camera:
"Note it never entered scheduling and never asked for my information."

**Scenario 3 — downtown disambiguation**
Call in. "I'd like to see Dr. Chen at the downtown office." The agent should say
neither office is 'downtown,' name both (450 Market in SF, 2800 Broadway in
Oakland), ask which, then read back the full address of the one you pick. Note:
Dr. Chen genuinely works at both, so this is a real disambiguation.

**Scenario 4 — outbound + voicemail**
Trigger the outbound call to your own phone and let it go to voicemail. Play the
voicemail back on camera: it should say only the practice name and 415-555-0120 —
no patient name, no reason. Then show the backend `log_callback_attempt`
returning `too_soon` when called again inside 48 hours, and `closed` after the
third attempt. That demonstrates the 3-attempts / 48-hours-apart logic without
waiting real days.

Close: "All four scenarios, including the PHI-safe voicemail and the emergency
override."

## OCR Pipeline Loom (target ~5 min)

Open: "This is the fax intake pipeline. I'll run all three documents."

1. Show the repo structure briefly (README, the pipeline modules, tests).
2. Run the tests: `pytest -v`. Five green. Mention they prove the deny-back and
   lab logic offline, no API needed.
3. `python -m greenfield_ocr.cli process examples/Fax-InsuranceCard.pdf`
   — show all six fields extracted cleanly with source quotes and the empty
   review queue.
4. `python -m greenfield_ocr.cli process examples/Fax-LabResult.pdf`
   — scroll to the test values. Point out Neutrophils 72% flagged out-of-range
   even though the lab printed no flag — the pipeline computed it from the range.
5. `python -m greenfield_ocr.cli process examples/Fax-Referral.pdf`
   — show classification, then the deny-back letter naming exactly Group number
   and Referring provider NPI, and "Pushed downstream: False." Say: "Those two
   fields are blank on the fax, so the referral is held and the letter names
   exactly what's missing."

Close: "Classification, extraction with grounded confidence, human-review
flagging, and the deny-back — all on the real documents."
