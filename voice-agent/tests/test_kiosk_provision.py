"""Offline contract tests for the lobby-kiosk agent.

No network and no RETELL_API_KEY. These assert two separate things:

  * the kwargs the kiosk builder produces are accepted by the installed SDK,
    the same guarantee the phone agent already has; and
  * the safety properties that make a lobby kiosk different from a phone line,
    which are the parts most likely to be silently lost in a future edit.
"""

import inspect

import pytest

provision = pytest.importorskip("provision_retell")
kiosk = pytest.importorskip("provision_kiosk_agent")
from retell import Retell  # noqa: E402

client = Retell(api_key="test-key-not-used")
BASE_URL = "https://example.test"


def _allowed_params(method):
    return set(inspect.signature(method).parameters) - {
        "extra_headers", "extra_query", "extra_body", "timeout",
    }


def test_kiosk_llm_kwargs_accepted_by_sdk():
    kwargs = kiosk.build_kiosk_llm_kwargs(BASE_URL)
    assert set(kwargs) <= _allowed_params(client.llm.create)
    assert kwargs["model"] == provision.DEFAULT_LLM_MODEL


def test_kiosk_agent_kwargs_accepted_by_sdk():
    kwargs = kiosk.build_kiosk_agent_kwargs("llm_test")
    assert set(kwargs) <= _allowed_params(client.agent.create)


def test_kiosk_shares_the_phone_voice():
    # The avatar was designed around this voice, and a visitor who phoned
    # earlier should meet the same person in the lobby.
    assert kiosk.build_kiosk_agent_kwargs("llm_test")["voice_id"] == provision.VOICE_ID


def test_kiosk_has_no_voicemail_option():
    # A person standing at a screen cannot be an answering machine.
    assert "voicemail_option" not in kiosk.build_kiosk_agent_kwargs("llm_test")


def test_phone_agent_defaults_are_untouched():
    # The kiosk work added keyword-only overrides. The no-argument behaviour of
    # the phone builders must be byte-identical, because the phone agent is
    # provisioned from exactly those defaults.
    a = provision.build_agent_kwargs("llm_test")
    assert a["agent_name"] == "Greenfield Cardiology Front Desk"
    assert a["voice_id"] == provision.VOICE_ID
    assert a["voicemail_option"]["action"]["type"] == "static_text"
    llm = provision.build_llm_kwargs(BASE_URL)
    assert llm["begin_message"] == provision.BEGIN_MESSAGE


def test_kiosk_greeting_is_for_someone_standing_there():
    begin = kiosk.build_kiosk_llm_kwargs(BASE_URL)["begin_message"]
    assert "calling" not in begin.lower(), "the kiosk must not greet a walk-in as a caller"
    assert "welcome" in begin.lower()


def test_kiosk_prompt_contains_the_base_clinical_content():
    # The kiosk prompt is base + deltas. If the concatenation ever breaks, the
    # kiosk would lose the emergency triggers and the knowledge base entirely,
    # which would be both a safety and a correctness failure.
    prompt = kiosk.load_kiosk_prompt()
    for anchor in ("SECTION 1", "911", "check_availability", "Dr. Chen", "SECTION 8"):
        assert anchor in prompt, f"kiosk prompt lost {anchor!r}"
    assert len(prompt) > len(provision.load_system_prompt())


def test_kiosk_prompt_overrides_phone_only_behaviour():
    prompt = kiosk.load_kiosk_prompt()
    lower = prompt.lower()
    # The overrides must actually be present and must actually override.
    assert "callback number" in lower           # the phone behaviour it replaces
    assert "front desk right now" in lower      # the lobby emergency routing
    assert "public room" in lower               # the stricter PHI stance
    assert "thank you for calling" in lower     # quoted as forbidden in section 8


def test_tool_wiring_is_shared_not_forked():
    # Both agents must call the same six endpoints. A kiosk agent with a
    # divergent tool list would book against different logic than the phone.
    phone_tools = {t["name"] for t in provision.build_tools(BASE_URL)}
    kiosk_tools = {t["name"] for t in kiosk.build_kiosk_llm_kwargs(BASE_URL)["general_tools"]}
    assert phone_tools == kiosk_tools
    assert len(kiosk_tools) == 6
