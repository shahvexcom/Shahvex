"""Install the approved fast voice alongside, without stopping existing AI engines."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
python = root / '.data/pc-ai/fast-tts-env/bin/python'
if not python.exists():
    raise SystemExit('Prepared fast voice environment is missing')
unit = f'''[Unit]
Description=Shahvex approved fast voice on loopback 8778
After=network.target
StartLimitIntervalSec=0

[Service]
User=nazeer_ahmed
WorkingDirectory={root}/deployment
Environment=HF_HUB_OFFLINE=1
ExecStart={python} -m uvicorn local_kokoro_api:app --host 127.0.0.1 --port 8778 --workers 1 --no-access-log
Restart=always
RestartSec=5
TimeoutStopSec=20
UMask=0077

[Install]
WantedBy=multi-user.target
'''
target = Path('/etc/systemd/system/shahvex-fast-voice.service')
if target.exists() and target.read_text() != unit:
    raise SystemExit('Existing differing fast voice unit needs review')
target.write_text(unit)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', '--now', 'shahvex-fast-voice.service'], check=True)
print('Enabled approved fast voice recovery on port 8778')
