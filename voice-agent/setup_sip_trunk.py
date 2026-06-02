"""Connect Twilio number +14156504518 to the Retell agent via Elastic SIP Trunk.

Inbound:  PSTN -> Twilio number -> trunk Origination (sip:sip.retellai.com) -> Retell agent
Outbound: Retell -> trunk Termination (<domain>.pstn.twilio.com) -> Twilio -> PSTN

Run:  set -a; . ../.secrets.env; set +a; .venv/bin/python setup_sip_trunk.py
Needs: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, RETELL_API_KEY
"""

import base64
import json
import os
import secrets
import sys
import urllib.parse
import urllib.request

SID = os.environ["TWILIO_ACCOUNT_SID"]
RETELL_KEY = os.environ["RETELL_API_KEY"]
AGENT_ID = "agent_7517f21fac4dfc22a22587ad15"
NUMBER = "+14156504518"
ORIGINATION_URI = "sip:sip.retellai.com"   # Retell's inbound SIP endpoint (per docs)

# Basic-auth: prefer Account SID + Auth Token; fall back to API Key + Secret.
# (The Account SID always stays in the URL path regardless.)
if os.environ.get("TWILIO_AUTH_TOKEN"):
    _user, _pass = SID, os.environ["TWILIO_AUTH_TOKEN"]
else:
    _user, _pass = os.environ["TWILIO_API_KEY"], os.environ["TWILIO_API_SECRET"]
_auth = base64.b64encode(f"{_user}:{_pass}".encode()).decode()


def twilio(method, url, **form):
    data = urllib.parse.urlencode(form).encode() if form else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Basic {_auth}")
    if data:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def step(n, msg):
    print(f"\n=== STEP {n}: {msg} ===")


# --- STEP 1: create the Elastic SIP Trunk (its domain == termination URI) -----
step(1, "Create Elastic SIP Trunk")
domain = f"greenfield-cardiology-{secrets.token_hex(3)}.pstn.twilio.com"
code, trunk = twilio("POST", "https://trunking.twilio.com/v1/Trunks",
                     FriendlyName="Greenfield Cardiology (Retell)", DomainName=domain)
print("HTTP", code, "->", json.dumps({k: trunk.get(k) for k in ("sid", "domain_name")}, indent=2))
if code >= 300:
    print("FATAL:", trunk); sys.exit(1)
trunk_sid = trunk["sid"]
termination_uri = trunk["domain_name"]

# --- STEP 2: Origination -> send inbound calls to Retell ----------------------
step(2, f"Add Origination URL {ORIGINATION_URI}")
code, orig = twilio("POST", f"https://trunking.twilio.com/v1/Trunks/{trunk_sid}/OriginationUrls",
                    FriendlyName="Retell", SipUrl=ORIGINATION_URI,
                    Weight="1", Priority="1", Enabled="true")
print("HTTP", code, "-> origination sid:", orig.get("sid"), "sip_url:", orig.get("sip_url"))

# --- STEP 3: SIP credential list for termination (outbound) auth --------------
step(3, "Create SIP credential list + credential, attach to trunk")
username = "greenfield_retell"
password = "Gf" + secrets.token_urlsafe(12) + "9X"   # mixed case + digits
code, cl = twilio("POST", f"https://api.twilio.com/2010-04-01/Accounts/{SID}/SIP/CredentialLists.json",
                  FriendlyName="Greenfield Retell")
print("HTTP", code, "-> credential_list sid:", cl.get("sid"))
cl_sid = cl["sid"]
code, cred = twilio("POST",
                    f"https://api.twilio.com/2010-04-01/Accounts/{SID}/SIP/CredentialLists/{cl_sid}/Credentials.json",
                    Username=username, Password=password)
print("HTTP", code, "-> credential username:", cred.get("username"))
code, att = twilio("POST", f"https://trunking.twilio.com/v1/Trunks/{trunk_sid}/CredentialLists",
                   CredentialListSid=cl_sid)
print("HTTP", code, "-> attached credential_list:", att.get("sid"))

# --- STEP 4: move +14156504518 onto the trunk --------------------------------
step(4, f"Associate {NUMBER} with the trunk")
q = urllib.parse.urlencode({"PhoneNumber": NUMBER})
code, look = twilio("GET", f"https://api.twilio.com/2010-04-01/Accounts/{SID}/IncomingPhoneNumbers.json?{q}")
ipn = look.get("incoming_phone_numbers", [])
if not ipn:
    print("FATAL: number not found on this Twilio account:", look); sys.exit(1)
pn_sid = ipn[0]["sid"]
print("number sid:", pn_sid, "current voice_url:", ipn[0].get("voice_url"))
code, pn = twilio("POST", f"https://trunking.twilio.com/v1/Trunks/{trunk_sid}/PhoneNumbers",
                  PhoneNumberSid=pn_sid)
print("HTTP", code, "-> number attached to trunk:", pn.get("sid"), "phone:", pn.get("phone_number"))

# --- STEP 5: import the number into Retell, bound to the agent ----------------
step(5, "Import number into Retell (termination_uri + SIP auth)")
body = json.dumps({
    "phone_number": NUMBER,
    "termination_uri": termination_uri,
    "sip_trunk_auth_username": username,
    "sip_trunk_auth_password": password,
    "inbound_agents": [{"agent_id": AGENT_ID, "weight": 1}],
    "outbound_agents": [{"agent_id": AGENT_ID, "weight": 1}],
    "nickname": "Greenfield Cardiology (Twilio SIP)",
}).encode()
req = urllib.request.Request("https://api.retellai.com/import-phone-number", data=body, method="POST")
req.add_header("Authorization", f"Bearer {RETELL_KEY}")
req.add_header("Content-Type", "application/json")
try:
    with urllib.request.urlopen(req) as r:
        rcode, rbody = r.status, json.loads(r.read().decode())
except urllib.error.HTTPError as e:
    rcode, rbody = e.code, json.loads(e.read().decode())
print("HTTP", rcode, "->", json.dumps(rbody, indent=2)[:500])

summary = {
    "trunk_sid": trunk_sid, "termination_uri": termination_uri,
    "origination_uri": ORIGINATION_URI, "credential_list_sid": cl_sid,
    "sip_username": username, "phone_number_sid": pn_sid,
    "retell_import_http": rcode, "agent_id": AGENT_ID,
}
open("/tmp/sip_summary.json", "w").write(json.dumps(summary, indent=2))
print("\n=== SUMMARY (saved /tmp/sip_summary.json) ===")
print(json.dumps(summary, indent=2))
