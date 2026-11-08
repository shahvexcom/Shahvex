"""Separate loopback wrapper; never imports or modifies the working conversation script."""
import hmac
import io
import json
import os
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def serve():
    from faster_whisper import WhisperModel
    token = os.environ.get("SHAHVEX_WHISPER_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("Set SHAHVEX_WHISPER_TOKEN to at least 32 characters")
    # Reuse the installed model/cache. Never download a replacement implicitly.
    model = WhisperModel(os.environ.get("SHAHVEX_WHISPER_MODEL_PATH", "base.en"), device="cpu", compute_type="int8", local_files_only=True)
    worker = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, data):
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            return hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token)

        def do_GET(self):
            if not self.authorized():
                return self.reply(401, {"error": "Unauthorized"})
            return self.reply(200 if self.path == "/health" else 404, {"ready": self.path == "/health"})

        def do_POST(self):
            self.connection.settimeout(15)
            if not self.authorized():
                return self.reply(401, {"error": "Unauthorized"})
            if self.path != "/transcribe":
                return self.reply(404, {"error": "Unknown route"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self.reply(400, {"error": "Invalid length"})
            if size <= 0 or size > 640000 or size % 2 or self.headers.get("Content-Type") != "audio/pcm;rate=16000;channels=1":
                return self.reply(400, {"error": "Expected bounded mono PCM16 at 16kHz"})
            if not worker.acquire(blocking=False):
                return self.reply(429, {"error": "Whisper worker busy"})
            try:
                pcm = self.rfile.read(size)
                if len(pcm) != size:
                    return self.reply(400, {"error": "Incomplete audio"})
                audio = io.BytesIO()
                with wave.open(audio, "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(16000)
                    wav.writeframes(pcm)
                audio.seek(0)
                segments, _ = model.transcribe(audio, language="en")
                text = " ".join(segment.text for segment in segments)
                self.reply(200, {"text": text})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                self.reply(503, {"error": "Transcription failed"})
            finally:
                worker.release()

    ThreadingHTTPServer(("127.0.0.1", 8788), Handler).serve_forever()


if __name__ == "__main__":
    serve()
