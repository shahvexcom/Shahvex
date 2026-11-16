"""Provision separate Emma/Olivia references without modifying Lissa or restarting services."""
import argparse
import ast
import hashlib
import json
import shutil
import wave
from pathlib import Path


def provision(prepared, backend):
    source = backend / 'gateway/services/cosyvoice_api.py'
    original = source.read_text()
    marker = 'VOICE_NAMES = {\n'
    if original.count(marker) != 1:
        raise ValueError('Unexpected catalog; no changes made')
    names = next(ast.literal_eval(node.value) for node in ast.parse(original).body
                 if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'VOICE_NAMES' for t in node.targets))
    protected = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in (backend / 'gateway/voices/lissa').glob('*') if p.is_file()}
    entries = []
    for voice, display in [('emma', 'Emma'), ('olivia', 'Olivia')]:
        reference = prepared / voice / 'reference.wav'
        metadata = json.loads((prepared / voice / 'metadata.json').read_text())
        with wave.open(str(reference)) as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 16000 or not 1 <= wav.getnframes() / wav.getframerate() <= 30:
                raise ValueError(f'Invalid reference: {voice}')
        if not metadata.get('reference_transcript', '').strip() or hashlib.sha256(reference.read_bytes()).hexdigest() != metadata['reference_sha256']:
            raise ValueError(f'Invalid reference metadata: {voice}')
        expected = (display, 'female', voice)
        if voice in names and names[voice] != expected:
            raise ValueError(f'Existing voice ID differs: {voice}')
        target = backend / 'gateway/voices' / voice
        for filename in ('reference.wav', 'metadata.json'):
            if (target / filename).exists() and (target / filename).read_bytes() != (prepared / voice / filename).read_bytes():
                raise ValueError(f'Existing {voice} differs; refusing to overwrite')
        if voice not in names:
            entries.append(f'    "{voice}": ("{display}", "female", "{voice}"),\n')
    updated = original.replace(marker, marker + ''.join(entries), 1)
    ast.parse(updated)
    backup = prepared / 'cosyvoice_api.before-emma-olivia.py'
    if not backup.exists():
        backup.write_text(original)
    for voice in ('emma', 'olivia'):
        target = backend / 'gateway/voices' / voice
        target.mkdir(parents=True, exist_ok=True)
        for filename in ('reference.wav', 'metadata.json'):
            if not (target / filename).exists():
                shutil.copyfile(prepared / voice / filename, target / filename)
    if updated != original:
        source.write_text(updated)
    if any(hashlib.sha256(path.read_bytes()).hexdigest() != checksum for path, checksum in protected.items()):
        raise RuntimeError('Lissa protection check failed')
    return {'voices': ['emma', 'olivia'], 'lissa_unchanged': True, 'catalog_updated': updated != original,
            'service_restarted': False, 'activation': 'Next normal service start; live synthesis not verified'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepared', type=Path, default=Path(__file__).resolve().parents[1] / '.data/voice-clones-emma-olivia')
    parser.add_argument('--backend-root', type=Path, default=Path.home() / 'shahvex-ai')
    args = parser.parse_args()
    print(json.dumps(provision(args.prepared, args.backend_root)))
