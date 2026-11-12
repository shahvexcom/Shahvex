#!/usr/bin/env python3
"""Asterisk AGI: register the real VICIdial caller-code, then set AudioSocket UUID."""
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
import uuid

env = {}
for line in sys.stdin:
    if not line.strip():
        break
    name, _, value = line.partition(":")
    env[name] = value.strip()

def agi(command):
    """Keep AGI commands synchronized with Asterisk's responses."""
    print(command, flush=True)
    return sys.stdin.readline()


class RegistrationError(Exception):
    """Only fixed, credential-free diagnostics may be passed to this class."""


try:
    manual_test = '--manual-test' in sys.argv[2:]
    # Pass the dedicated Remote Agent user as AGI argument 1 from its extension.
    agent_user = sys.argv[1] if len(sys.argv) > 1 else ""
    if not re.fullmatch(r"[\w-]{2,20}", agent_user, flags=re.ASCII):
        raise RegistrationError("Missing or invalid dedicated Remote Agent user argument")
    external_call_id = env.get("agi_calleridname", "")
    if not manual_test and not re.fullmatch(r"[\w-]{16,40}", external_call_id, flags=re.ASCII):
        raise RegistrationError("Invalid VICIdial caller-code in CallerID name; use an answered campaign call, not a manually dialed phone extension")
    stream_id = str(uuid.uuid4())
    if manual_test:
        if agent_user != 'manual-test':
            raise RegistrationError('Manual tests must use the isolated manual-test profile')
        external_call_id = 'manual-' + stream_id.replace('-', '')
    body = json.dumps({"uuid": stream_id, "externalCallId": external_call_id, "agentUser": agent_user, "asteriskUniqueid": env.get("agi_uniqueid", ""), "asteriskLinkedid": env.get("agi_linkedid", ""), **({"manualTest": True} if manual_test else {})}, separators=(",", ":")).encode()
    stamp = str(int(time.time() * 1000))
    # Root/asterisk-readable JSON file, chmod 0640; never put the secret in dialplan args.
    config_path = os.environ.get('SHAHVEX_VICIDIAL_MANUAL_CONFIG', '/etc/shahvex-vicidial-manual.json') if manual_test else os.environ.get('SHAHVEX_VICIDIAL_CONFIG', '/etc/shahvex-vicidial.json')
    with open(config_path) as config_file:
        config = json.load(config_file)
    if not isinstance(config, dict) or not isinstance(config.get("secret"), str) or len(config["secret"]) < 32:
        raise RegistrationError("Bridge configuration needs the matching shared secret of at least 32 characters")
    if manual_test and config.get('enabled') is not True:
        raise RegistrationError('Manual audio testing is disabled in the isolated config')
    sig = hmac.new(config["secret"].encode(), (stamp + "\nPOST\n/register\n").encode() + body, hashlib.sha256).hexdigest()
    control_url = config.get("controlUrl", "http://127.0.0.1:8792" if manual_test else "http://127.0.0.1:8790")
    if not isinstance(control_url, str) or not control_url.startswith(("http://", "https://")):
        raise RegistrationError("Bridge controlUrl must be a reachable HTTP or HTTPS control endpoint")
    if manual_test:
        health_sig = hmac.new(config['secret'].encode(), (stamp + '\nGET\n/health\n').encode(), hashlib.sha256).hexdigest()
        health = urllib.request.Request(control_url.rstrip('/') + '/health', headers={'x-shahvex-timestamp': stamp, 'x-shahvex-signature': health_sig})
        with urllib.request.urlopen(health, timeout=10) as response:
            if json.load(response).get('testOnly') is not True:
                raise RegistrationError('Manual tests require the isolated manual bridge, not the production bridge')
    request = urllib.request.Request(control_url.rstrip("/") + "/register", data=body, headers={"Content-Type": "application/json", "x-shahvex-timestamp": stamp, "x-shahvex-signature": sig})
    with urllib.request.urlopen(request, timeout=15) as response:
        if not json.load(response).get("accepted"):
            raise RegistrationError("Bridge did not accept the registration")
    agi('SET VARIABLE SHAHVEX_AUDIO_UUID "' + stream_id + '"')
except Exception as error:
    if isinstance(error, RegistrationError):
        reason = str(error)
    elif isinstance(error, FileNotFoundError):
        reason = "Bridge config file missing; install the appropriate production or manual bridge JSON config"
    elif isinstance(error, PermissionError):
        reason = "Asterisk cannot read the bridge config file; check file ownership and permissions"
    elif isinstance(error, urllib.error.HTTPError):
        reason = {
            401: "Bridge authentication rejected; check matching shared secret and server clocks",
            409: "Bridge line not prepared; start this assigned AI campaign on the website before testing",
            429: "Audio bridge registration capacity reached",
        }.get(error.code, "Bridge HTTP registration request failed; inspect the bridge service logs")
    elif isinstance(error, (urllib.error.URLError, TimeoutError, ConnectionError)):
        reason = "Cannot reach bridge control endpoint; check bridge service, controlUrl and network access"
    elif isinstance(error, json.JSONDecodeError):
        reason = "Invalid JSON in bridge configuration or registration response"
    else:
        reason = "Registration failed; verify AGI installation and bridge configuration"
    # Never print raw exception text: URLs and HTTP errors can contain credentials.
    agi('VERBOSE "Shahvex registration failed: ' + reason + '" 1')
    agi('SET VARIABLE SHAHVEX_AUDIO_UUID ""')
