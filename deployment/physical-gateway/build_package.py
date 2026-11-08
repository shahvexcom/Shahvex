"""Allowlisted deterministic delivery; never includes local configs or environments."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'gateway'
SUPPORT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'dist' / 'Shahvex-Physical-Gateway-Deployment-v1.0.0.zip'
GATEWAY = ['server.cjs', 'core.cjs', 'audio-stream.cjs', 'services.cjs', 'wav.cjs',
           'backend-client.cjs', 'whisper_bridge.py', 'prepare_audio.py', 'e2e.cjs',
           'agent-e2e.example.json']
FILES = ['package.json', 'requirements.txt', 'Verify-Prerequisites.ps1', 'INSTALL-WINDOWS.md']


def build():
    payload = {name: (SOURCE / name).read_bytes() for name in GATEWAY}
    payload.update({name: (SUPPORT / name).read_bytes() for name in FILES})
    contract = json.loads((SOURCE / 'physical-engine.example.json').read_text())
    contract['stt'].pop('token', None)
    for voice in contract['voices']:
        voice['verified'] = False
    payload['physical-engine.example.json'] = (json.dumps(contract, indent=2) + '\n').encode()
    manifest = [{'path': name, 'sha256': hashlib.sha256(data).hexdigest().upper()}
                for name, data in sorted(payload.items())]
    payload['SHA256SUMS.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    OUTPUT.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(OUTPUT, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(payload.items()):
            assert '/' not in name and '\\' not in name and not name.startswith('.')
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 2, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    with zipfile.ZipFile(OUTPUT) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == set(payload)
        for entry in manifest:
            assert hashlib.sha256(archive.read(entry['path'])).hexdigest().upper() == entry['sha256']
        delivered = json.loads(archive.read('physical-engine.example.json'))
        assert 'token' not in delivered['stt'] and all(not v['verified'] for v in delivered['voices'])
        for name in archive.namelist():
            assert not name.startswith('.') and not name.endswith(('.env', '.pem', '.key'))
    digest = hashlib.sha256(OUTPUT.read_bytes()).hexdigest().upper()
    OUTPUT.with_suffix('.zip.sha256.txt').write_text(f'{digest}  {OUTPUT.name}\n', encoding='ascii')
    print(json.dumps({'zip': str(OUTPUT), 'files': len(payload), 'bytes': OUTPUT.stat().st_size,
                      'sha256': digest, 'verified_paths': sorted(payload)}, indent=2))


if __name__ == '__main__':
    build()
