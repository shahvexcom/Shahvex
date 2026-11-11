"""Temporary idle-engine maintenance; always restart the exact TTS service."""
import os
import subprocess
from pathlib import Path

if os.environ.get('SHAHVEX_IDLE_TRT_BUILD') != '1' or os.geteuid() != 0:
    raise SystemExit('Explicit idle maintenance authorization and WSL root required')
unit = 'shahvex-port-8767.service'
root = Path('/mnt/e/Shahvex')
log = root / '.data/lissa-trt-idle-build.log'
subprocess.run(['systemctl', 'is-active', '--quiet', unit], check=True)
try:
    subprocess.run(['systemctl', 'stop', unit], check=True)
    print('Idle cloning engine stopped for bounded standalone build', flush=True)
    with log.open('w') as out:
        result = subprocess.run([
            'runuser', '-u', 'nazeer_ahmed', '--', 'env',
            'SHAHVEX_LOCAL_TTS_COMPARE=1', 'SHAHVEX_TRT_RSS_LIMIT_MB=10000',
            '/home/nazeer_ahmed/miniconda3/envs/cosyvoice/bin/python',
            str(root / 'deployment/lissa_trt_build_review.py'),
        ], stdout=out, stderr=subprocess.STDOUT, timeout=600)
    print('Standalone build exit code:', result.returncode, flush=True)
finally:
    subprocess.run(['systemctl', 'start', unit], check=True)
    print('Cloning service restarted; readiness must be verified', flush=True)
