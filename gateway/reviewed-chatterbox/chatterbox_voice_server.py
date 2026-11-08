"""Local-only, single-GPU Chatterbox Turbo TTS service for Shahvex testing.
Run with C:\\Shahvex-AI\\chatterbox-testing\\.venv\\Scripts\\python.exe.
Never expose this unauthenticated testing server to the public internet.
"""
import io
import json
import threading
import time
import wave
from uuid import uuid4
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import torch
from chatterbox.tts_turbo import ChatterboxTurboTTS

HOST = '127.0.0.1'
PORT = 8765
ROOT = Path(__file__).resolve().parent
REFERENCE = ROOT.parent / 'emotion_samples' / 'shahvex_female_reference.wav'
LOCK = threading.Lock()


def wav_bytes(samples, sample_rate):
    audio = np.asarray(samples, dtype=np.float32).reshape(-1)
    audio = np.clip(audio, -1.0, 1.0)
    pcm = (audio * 32767).astype('<i2')
    output = io.BytesIO()
    with wave.open(output, 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(int(sample_rate))
        f.writeframes(pcm.tobytes())
    return output.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print('[HTTP]', format % args, flush=True)

    def send_data(self, code, content_type, data):
        if getattr(self, '_response_started', False):
            return False
        self._response_started = True
        self.close_connection = True
        try:
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'close')
            self.end_headers()
            for offset in range(0, len(data), 65536):
                self.wfile.write(data[offset:offset + 65536])
            self.wfile.flush()
            return True
        except OSError as error:
            print(json.dumps({'stage': 'tts-transfer-disconnected', 'atUnixMs': time.time_ns() // 1000000, 'errorType': type(error).__name__,
                              'errno': error.errno}), flush=True)
            return False

    def send_json(self, code, obj):
        self.send_data(code, 'application/json', json.dumps(obj).encode('utf-8'))

    def do_GET(self):
        if self.path == '/health':
            self.send_json(200, {'ready': True, 'model': 'chatterbox-turbo',
                                 'gpu': torch.cuda.get_device_name(0)})
        else:
            self.send_json(404, {'error': 'not found'})

    def do_POST(self):
        if self.path != '/synthesize':
            self.send_json(404, {'error': 'not found'})
            return
        request_id = uuid4().hex
        received = time.perf_counter()
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16384:
                self.send_json(413, {'error': 'invalid request size'})
                return
            payload = json.loads(self.rfile.read(size))
            text = payload.get('text', '')
            if not isinstance(text, str) or not text.strip() or len(text) > 350:
                self.send_json(400, {'error': 'text must be 1-350 characters'})
                return
            # Reject admission rather than stacking native jobs behind an HTTP
            # request whose caller may already have cancelled. Never preempt GPU work.
            if not LOCK.acquire(blocking=False):
                print(json.dumps({'stage': 'tts-busy', 'atUnixMs': time.time_ns() // 1000000, 'requestId': request_id}), flush=True)
                self.send_json(429, {'error': 'Synthesis busy; retry after current request completes'})
                return
            try:
                start = time.perf_counter()
                with torch.inference_mode():
                    speech = MODEL.generate(text.strip())
                torch.cuda.synchronize()
                duration = time.perf_counter() - start
                result = wav_bytes(speech.detach().cpu().numpy(), MODEL.sr)
                print(json.dumps({'stage': 'tts-wav-ready', 'atUnixMs': time.time_ns() // 1000000, 'requestId': request_id,
                    'characters': len(text), 'nativeSynthesisMs': round(duration * 1000, 2),
                    'requestToWavMs': round((time.perf_counter() - received) * 1000, 2),
                    'wavBytes': len(result), 'audioSeconds': round(speech.numel() / MODEL.sr, 3),
                    'cudaAllocatedBytes': torch.cuda.memory_allocated(),
                    'cudaReservedBytes': torch.cuda.memory_reserved()}), flush=True)
            finally:
                LOCK.release()
            transfer_start = time.perf_counter()
            sent = self.send_data(200, 'audio/wav', result)
            print(json.dumps({'stage': 'tts-transfer-complete', 'atUnixMs': time.time_ns() // 1000000, 'requestId': request_id,
                              'complete': sent, 'transferMs': round((time.perf_counter() - transfer_start) * 1000, 2)}), flush=True)
        except Exception as error:
            print(json.dumps({'stage': 'tts-error', 'atUnixMs': time.time_ns() // 1000000, 'requestId': request_id, 'errorType': type(error).__name__}), flush=True)
            self.send_json(500, {'error': 'Synthesis failed'})


def main():
    if not REFERENCE.is_file():
        raise FileNotFoundError(f'Missing reference voice: {REFERENCE}')
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA unavailable')
    print('Loading Chatterbox Turbo (one time)...', flush=True)
    global MODEL
    MODEL = ChatterboxTurboTTS.from_pretrained(device='cuda')
    MODEL.prepare_conditionals(str(REFERENCE))
    with torch.inference_mode():
        warmup = MODEL.generate('Hello there!')
    torch.cuda.synchronize()
    del warmup
    print(f'VOICE SERVICE READY http://{HOST}:{PORT}/health', flush=True)
    print('Use wired headphones. Ctrl+C to stop server.', flush=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        print('\nStopping voice service')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
