#!/usr/bin/env python3
"""Read-only build/worker verification; never prints credentials or process arguments."""
import json
import hashlib
import hmac
import time
import os
from pathlib import Path
import urllib.request

EXPECTED = 'REC413-source-v12'


def processes():
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            args = [x.decode(errors='replace') for x in (entry/'cmdline').read_bytes().split(b'\0') if x]
            if args:
                yield entry, args
        except (OSError, ValueError):
            continue


def main():
    print('Expected revision:', EXPECTED)
    found = False
    for proc, args in processes():
        if any(arg.endswith('/gateway/tester-service.cjs') for arg in args):
            found = True
            print('Tester PID:', proc.name)
            try:
                entries = (proc/'environ').read_bytes().split(b'\0')
                env = dict(x.decode().split('=', 1) for x in entries if b'=' in x)
                port = int(env.get('SHAHVEX_PC_TESTER_PORT', '8774'))
                req = urllib.request.Request('http://127.0.0.1:'+str(port)+'/internal/status', headers={'x-shahvex-ai-key': env.get('SHAHVEX_PC_AI_SECRET', '')})
                with urllib.request.urlopen(req, timeout=5) as response:
                    revision = json.load(response).get('flowRevision', 'MISSING')
                print('Running tester revision:', revision)
                print('Tester matches:', revision == EXPECTED)
            except Exception as error:
                print('Tester check failed:', type(error).__name__)
        if args[0].startswith('next-server') or any(arg.endswith('/next/dist/bin/next') for arg in args):
            print('Website PID:', proc.name)
            try:
                root = (proc/'cwd').resolve()
                print('Website directory:', root)
                server = root/'.next/server'
                needle = EXPECTED.encode()
                matched = any(needle in file.read_bytes() for file in server.rglob('*.js')) if server.is_dir() else False
                print('Website build contains expected revision:', matched)
                if not matched:
                    print('Rebuild this website project, then restart its existing launcher.')
            except OSError:
                print('Website build could not be inspected.')
        if any(arg.endswith('/tools/native-campaign-bridge.cjs') for arg in args):
            print('Campaign bridge PID:', proc.name)
            try:
                config = json.loads(Path(args[-1]).read_text())
                key = config.get('secret', '')
                port = int(config.get('controlPort', 8790))
                if not isinstance(key, str) or len(key) < 32:
                    raise ValueError('Protected control settings not in this config')
                stamp = str(int(time.time() * 1000))
                signature = hmac.new(key.encode(), (stamp+chr(10)+'GET'+chr(10)+'/health'+chr(10)).encode(), hashlib.sha256).hexdigest()
                req = urllib.request.Request('http://127.0.0.1:'+str(port)+'/health', headers={'x-shahvex-timestamp':stamp,'x-shahvex-signature':signature})
                with urllib.request.urlopen(req,timeout=5) as response:
                    health=json.load(response)
                print('Running bridge revision:',health.get('flowRevision','MISSING'))
                print('Semantic turn completion:',health.get('semanticTurnCompletion',False))
                print('Candidate pause ms:',health.get('candidatePauseMs','MISSING'))
                for report in health.get('recentSpeech',[]):
                    print('Recent speech report:',json.dumps(report))
                for stream in health.get('streams',[]):
                    print('Active call worker revision:',stream.get('voiceFlowRevision','MISSING'))
                    print('Speech probe failures / original-path fallbacks:',stream.get('speechProbeFailures',0),stream.get('speechFallbacks',0))
                    print('Last speech probe issue:',stream.get('lastSpeechIssue'))
            except Exception as error:
                print('Protected bridge check unavailable:',type(error).__name__)
                print('Use existing bridge log to verify Active call voice flow revision during a call.')
    if not found:
        print('No readable tester process found; run as its owning user.')
    print('Tester/build checks do not prove which worker handled a call.')
    print('During a fresh call, bridge health active voice revision must match, or check the bridge log: Active call voice flow revision.')
    print('An existing configuration/startup launcher is preserved; this check restarts nothing.')


if __name__ == '__main__':
    main()
