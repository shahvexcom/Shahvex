import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).parents[1] / 'deployment'))
from tts_polling import configure_stream_polling

calls = []
time = SimpleNamespace(sleep=calls.append, monotonic=lambda: 123)


class Model:
    def tts(self, *, stream=False):
        if stream:
            time.sleep(0.1)
        time.sleep(0.2)
        yield time.monotonic()


class PollingTest(unittest.TestCase):
    def test_only_selected_instance_changes_and_generator_preserved(self):
        calls.clear()
        selected, other = Model(), Model()
        configure_stream_polling(selected)
        installed = selected.tts
        configure_stream_polling(selected)
        self.assertIs(installed, selected.tts)
        self.assertEqual(list(selected.tts(stream=True)), [123])
        self.assertEqual(calls, [0.01, 0.2])
        calls.clear()
        self.assertEqual(list(other.tts(stream=True)), [123])
        self.assertEqual(calls, [0.1, 0.2])
        self.assertIs(Model.tts.__globals__['time'], time)


if __name__ == '__main__':
    unittest.main()
