"""Create reviewed optional replacements; never write to the physical engine."""
from pathlib import Path
import hashlib
import json
import zipfile
import sys

root = Path(__file__).resolve().parents[1]
engine = Path('C:/Shahvex-AI')
source = engine / 'chatterbox-testing/chatterbox_voice_server.py'
original = source.read_text(encoding='utf-8-sig')
old = '''    def send_data(self, code, content_type, data):
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Caller interrupted; inference may already have completed.
'''
new = '''    def send_data(self, code, content_type, data):
        # A response attempt may fail at headers, body or final flush. Never
        # attempt a second status line on the same aborted connection.
        if getattr(self, '_response_started', False):
            return
        self._response_started = True
        try:
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except OSError as error:
            if getattr(error, 'winerror', None) not in (10053, 10054):
                raise
            self.close_connection = True

    def finish(self):
        try:
            super().finish()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
'''
assert old in original, 'Physical source changed; review before generating a patch'
patched = original.replace(old, new, 1)
studio = '--studio' in sys.argv
endpoint = '--endpoint' in sys.argv
capture = '--capture' in sys.argv
out = root / ('dist/Shahvex-Timing-Capture-Review-v1.zip' if capture else 'dist/Shahvex-Endpoint-Timing-Review-v1.zip' if endpoint else 'dist/Shahvex-Studio-Review-v1.zip' if studio else 'dist/Shahvex-Multiturn-Review-v1.zip')
payload = {}
manifest = []
for name in ['core.cjs', 'audio-stream.cjs', 'services.cjs', 'text-chunks.cjs'] + (['server.cjs','telemetry.cjs'] if endpoint or capture else []):
    data = (root / 'gateway' / name).read_bytes()
    path = 'gateway/' + name
    payload[path] = data
    deployed = engine / 'integration-gateway' / name
    manifest.append({'path': path, 'sha256': hashlib.sha256(data).hexdigest().upper(),
                     'originalSHA256': hashlib.sha256(deployed.read_bytes()).hexdigest().upper() if deployed.exists() else None})
path = 'optional-chatterbox/chatterbox_voice_server.py'
payload[path] = patched.encode('utf-8')
manifest.append({'path': path, 'sha256': hashlib.sha256(payload[path]).hexdigest().upper(),
                 'originalSHA256': hashlib.sha256(source.read_bytes()).hexdigest().upper()})
payload['SHA256SUMS.json'] = json.dumps(manifest, indent=2).encode()
payload['REVIEW.md'] = (root / ('docs/recording-discovery-and-capture.md' if capture else 'docs/endpoint-recording-review.md' if endpoint else 'docs/studio-upgrade-review.md' if studio else 'docs/multiturn-physical-review.md')).read_bytes()
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path, data in payload.items():
        archive.writestr(path, data)
with zipfile.ZipFile(out) as archive:
    assert archive.testzip() is None
    for entry in manifest:
        assert hashlib.sha256(archive.read(entry['path'])).hexdigest().upper() == entry['sha256']
print(out)
print('SHA256', hashlib.sha256(out.read_bytes()).hexdigest().upper())
