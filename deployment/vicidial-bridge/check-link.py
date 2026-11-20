#!/usr/bin/env python3
"""Read-only, authenticated local bridge diagnostics. Credentials stay private."""
import hashlib
import hmac
import json
import sys
import time
import urllib.request
from urllib.parse import urlsplit


def main():
    config_path = sys.argv[1] if len(sys.argv) > 1 else '/etc/shahvex-vicidial.json'
    try:
        with open(config_path) as source:
            config = json.load(source)
        secret = config['secret']
        base = config.get('controlUrl', 'http://127.0.0.1:8790').rstrip('/')
        parsed = urlsplit(base)
        if parsed.username or parsed.password or parsed.scheme not in ('http', 'https'):
            raise ValueError('Invalid endpoint')
        stamp = str(int(time.time() * 1000))
        signature = hmac.new(secret.encode(), (stamp + '\nGET\n/health\n').encode(), hashlib.sha256).hexdigest()
        request = urllib.request.Request(base + '/health', headers={
            'x-shahvex-timestamp': stamp,
            'x-shahvex-signature': signature,
        })
        with urllib.request.urlopen(request, timeout=10) as response:
            health = json.load(response)
    except Exception:
        print('Bridge health could not be verified. Check the config path, service, shared secret, clocks and control endpoint.')
        return 1
    if health.get('testOnly'):
        print('This is the isolated manual test bridge. Campaign calls require the production bridge.')
        return 1
    print('Authenticated production bridge responded.')
    print('Conversation revision:', health.get('flowRevision', 'missing: update/restart bridge'))
    print('AudioSocket listener ready:', bool(health.get('audioSocket')))
    print('Active calls:', health.get('activeCalls', 0))
    print('Pending startup calls:', health.get('startingCalls', 0))
    for stream in health.get('streams', []):
        print('Audio line', stream.get('prefix'),
              '| call', stream.get('callId'),
              '| active voice revision', stream.get('voiceFlowRevision', 'missing'),
              '| input bytes', stream.get('inputPcmBytes', 0),
              '| output bytes', stream.get('outputPcmBytes', 0))
    print('During a real test call, the intended prefix should appear and both byte counters should increase.')
    print('Health alone does not verify carrier routing or the human transfer destination.')
    return 0 if health.get('audioSocket') else 1


if __name__ == '__main__':
    sys.exit(main())
