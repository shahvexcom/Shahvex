#!/usr/bin/env python3
"""Asterisk AGI hook, invoked on an actual customer/human bridge or customer hangup.

AGI(handoff-event.py,human-answered,ORIGINAL_VICIDIAL_CALLER_CODE,HUMAN_USER)
AGI(handoff-event.py,customer-ended,ORIGINAL_VICIDIAL_CALLER_CODE)
The administrator must map the original caller-code through the transfer leg.
Never invoke human-answered merely when the transfer is requested or ringing.
"""
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.request
import uuid

for line in sys.stdin:
    if not line.strip():
        break
try:
    action, external_id = sys.argv[1:3]
    if action not in ("human-answered", "customer-ended") or not re.fullmatch(r"[\w-]{16,40}", external_id):
        raise ValueError("Invalid handoff event")
    payload = {"action": action, "externalCallId": external_id, "eventId": str(uuid.uuid4())}
    if action == "human-answered":
        human = sys.argv[3]
        if not re.fullmatch(r"[\w-]{2,20}", human):
            raise ValueError("Invalid human user")
        payload["humanUser"] = human
    with open(os.environ.get("SHAHVEX_VICIDIAL_CONFIG", "/etc/shahvex-vicidial.json")) as file:
        config = json.load(file)
    body = json.dumps(payload, separators=(",", ":")).encode()
    timestamp = str(int(time.time() * 1000))
    signature = hmac.new(config["secret"].encode(), (timestamp + "\nPOST\n/handoff-event\n").encode() + body, hashlib.sha256).hexdigest()
    request = urllib.request.Request(config.get("controlUrl", "http://127.0.0.1:8790") + "/handoff-event", data=body, headers={"Content-Type": "application/json", "x-shahvex-timestamp": timestamp, "x-shahvex-signature": signature})
    with urllib.request.urlopen(request, timeout=20) as response:
        accepted = json.load(response).get("accepted", False)
    print('SET VARIABLE SHAHVEX_HANDOFF_EVENT "' + ("SAVED" if accepted else "PENDING") + '"', flush=True)
except Exception:
    print('SET VARIABLE SHAHVEX_HANDOFF_EVENT "PENDING"', flush=True)
