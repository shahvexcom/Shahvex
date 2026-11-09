"""Exercise recovery of the experimental gateway only, not GPU services."""
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import time

port = 8773
rows = subprocess.check_output(['ss', '-ltnp'], text=True)
row = next(line for line in rows.splitlines() if re.search(r'127\.0\.0\.1:8773\s', line))
pid = int(re.search(r'pid=(\d+)', row)[1])
command = (Path('/proc') / str(pid) / 'cmdline').read_bytes().split(b'\0')
if b'gateway.services.phrase_gateway_step90:app' not in command:
    raise SystemExit('Unexpected process; no process stopped')
os.kill(pid, signal.SIGTERM)
for attempt in range(60):
    time.sleep(1)
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=1):
            pass
        main = int(subprocess.check_output(['systemctl', 'show', 'shahvex-port-8773', '--property=MainPID', '--value'], text=True))
        if main != pid and main > 0 and b'gateway.services.phrase_gateway_step90:app' in (Path('/proc') / str(main) / 'cmdline').read_bytes().split(b'\0'):
            print('PASS experimental gateway automatically recovered under systemd; GPU services untouched')
            break
    except (OSError, ValueError):
        pass
else:
    raise SystemExit('Experimental gateway recovery was not confirmed')
