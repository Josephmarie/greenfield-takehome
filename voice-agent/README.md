# Greenfield Cardiology — Voice Agent (Retell)

Three files:
- `retell_system_prompt.md` — paste into the Retell agent. All KB data baked in.
- `backend.py` — FastAPI tool server. Deploy public (Render), point Retell tools at it.
- `LOOM_SCRIPTS.md` — what to record.

## Run the backend
    pip install -r requirements.txt
    uvicorn backend:app --host 0.0.0.0 --port 8000

## Wire in Retell
1. Create an agent, set LLM = claude-sonnet-4-6, paste the system prompt.
2. Add the six function tools, each POSTing to the matching backend route.
3. Buy a phone number (Retell provisions Twilio in one click).
4. For Scenario 4, enable voicemail detection on the outbound agent.

## Why Retell
HIPAA + SOC2 Type II compliant, built-in voicemail detection, unlimited
concurrent calls for batch outbound, sub-500ms latency, transparent pricing.
The right default for a healthcare deployment.
