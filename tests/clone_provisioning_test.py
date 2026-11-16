import importlib.util
import json
import tempfile
import unittest
import wave
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('clone_provision', ROOT / 'deployment/Provision-EmmaOlivia.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.backend = self.root / 'backend'
        self.prepared = self.root / 'prepared'
        services = self.backend / 'gateway/services'
        services.mkdir(parents=True)
        self.source = services / 'cosyvoice_api.py'
        self.original = 'MODEL_SETTINGS = {"speed": 1}\nVOICE_NAMES = {\n    "lissa": ("Lissa", "female", "lissa"),\n}\n'
        self.source.write_text(self.original)
        lissa = self.backend / 'gateway/voices/lissa'
        lissa.mkdir(parents=True)
        (lissa / 'reference.wav').write_bytes(b'protected reference')
        (lissa / 'metadata.json').write_bytes(b'protected metadata')
        for voice in ('emma', 'olivia'):
            folder = self.prepared / voice
            folder.mkdir(parents=True)
            ref = folder / 'reference.wav'
            with wave.open(str(ref), 'wb') as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16000)
                wav.writeframes(b'\0\0' * 16000)
            (folder / 'metadata.json').write_text(json.dumps({'reference_transcript': 'Reference speech for a fixture.', 'reference_sha256': hashlib.sha256(ref.read_bytes()).hexdigest()}))

    def test_preserves_lissa_and_model_settings_and_is_idempotent(self):
        result = module.provision(self.prepared, self.backend)
        self.assertTrue(result['lissa_unchanged'])
        self.assertFalse(result['service_restarted'])
        once = self.source.read_bytes()
        self.assertIn(b'MODEL_SETTINGS = {"speed": 1}', once)
        self.assertIn(b'"lissa": ("Lissa", "female", "lissa"),', once)
        self.assertEqual((self.backend / 'gateway/voices/lissa/reference.wav').read_bytes(), b'protected reference')
        self.assertFalse(module.provision(self.prepared, self.backend)['catalog_updated'])
        self.assertEqual(self.source.read_bytes(), once)

    def test_conflicting_voice_reference_is_not_overwritten(self):
        existing = self.backend / 'gateway/voices/emma'
        existing.mkdir()
        (existing / 'reference.wav').write_bytes(b'another reference')
        with self.assertRaisesRegex(ValueError, 'refusing to overwrite'):
            module.provision(self.prepared, self.backend)
        self.assertEqual(self.source.read_text(), self.original)
        self.assertEqual((existing / 'reference.wav').read_bytes(), b'another reference')
        self.assertFalse((self.backend / 'gateway/voices/olivia').exists())


if __name__ == '__main__':
    unittest.main()
