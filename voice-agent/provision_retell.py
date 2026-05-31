"""Provision the Greenfield Cardiology voice agent on Retell, end to end.

Creates the Retell LLM (with the system prompt + the six custom tools pointing
at your deployed backend), an agent, and a phone number bound to that agent,
then prints the callable number.

    pip install retell-sdk
    export RETELL_API_KEY=...
    export BACKEND_URL=https://your-tunnel-or-deploy.example.com
    python provision_retell.py

NOTE ON API DRIFT: Retell's SDK field names change between versions. Before
trusting this script, confirm the current shapes for create-retell-llm,
create-agent, and create-phone-number against the installed SDK and the Retell
API reference, and adjust below if a field is rejected. Claude Code should do
this verification step rather than assuming these names are current.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from retell import Retell

RETELL_API_KEY = os.environ["RETELL_API_KEY"]
BACKEND_URL = os.environ["BACKEND_URL"].rstrip("/")
LLM_MODEL = os.environ.get("RETELL_LLM_MODEL", "claude-sonnet-4-6")
AREA_CODE = int(os.environ.get("AREA_CODE", "415"))
VOICE_ID = os.environ.get("RETELL_VOICE_ID", "11labs-Adrian")

client = Retell(api_key=RETELL_API_KEY)


def load_system_prompt() -> str:
    """Everything in retell_system_prompt.md below the divider line."""
    text = Path("retell_system_prompt.md").read_text()
    marker = "─────"
    return text.split(marker, 1)[-1].strip() if marker in text else text


def _tool(name: str, description: str, route: str, params: dict) -> dict:
    return {
        "type": "custom",
        "name": name,
        "description": description,
        "url": f"{BACKEND_URL}/{route}",
        "speak_during_execution": False,
        "speak_after_execution": True,
        "parameters": {"type": "object", "properties": params, "required": list(params)},
    }


def build_tools() -> list[dict]:
    s = {"type": "string"}
    return [
        _tool("verify_insurance", "Check whether an insurance carrier is in network.",
              "verify_insurance", {"carrier": s, "member_id": s}),
        _tool("check_availability", "Find open appointment slots for a provider at a location.",
              "check_availability", {"provider": s, "location": s, "appointment_type": s}),
        _tool("book_appointment", "Book a confirmed appointment.",
              "book_appointment", {"patient_name": s, "dob": s, "provider": s,
                                    "location": s, "slot": s, "reason": s}),
        _tool("lookup_location", "Return the address and hours for an office.",
              "lookup_location", {"query": s}),
        _tool("log_callback_attempt", "Record an outbound referral callback attempt.",
              "log_callback_attempt", {"referral_id": s, "outcome": s}),
        _tool("flag_for_clinical_review", "Flag a call for clinical review (e.g. after a 911 advisory).",
              "flag_for_clinical_review", {"reason": s}),
    ]


def main() -> None:
    print("Creating Retell LLM...")
    llm = client.llm.create(
        model=LLM_MODEL,
        general_prompt=load_system_prompt(),
        general_tools=build_tools(),
        begin_message="Thank you for calling Greenfield Cardiology, how can I help you today?",
    )
    print(f"  llm_id = {llm.llm_id}")

    print("Creating agent...")
    agent = client.agent.create(
        response_engine={"type": "retell-llm", "llm_id": llm.llm_id},
        voice_id=VOICE_ID,
        agent_name="Greenfield Cardiology Front Desk",
        language="en-US",
        # Voicemail handling for the outbound scenario. Confirm the exact field
        # name against your SDK version; some versions use `voicemail_option`.
        voicemail_message="This is a message from Greenfield Cardiology. "
                          "Please call us back at 415-555-0120. Thank you.",
    )
    print(f"  agent_id = {agent.agent_id}")

    print(f"Provisioning a {AREA_CODE} phone number...")
    number = client.phone_number.create(
        area_code=AREA_CODE,
        inbound_agent_id=agent.agent_id,
        outbound_agent_id=agent.agent_id,
        nickname="Greenfield Cardiology",
    )
    print("\n=== DONE ===")
    print(f"Callable number: {number.phone_number}")
    print(f"agent_id: {agent.agent_id}  llm_id: {llm.llm_id}")
    print("Submit this number. To test an outbound call to yourself:")
    print(f"  client.call.create_phone_call(from_number='{number.phone_number}', to_number='+1YOURCELL')")


if __name__ == "__main__":
    main()
