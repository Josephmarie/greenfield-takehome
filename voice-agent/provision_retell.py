"""Provision the Greenfield Cardiology voice agent on Retell (LLM + agent only).

We do NOT buy a phone number through Retell. The practice already owns the
Twilio number +14156504518; after the agent is created we point that Twilio
number's voice webhook at Retell's inbound URL (done separately via the Twilio
MCP). This script creates the Retell LLM + agent and prints the agent_id,
llm_id, and the inbound webhook URL to wire into Twilio.

    pip install retell-sdk
    export RETELL_API_KEY=...
    export BACKEND_URL=https://your-tunnel-or-deploy.example.com
    python provision_retell.py

VERIFIED against retell-sdk 5.45.1 (2026-05-31): the param shapes below were
checked against the installed SDK's create signatures, not assumed:
  - llm.create(model=...) only accepts a fixed Literal; the correct Sonnet
    string is "claude-4.6-sonnet" (NOT "claude-sonnet-4-6").
  - voicemail is configured via voicemail_option={action:{type:"static_text",
    text:...}}, which enables voicemail detection AND leaves the fixed message.
If you bump the SDK, re-run tests/test_provision_params.py to catch drift.
"""

from __future__ import annotations

import os
from pathlib import Path

from retell import Retell

# Retell's model name for Claude Sonnet 4.6. Verified against the llm.create
# model Literal in retell-sdk 5.45.1 (allowed: claude-4.5-sonnet,
# claude-4.6-sonnet, claude-4.5-haiku, plus gpt-*/gemini-*).
DEFAULT_LLM_MODEL = "claude-4.6-sonnet"
LLM_MODEL = os.environ.get("RETELL_LLM_MODEL", DEFAULT_LLM_MODEL)
VOICE_ID = os.environ.get("RETELL_VOICE_ID", "11labs-Adrian")

# The exact PHI-free voicemail script (mirrors Section 6 of the system prompt).
VOICEMAIL_TEXT = (
    "This is a message from Greenfield Cardiology. "
    "Please call us back at 415-555-0120. Thank you."
)
BEGIN_MESSAGE = "Thank you for calling Greenfield Cardiology, how can I help you today?"


def load_system_prompt(path: str = "retell_system_prompt.md") -> str:
    """Everything in retell_system_prompt.md below the divider line."""
    text = Path(path).read_text()
    marker = "─────"
    return text.split(marker, 1)[-1].strip() if marker in text else text


def _tool(name: str, description: str, route: str, base_url: str, params: dict) -> dict:
    return {
        "type": "custom",
        "name": name,
        "description": description,
        "url": f"{base_url}/{route}",
        "method": "POST",
        "speak_during_execution": False,
        "speak_after_execution": True,
        "parameters": {"type": "object", "properties": params, "required": list(params)},
    }


def build_tools(base_url: str) -> list[dict]:
    s = {"type": "string"}
    return [
        _tool("verify_insurance", "Check whether an insurance carrier is in network.",
              "verify_insurance", base_url, {"carrier": s, "member_id": s}),
        _tool("check_availability", "Find open appointment slots for a provider at a location.",
              "check_availability", base_url, {"provider": s, "location": s, "appointment_type": s}),
        _tool("book_appointment", "Book a confirmed appointment.",
              "book_appointment", base_url, {"patient_name": s, "dob": s, "provider": s,
                                             "location": s, "slot": s, "reason": s}),
        _tool("lookup_location", "Return the address and hours for an office.",
              "lookup_location", base_url, {"query": s}),
        _tool("log_callback_attempt", "Record an outbound referral callback attempt.",
              "log_callback_attempt", base_url, {"referral_id": s, "outcome": s}),
        _tool("flag_for_clinical_review", "Flag a call for clinical review (e.g. after a 911 advisory).",
              "flag_for_clinical_review", base_url, {"reason": s}),
    ]


def build_llm_kwargs(base_url: str, model: str = LLM_MODEL) -> dict:
    return {
        "model": model,
        "general_prompt": load_system_prompt(),
        "general_tools": build_tools(base_url),
        "begin_message": BEGIN_MESSAGE,
    }


def build_agent_kwargs(llm_id: str) -> dict:
    return {
        "response_engine": {"type": "retell-llm", "llm_id": llm_id},
        "voice_id": VOICE_ID,
        "agent_name": "Greenfield Cardiology Front Desk",
        "language": "en-US",
        # Enables voicemail detection AND leaves the PHI-free message. The
        # static_text action is fixed, so no patient name / reason / clinical
        # detail is ever spoken to a machine.
        "voicemail_option": {
            "action": {"type": "static_text", "text": VOICEMAIL_TEXT},
        },
    }


def inbound_webhook_url(agent_id: str) -> str:
    """Retell inbound URL to set as the Twilio number's voice webhook."""
    return f"https://api.retellai.com/inbound-call/{agent_id}"


def main() -> None:
    api_key = os.environ["RETELL_API_KEY"]
    base_url = os.environ["BACKEND_URL"].rstrip("/")
    client = Retell(api_key=api_key)

    print("Creating Retell LLM...")
    llm = client.llm.create(**build_llm_kwargs(base_url))
    print(f"  llm_id = {llm.llm_id}")

    print("Creating agent...")
    agent = client.agent.create(**build_agent_kwargs(llm.llm_id))
    print(f"  agent_id = {agent.agent_id}")

    url = inbound_webhook_url(agent.agent_id)
    print("\n=== DONE (no Retell-provisioned number; using your Twilio +14156504518) ===")
    print(f"agent_id: {agent.agent_id}")
    print(f"llm_id:   {llm.llm_id}")
    print(f"Retell inbound webhook URL (set as Twilio voice webhook):\n  {url}")


if __name__ == "__main__":
    main()
