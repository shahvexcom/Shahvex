import sys
import time
import threading
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / 'deployment'))
from tts_native_lifecycle import configure_native_lifecycle, cancellation_scope


class LLM:
    broken = False
    def inference(self):
        for token in range(60):
            if self.broken:
                raise ValueError('token worker failed')
            time.sleep(.001)
            yield token


class Native:
    def __init__(self):
        self.llm = LLM()
        self.lock = threading.Lock()
        self.tts_speech_token_dict = {}
        self.llm_end_dict = {}
        self.hift_cache_dict = {}
        self.decodes = 0
    def llm_job(self, uuid):
        for token in self.llm.inference():
            self.tts_speech_token_dict[uuid].append(token)
        self.llm_end_dict[uuid] = True
    def token2wav(self, *, uuid):
        self.decodes += 1
        return tuple(self.tts_speech_token_dict[uuid])
    def tts(self):
        uuid = 'fixture'
        self.tts_speech_token_dict[uuid] = []
        self.llm_end_dict[uuid] = False
        self.hift_cache_dict[uuid] = None
        thread = threading.Thread(target=self.llm_job, args=(uuid,))
        thread.start()
        while not self.llm_end_dict[uuid]:
            time.sleep(.001)
        thread.join()
        yield self.token2wav(uuid=uuid)
        self.tts_speech_token_dict.pop(uuid)
        self.llm_end_dict.pop(uuid)
        self.hift_cache_dict.pop(uuid)


class LifecycleTest(unittest.TestCase):
    def test_normal_tokens_unchanged_and_install_idempotent(self):
        original, patched = Native(), Native()
        configure_native_lifecycle(patched)
        installed = patched.tts
        configure_native_lifecycle(patched)
        self.assertIs(installed, patched.tts)
        self.assertEqual(list(original.tts()), list(patched.tts()))
        self.assertEqual(patched.tts_speech_token_dict, {})

    def test_token_thread_exception_releases_stream_and_next_turn(self):
        native = Native()
        configure_native_lifecycle(native)
        native.llm.broken = True
        with self.assertRaisesRegex(RuntimeError, 'token generation failed'):
            list(native.tts())
        self.assertEqual(native.tts_speech_token_dict, {})
        self.assertEqual(native.llm_end_dict, {})
        self.assertEqual(native.hift_cache_dict, {})
        native.llm.broken = False
        self.assertEqual(list(native.tts())[0], tuple(range(60)))

    def test_cancelled_token_generation_stops_and_scope_restores(self):
        native = Native()
        configure_native_lifecycle(native)
        stopped = threading.Event()
        with cancellation_scope(native, stopped):
            tokens = native.llm.inference()
            self.assertEqual(next(tokens), 0)
            stopped.set()
            self.assertEqual(list(tokens), [])
        self.assertIsNone(native._shahvex_cancel)
        self.assertEqual(list(native.llm.inference()), list(range(60)))

    def test_decoder_error_waits_for_token_thread_before_cleanup(self):
        native = Native()
        def broken_decode(**kwargs):
            raise ValueError('decode failed')
        native.token2wav = broken_decode
        configure_native_lifecycle(native)
        with self.assertRaisesRegex(ValueError, 'decode failed'):
            list(native.tts())
        self.assertEqual(native.tts_speech_token_dict, {})
        self.assertIsNone(native._shahvex_cancel)


if __name__ == '__main__':
    unittest.main()
