"""Guards on the PSTN path.

+1 (415) 650-4518 is the one thing in this repository that must not break, and
the ways it breaks are all edits that look harmless in review. These tests read
the source directly rather than importing it, so they run with no FastAPI, no
Retell SDK and no environment configured -- which means they also run in a bare
CI job and cannot be skipped by accident.
"""

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
BACKEND = (HERE / "backend.py").read_text(encoding="utf-8")
SIP = (HERE / "setup_sip_trunk.py").read_text(encoding="utf-8")

# The agent the phone number is actually bound to, via POST /import-phone-number.
PHONE_AGENT_ID = "agent_7517f21fac4dfc22a22587ad15"
PHONE_NUMBER = "+14156504518"


def _function_body(src: str, name: str) -> str:
    """Source of one top-level function, docstring included.

    Splitting on a blank line does not work here: these functions have
    docstrings with blank lines in them, so a naive regex stops at the first
    paragraph break and the assertions below silently pass against nothing.
    Slice from the def to the next top-level statement instead.
    """
    start = src.index(f"def {name}(")
    rest = src[start:]
    m = re.search(r"\n(?=(?:@app\.|def |class ))", rest)
    return rest[: m.start()] if m else rest


def test_sip_trunk_still_targets_the_bound_agent():
    # If this changes, re-running setup_sip_trunk.py would rebind the number to
    # a different agent. The value is asserted rather than trusted.
    assert f'AGENT_ID = "{PHONE_AGENT_ID}"' in SIP
    assert f'NUMBER = "{PHONE_NUMBER}"' in SIP


def test_only_the_sip_script_imports_the_phone_number():
    # import-phone-number is what writes inbound_agents/outbound_agents. It must
    # appear in exactly one file, and never in the request-serving backend.
    assert "import-phone-number" in SIP
    assert "import-phone-number" not in BACKEND


def test_kiosk_agent_falls_back_to_the_front_desk():
    # Deploying the kiosk change with no new environment variable must behave
    # exactly as before rather than resolving to None.
    assert 'KIOSK_AGENT_ID = os.environ.get("RETELL_KIOSK_AGENT_ID")' in BACKEND
    assert '"kiosk": KIOSK_AGENT_ID or AGENT_ID' in BACKEND


def test_existing_agent_keys_are_unchanged():
    assert '"front_desk": AGENT_ID' in BACKEND
    assert '"outbound": OUTBOUND_AGENT_ID or AGENT_ID' in BACKEND
    assert 'AGENT_ID = os.environ.get("RETELL_AGENT_ID")' in BACKEND
    assert 'FROM_NUMBER = os.environ.get("RETELL_FROM_NUMBER", "+14156504518")' in BACKEND


def test_outbound_call_path_is_untouched():
    # The outbound leg dials through the same number and must keep using
    # create_phone_call with FROM_NUMBER.
    assert "_retell.call.create_phone_call(" in BACKEND
    assert "from_number=FROM_NUMBER" in BACKEND


def test_web_call_extras_are_opt_in():
    # metadata / dynamic_variables must only be forwarded when a caller sends
    # them, so the existing frontend - which sends neither - is unaffected.
    body = _function_body(BACKEND, "create_web_call")
    assert "if req and req.metadata:" in body
    assert "if req and req.dynamic_variables:" in body


def test_healthz_is_trivial():
    # The kiosk pings this every four minutes for twelve hours a day; it must
    # not do any work.
    body = _function_body(BACKEND, "healthz")
    assert "return {\"ok\": True}" in body
    for forbidden in ("_retell", "requests", "calendar", "os.environ"):
        assert forbidden not in body
