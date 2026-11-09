"""Run as WSL root; capture private environments and enable recovery units."""
import json
import os
from pathlib import Path
import pwd
import re
import subprocess

account = pwd.getpwnam('nazeer_ahmed')
store = Path(account.pw_dir) / '.config/shahvex-autostart'
store.mkdir(parents=True, exist_ok=True)
os.chmod(store, 0o700)
os.chown(store, account.pw_uid, account.pw_gid)
listeners = subprocess.check_output(['ss', '-ltnp'], text=True)
ports = list(range(8766, 8774))
units = []
for port in ports:
    rows = [line for line in listeners.splitlines() if re.search(rf'127\.0\.0\.1:{port}\s', line)]
    if len(rows) != 1:
        raise SystemExit(f'Expected one existing listener on {port}; no guessed command installed')
    match = re.search(r'pid=(\d+)', rows[0])
    if not match:
        raise SystemExit(f'Cannot identify listener on {port}')
    proc = Path('/proc') / match[1]
    argv = [p.decode() for p in (proc / 'cmdline').read_bytes().split(b'\0') if p]
    if '--port' not in argv or argv[argv.index('--port') + 1] != str(port) or 'uvicorn' not in ' '.join(argv):
        raise SystemExit(f'Unexpected process on {port}')
    if port == 8767 and 'cosyvoice_safe_api:app' not in argv:
        raise SystemExit('Refusing to replace the approved cancellation-safe TTS wrapper')
    env = dict(p.decode().split('=', 1) for p in (proc / 'environ').read_bytes().split(b'\0') if b'=' in p)
    for name in ('WSL_INTEROP', 'DBUS_SESSION_BUS_ADDRESS', 'DISPLAY', 'WAYLAND_DISPLAY'):
        env.pop(name, None)
    config = store / f'port-{port}.json'
    config.write_text(json.dumps({'port': port, 'argv': argv, 'cwd': os.readlink(proc / 'cwd'), 'env': env}))
    os.chmod(config, 0o600)
    os.chown(config, account.pw_uid, account.pw_gid)
    name = f'shahvex-port-{port}.service'
    target = Path('/etc/systemd/system') / name
    unit = f'''[Unit]
Description=Shahvex existing AI service on loopback {port}
After=network.target ollama.service
StartLimitIntervalSec=0

[Service]
Type=simple
User={account.pw_name}
ExecStart=/usr/bin/python3 /mnt/e/Shahvex/deployment/run_saved_wsl_service.py {config}
Restart=always
RestartSec=5
TimeoutStopSec=20
KillMode=control-group
UMask=0077

[Install]
WantedBy=multi-user.target
'''
    if target.exists() and target.read_text() != unit:
        raise SystemExit(f'Existing differing unit {name}; review required')
    target.write_text(unit)
    units.append(name)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', '--now', *units], check=True)
subprocess.run(['systemctl', 'enable', 'ollama.service'], check=True)
print('Enabled recovery for ports:', ', '.join(map(str, ports)))
print('Current manual listeners preserved; units monitor them and take over after exit.')
