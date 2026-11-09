"""Run with Ubuntu's existing Python. Restart only the verified CosyVoice PID.

Usage: python Apply-CosyVoiceWrapper.py PID [--rollback]
Original launch command is saved without environment secrets for rollback.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

pid = int(sys.argv[1])
proc = Path('/proc') / str(pid)
argv = [part.decode() for part in (proc / 'cmdline').read_bytes().split(b'\0') if part]
if '--port' not in argv or argv[argv.index('--port') + 1] != '8767':
    raise SystemExit('Unexpected port; no process stopped')
module = next((arg for arg in argv if arg in ('gateway.services.cosyvoice_api:app', 'cosyvoice_safe_api:app')), None)
if module is None:
    raise SystemExit('Unexpected service; no process stopped')
cwd = os.readlink(proc / 'cwd')
env = dict(part.decode().split('=', 1) for part in (proc / 'environ').read_bytes().split(b'\0') if b'=' in part)
private = Path('/mnt/e/Shahvex/.data/pc-ai')
record = private / 'cosyvoice-original-launch.json'
if '--rollback' in sys.argv:
    original = json.loads(record.read_text())
    launch, cwd = original['argv'], original['cwd']
else:
    if module != 'gateway.services.cosyvoice_api:app' and '--restart-wrapper' not in sys.argv:
        raise SystemExit('Wrapper already running; no process stopped')
    if not record.exists():
        record.write_text(json.dumps({'argv': argv, 'cwd': cwd}, indent=2))
    launch = [arg if arg != module else 'cosyvoice_safe_api:app' for arg in argv]
    if '--app-dir' not in launch:
        launch += ['--app-dir', '/mnt/e/Shahvex/deployment']
os.kill(pid, signal.SIGTERM)
for _ in range(150):
    if not proc.exists():
        break
    time.sleep(0.1)
if proc.exists():
    # The confirmed lock-stalled service cannot finish graceful shutdown.
    os.kill(pid, signal.SIGKILL)
    for _ in range(50):
        if not proc.exists():
            break
        time.sleep(0.1)
if proc.exists():
    raise SystemExit('Old process still exists; replacement not started')
with (private / 'cosyvoice-wrapper.log').open('ab') as log:
    child = subprocess.Popen(launch, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
(private / 'cosyvoice-process.json').write_text(json.dumps({'pid': child.pid, 'wrapper': '--rollback' not in sys.argv}))
print('Verified CosyVoice process replaced; loading same existing model. PID:', child.pid)
