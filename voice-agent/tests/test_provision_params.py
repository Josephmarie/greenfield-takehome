"""Offline contract tests for provision_retell.py against the installed retell-sdk.

No network and no RETELL_API_KEY needed. These assert that the kwargs the
provisioning script builds are accepted by the SDK's create signatures, so an
SDK version bump that renames or removes a field fails here instead of at
provision time.
"""

import inspect

import pytest

provision = pytest.importorskip("provision_retell")
from retell import Retell  # noqa: E402

client = Retell(api_key="test-key-not-used")
BASE_URL = "https://example.test"


def _allowed_params(method):
    return set(inspect.signature(method).parameters) - {
        "extra_headers", "extra_query", "extra_body", "timeout",
    }


def test_llm_model_string_is_valid():
    ann = inspect.signature(client.llm.create).parameters["model"].annotation
    assert "claude-4.6-sonnet" in ann
    assert "claude-sonnet-4-6" not in ann  # the old/invalid string
    assert provision.LLM_MODEL in ann


def test_llm_kwargs_keys_accepted():
    kwargs = provision.build_llm_kwargs(BASE_URL)
    assert set(kwargs) <= _allowed_params(client.llm.create)
    assert kwargs["model"] == "claude-4.6-sonnet"


def test_agent_kwargs_keys_accepted_and_voicemail_shape():
    kwargs = provision.build_agent_kwargs("llm_test")
    assert set(kwargs) <= _allowed_params(client.agent.create)
    action = kwargs["voicemail_option"]["action"]
    assert action["type"] == "static_text"
    assert "Greenfield Cardiology" in action["text"]


def test_voicemail_is_phi_free():
    text = provision.build_agent_kwargs("llm_test")["voicemail_option"]["action"]["text"]
    assert "415-555-0120" in text
    for leak in ("patient", "referral", "appointment", "dob", "diagnos"):
        assert leak not in text.lower()


def test_inbound_webhook_url_format():
    # We use our own Twilio number, so no phone_number.create. Instead the agent's
    # inbound URL is wired into Twilio's voice webhook.
    url = provision.inbound_webhook_url("agent_abc123")
    assert url == "https://api.retellai.com/inbound-call/agent_abc123"


def test_no_phone_number_provisioning():
    # Guard the new policy: the script must not call phone_number.create.
    src = inspect.getsource(provision)
    assert "phone_number.create" not in src


def test_six_custom_tools_have_valid_shape():
    from retell.types.llm_create_params import GeneralToolCustomTool

    tools = provision.build_tools(BASE_URL)
    assert len(tools) == 6
    allowed = set(GeneralToolCustomTool.__optional_keys__) | set(
        getattr(GeneralToolCustomTool, "__required_keys__", set())
    )
    expected_names = {
        "verify_insurance", "check_availability", "book_appointment",
        "lookup_location", "log_callback_attempt", "flag_for_clinical_review",
    }
    assert {t["name"] for t in tools} == expected_names
    for t in tools:
        assert t["type"] == "custom"
        assert t["url"].startswith(BASE_URL + "/")
        assert set(t) <= allowed
        assert set(t["parameters"]) <= {"type", "properties", "required"}
