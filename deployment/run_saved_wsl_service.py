"""Restore an exact recorded local service without duplicating its listener."""
import json
import os
from pathlib import Path
import socket
import sys
import time

config = json.loads(Path(sys.argv[1]).read_text())
port = config['port']
while True:
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=2):
            pass
    except OSError:
        break
    # Leave the currently working manual process alone; take over after exit.
    time.sleep(5)
os.chdir(config['cwd'])
os.execve(config['argv'][0], config['argv'], config['env'])
