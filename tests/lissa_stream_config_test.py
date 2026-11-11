import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).parents[1] / 'deployment'))
from lissa_stream_config import lissa_stream_config


class Decoder:
    def forward(self, *, n_timesteps):
        return n_timesteps


class SettingsTest(unittest.TestCase):
    def test_restore_after_failure_and_other_voice(self):
        decoder = Decoder()
        native = SimpleNamespace(token_hop_len=100, flow=SimpleNamespace(decoder=decoder))
        with self.assertRaises(RuntimeError):
            with lissa_stream_config(native, True):
                self.assertEqual(native.token_hop_len, 20)
                self.assertEqual(decoder.forward(n_timesteps=10), 5)
                raise RuntimeError('cancel or synthesis failure')
        self.assertEqual(native.token_hop_len, 100)
        self.assertNotIn('forward', decoder.__dict__)
        with lissa_stream_config(native, False):
            self.assertEqual(native.token_hop_len, 25)
            self.assertEqual(decoder.forward(n_timesteps=10), 10)


if __name__ == '__main__':
    unittest.main()
