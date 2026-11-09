"""Exercise the saved-command runner against a disposable listener, no AI."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

runner = Path('deployment/run_saved_wsl_service.py').resolve()
with tempfile.TemporaryDirectory(dir='.data/pc-ai') as folder:
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    listener.listen()
    port = listener.getsockname()[1]
    config = Path(folder) / 'fixture.json'
    config.write_text(json.dumps({'port': port, 'cwd': str(Path(folder).resolve()), 'argv': [sys.executable, '-c', 'print("restored-exact-command")'], 'env': {'PATH': os.environ.get('PATH', '')}}))
    child = subprocess.Popen([sys.executable, str(runner), str(config)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        time.sleep(0.3)
        assert child.poll() is None, 'Must not duplicate occupied listener'
        listener.close()
        stdout, stderr = child.communicate(timeout=10)
        assert child.returncode == 0, stderr
        assert stdout.strip() == 'restored-exact-command'
    finally:
        listener.close()
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=5)
print('PASS occupied port preserved; exact command restored after listener exits')
