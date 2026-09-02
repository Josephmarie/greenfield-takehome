"""Create the lobby-kiosk Retell agent.

    set -a; . ../.secrets.env; set +a
    BACKEND_URL=https://greenfield-voice-agent.onrender.com python provision_kiosk_agent.py

Prints a new agent id. Set it as RETELL_KIOSK_AGENT_ID on the Render service
and nothing else changes: backend.py falls back to the front-desk agent when
that variable is absent.

═══════════════════════════════════════════════════════════════════════════
WHAT THIS SCRIPT DOES NOT DO, AND WHY
═══════════════════════════════════════════════════════════════════════════

It does not touch the phone number. +1 (415) 650-4518 is bound in Retell to
agent_7517f21fac4dfc22a22587ad15 through `POST /import-phone-number`, which is
issued only by setup_sip_trunk.py. Creating an agent cannot alter that binding.

Three things WOULD break the phone, so none of them happen here:

  1. Re-running setup_sip_trunk.py. It creates a brand-new SIP trunk with a
     fresh random domain and re-imports the number against whatever agent id is
     hardcoded at its line 20. This is the single most dangerous command in the
     repository.
  2. Repointing RETELL_AGENT_ID on Render at the kiosk agent. The PSTN path
     would survive (it resolves by literal id, not by env var), but the web
     "front_desk" caller and the outbound fallback would silently retarget.
  3. Re-running provision_retell.py expecting it to update the existing agent.
     It has no update path and always creates new LLM and agent ids, so a
     prompt change made that way appears on the web and never on the phone.

This script is additive: a new LLM, a new agent, a new env var.
"""

import os
import sys

from retell import Retell

import provision_retell as base

KIOSK_BEGIN_MESSAGE = (
    "Welcome to Greenfield Cardiology. I'm the front desk — how can I help you today?"
)
KIOSK_AGENT_NAME = "Greenfield Cardiology Lobby Kiosk"
KIOSK_PROMPT_PATH = "retell_kiosk_prompt.md"
BASE_PROMPT_PATH = "retell_system_prompt.md"


def load_kiosk_prompt(
    base_path: str = BASE_PROMPT_PATH, kiosk_path: str = KIOSK_PROMPT_PATH
) -> str:
    """Phone prompt first, then the kiosk deltas appended.

    Concatenating rather than maintaining a second full prompt is deliberate:
    the clinical knowledge base, the emergency triggers and the scheduling
    rules stay in exactly one file, so the phone agent and the kiosk agent
    cannot drift apart on anything that matters medically.
    """
    return base.load_system_prompt(base_path) + "\n\n" + base.load_system_prompt(kiosk_path)


def build_kiosk_llm_kwargs(backend_url: str) -> dict:
    kwargs = base.build_llm_kwargs(backend_url, begin_message=KIOSK_BEGIN_MESSAGE)
    kwargs["general_prompt"] = load_kiosk_prompt()
    return kwargs


def build_kiosk_agent_kwargs(llm_id: str) -> dict:
    return base.build_agent_kwargs(
        llm_id,
        # Same voice as the phone. The avatar was designed to match it, and a
        # visitor who called earlier should meet the same person in the lobby.
        voice_id=base.VOICE_ID,
        agent_name=KIOSK_AGENT_NAME,
        # A kiosk cannot reach an answering machine.
        voicemail=False,
    )


def main() -> int:
    api_key = os.environ.get("RETELL_API_KEY")
    backend_url = os.environ.get("BACKEND_URL")
    if not api_key or not backend_url:
        print("RETELL_API_KEY and BACKEND_URL are required", file=sys.stderr)
        return 2

    client = Retell(api_key=api_key)

    llm = client.llm.create(**build_kiosk_llm_kwargs(backend_url.rstrip("/")))
    agent = client.agent.create(**build_kiosk_agent_kwargs(llm.llm_id))

    print("kiosk llm_id  :", llm.llm_id)
    print("kiosk agent_id:", agent.agent_id)
    print()
    print("Set on the Render service, then redeploy:")
    print(f"  RETELL_KIOSK_AGENT_ID={agent.agent_id}")
    print()
    print("Then verify the phone is untouched: call +1 (415) 650-4518 and")
    print('confirm it still answers "Thank you for calling Greenfield Cardiology".')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
