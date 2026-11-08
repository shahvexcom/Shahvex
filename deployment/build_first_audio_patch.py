from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
physical = Path('C:/Shahvex-AI/integration-gateway')
payload = {}
manifest = []
for name in ['services.cjs', 'text-chunks.cjs']:
    data = (root / 'gateway' / name).read_bytes()
    payload[name] = data
    manifest.append({'path': name, 'sha256': hashlib.sha256(data).hexdigest().upper(),
                     'originalSHA256': hashlib.sha256((physical / name).read_bytes()).hexdigest().upper()})
payload['SHA256SUMS.json'] = json.dumps(manifest, indent=2).encode()
payload['REVIEW.md'] = (root / 'docs/measured-first-audio-fix.md').read_bytes()
out = root / 'dist/Shahvex-First-Audio-Review-v1.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, data in payload.items():
        archive.writestr(name, data)
with zipfile.ZipFile(out) as archive:
    assert archive.testzip() is None
    for entry in manifest:
        assert hashlib.sha256(archive.read(entry['path'])).hexdigest().upper() == entry['sha256']
print(out)
print(hashlib.sha256(out.read_bytes()).hexdigest().upper())
