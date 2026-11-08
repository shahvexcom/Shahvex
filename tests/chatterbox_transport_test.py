"""Isolated real HTTP tests; compile Handler only, never import/load voice models."""
import ast
import contextlib
import http.server
import io
import json
import threading
import time
import types
import unittest
import urllib.error
import urllib.request
import wave
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'gateway/reviewed-chatterbox/chatterbox_voice_server.py'

def handler_from(source, **values):
    tree = ast.parse(source)
    handler = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Handler')
    namespace = dict(BaseHTTPRequestHandler=http.server.BaseHTTPRequestHandler,
                     json=json, time=time, uuid4=uuid4, **values)
    exec(compile(ast.fix_missing_locations(ast.Module(body=[handler], type_ignores=[])), '<isolated-handler>', 'exec'), namespace)
    return namespace['Handler']

def partial_disconnect(handler, failure='body'):
    class BrokenSink:
        def write(self, _):
            if failure == 'body': raise ConnectionAbortedError(10053, 'simulated Windows disconnect')
        def flush(self):
            if failure == 'flush': raise ConnectionResetError(10054, 'simulated Windows disconnect')
    class Response:
        responses = 0
        wfile = BrokenSink()
        send_data = handler.send_data
        def send_response(self, _): self.responses += 1
        def send_header(self, *_): pass
        def end_headers(self):
            if failure == 'headers': raise ConnectionAbortedError(10053, 'simulated Windows disconnect')
    response = Response()
    try: response.send_data(200, 'audio/wav', b'x' * 2000000)
    except OSError:
        # The deployed outer do_POST catches this and tries to send JSON 500.
        try: response.send_data(500, 'application/json', b'error')
        except OSError: pass
    return response.responses

class Tests(unittest.TestCase):
    def test_reviewed_original_disconnect_path_reproduces_double_response(self):
        # The running deployment is patched now. Test the real pre-deploy backup,
        # never assume the current physical file is still the vulnerable original.
        original = Path(r'C:\Shahvex-AI\chatterbox-testing\backup-before-voice-streaming-v1\chatterbox_voice_server.py')
        if not original.exists(): self.skipTest('Physical source unavailable')
        self.assertEqual(partial_disconnect(handler_from(original.read_text())), 2)

    def test_corrected_disconnect_never_replies_twice(self):
        for failure in ('headers','body','flush'):
            with self.subTest(failure=failure):
                self.assertEqual(partial_disconnect(handler_from(SOURCE.read_text()),failure), 1)

    def test_original_model_voice_and_generation_arguments_are_preserved(self):
        original=Path(r'C:\Shahvex-AI\chatterbox-testing\chatterbox_voice_server.py')
        if not original.exists(): self.skipTest('Physical source unavailable')
        def settings(text):
            tree=ast.parse(text)
            calls=[ast.dump(n) for n in ast.walk(tree) if isinstance(n,ast.Call) and ast.unparse(n.func) in
                   ('MODEL.generate','MODEL.prepare_conditionals','ChatterboxTurboTTS.from_pretrained')]
            reference=[ast.dump(n) for n in ast.walk(tree) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='REFERENCE' for t in n.targets)]
            return sorted(calls), reference
        self.assertEqual(settings(original.read_text()),settings(SOURCE.read_text()))

    def test_long_wav_and_concurrent_admission(self):
        entered, release = threading.Event(), threading.Event()
        calls = []
        class Speech:
            def detach(self): return self
            def cpu(self): return self
            def numpy(self): return self
            def numel(self): return 1000000
        def generate(text):
            calls.append(text); entered.set()
            if not release.wait(5): raise RuntimeError('Test release timeout')
            return Speech()
        data = io.BytesIO()
        with wave.open(data, 'wb') as audio:
            audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(24000)
            audio.writeframes(b'\0' * 2000000)
        wav = data.getvalue()
        cuda = types.SimpleNamespace(synchronize=lambda:None,memory_allocated=lambda:123,memory_reserved=lambda:456)
        torch = types.SimpleNamespace(cuda=cuda,inference_mode=contextlib.nullcontext)
        handler = handler_from(SOURCE.read_text(), LOCK=threading.Lock(), torch=torch,
                               MODEL=types.SimpleNamespace(generate=generate,sr=24000),wav_bytes=lambda *_:wav)
        server = http.server.ThreadingHTTPServer(('127.0.0.1',0), handler)
        runner = threading.Thread(target=server.serve_forever,daemon=True);runner.start()
        url = f'http://127.0.0.1:{server.server_port}/synthesize'
        def request(): return urllib.request.urlopen(urllib.request.Request(url,data=b'{"text":"synthetic fixture"}',headers={'Content-Type':'application/json'}),timeout=5)
        results=[]
        def first():
            try:
                with request() as response: results.append(response.read())
            except Exception as error: results.append(error)
        worker=threading.Thread(target=first);worker.start()
        try:
            self.assertTrue(entered.wait(2));started=time.perf_counter()
            with self.assertRaises(urllib.error.HTTPError) as busy: request()
            self.assertEqual(busy.exception.code,429);busy.exception.close()
            self.assertLess(time.perf_counter()-started,1)
            release.set();worker.join(5)
            self.assertEqual(results,[wav]);self.assertEqual(len(calls),1)
            original_generate = handler.do_POST.__globals__['MODEL'].generate
            def failed_generate(_): raise RuntimeError('simulated native failure')
            handler.do_POST.__globals__['MODEL'].generate = failed_generate
            with self.assertRaises(urllib.error.HTTPError) as failed: request()
            self.assertEqual(failed.exception.code,500);failed.exception.close()
            handler.do_POST.__globals__['MODEL'].generate = original_generate
            with request() as recovered: self.assertEqual(recovered.read(),wav)
            print('MEASURED synthetic WAV: 2000044 bytes intact; concurrent admission <1s; one native job')
        finally:
            release.set();worker.join(5);server.shutdown();server.server_close();runner.join()

if __name__ == '__main__': unittest.main()
