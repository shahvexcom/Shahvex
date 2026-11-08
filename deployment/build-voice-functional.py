"""Build reviewed three-file package; reads physical originals but never changes them."""
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sha = lambda data: hashlib.sha256(data).hexdigest().upper()
files = [
    ('gateway/audio-stream.cjs', ROOT/'gateway/audio-stream.cjs', Path(r'C:\Shahvex-AI\integration-gateway\audio-stream.cjs'), '4838FD94D77C6EB8A8C6EADEE156EEE6B314FF7DFB715521D037C9DDEA5E67C7'),
    ('gateway/services.cjs', ROOT/'gateway/services.cjs', Path(r'C:\Shahvex-AI\integration-gateway\services.cjs'), '3CC7695921751ADF311AACA68A53CE249AADE20B3D8B3D59A06F938D308DC265'),
    ('optional-chatterbox/chatterbox_voice_server.py', ROOT/'gateway/reviewed-chatterbox/chatterbox_voice_server.py', Path(r'C:\Shahvex-AI\chatterbox-testing\chatterbox_voice_server.py'), 'F43E647D0B32C88D45E61E6A9E46CF9F407281E027D11EE0D0A894758D85A234'),
]
payload, manifest = {}, []
for name, source, deployed, original in files:
    if sha(deployed.read_bytes()) != original:
        raise SystemExit('Deployed original changed: ' + name)
    payload[name] = source.read_bytes()
    manifest.append(dict(path=name, sha256=sha(payload[name]), originalSHA256=original))
dependency = '4C6B08C47BC643C6A81BC48EB30AD7389722A3D620DDD78E1E7AAB31EBCDD34B'
if sha(Path(r'C:\Shahvex-AI\integration-gateway\text-chunks.cjs').read_bytes()) != dependency:
    raise SystemExit('Deployed FirstAudio helper changed')
payload['DEPENDENCIES.json'] = json.dumps(dict(firstAudioTextChunksSHA256=dependency), indent=2).encode()
payload['REVIEW.md'] = (ROOT/'docs/voice-functional-corrections-review.md').read_bytes()
for name in ('DEPENDENCIES.json','REVIEW.md'):
    manifest.append(dict(path=name, sha256=sha(payload[name])))
payload['SHA256SUMS.json'] = json.dumps(manifest, indent=2).encode()
output = ROOT/'dist/Shahvex-Voice-Functional-Review-v1.zip'
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as package:
    for name in sorted(payload):
        info = zipfile.ZipInfo(name, date_time=(2026,11,2,0,0,0))
        info.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(info, payload[name])
with zipfile.ZipFile(output) as package:
    if sorted(package.namelist()) != sorted(payload) or package.testzip():
        raise SystemExit('Archive validation failed')
    for entry in manifest:
        if sha(package.read(entry['path'])) != entry['sha256']:
            raise SystemExit('Archive payload hash mismatch')
print(output)
print(sha(output.read_bytes()))
print(json.dumps(manifest, indent=2))
