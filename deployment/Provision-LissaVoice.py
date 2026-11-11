"""Install the authorized Lissa reference; preserve other voices and source backup.

Run as the existing WSL service user. Does not restart services or label
an automatically transcribed reference as human-verified.
"""
import ast
import hashlib
import json
from pathlib import Path
import shutil
import wave

prepared = Path('/mnt/e/Shahvex/.data/voice-reference-whatsapp-20261111')
source = Path.home() / 'shahvex-ai/gateway/services/cosyvoice_api.py'
target = Path.home() / 'shahvex-ai/gateway/voices/lissa'
reference = prepared / 'lissa-reference.wav'
transcript = json.loads((prepared / 'reference-transcript.json').read_text())['text'].strip()
with wave.open(str(reference), 'rb') as wav:
    assert wav.getnchannels() == 1 and wav.getsampwidth() == 2
    assert 1 <= wav.getnframes() / wav.getframerate() <= 30
assert len(transcript) >= 10
original = source.read_text()
marker = 'VOICE_NAMES = {\n'
entry = '    "lissa": ("Lissa", "female", "lissa"),\n'
assert original.count(marker) == 1
updated = original if entry in original else original.replace(marker, marker + entry, 1)
ast.parse(updated)
if target.exists():
    assert (target / 'reference.wav').read_bytes() == reference.read_bytes(), 'Existing Lissa reference differs; not overwriting'
else:
    target.mkdir()
    shutil.copyfile(reference, target / 'reference.wav')
metadata = {
    'name': 'Lissa', 'gender': 'female', 'language': 'English', 'accent': 'American English',
    'reference_transcript': transcript,
    'reference_text_verified_by_human': False,
    'transcript_verification': 'Local STT of prepared reference, not a human listening attestation',
    'rights_verified': True,
    'rights_declaration': 'User states this is their own recorded voice and explicitly authorizes cloning and use.',
    'reference_sha256': hashlib.sha256(reference.read_bytes()).hexdigest(),
    'preparation': json.loads((prepared / 'preparation.json').read_text()),
}
(target / 'metadata.json').write_text(json.dumps(metadata, indent=2))
backup = prepared / 'cosyvoice_api.before-lissa.py'
if not backup.exists():
    backup.write_text(original)
if updated != original:
    source.write_text(updated)
print(json.dumps({'id': 'lissa', 'name': 'Lissa', 'source_updated': updated != original, 'reference_seconds': metadata['preparation']['referenceSeconds'], 'restart_required': True}))
