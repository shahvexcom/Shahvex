"""Cancellation-safe wrapper; preserves installed models, voices and lifespan."""
import sys
from pathlib import Path

root = Path.home() / "shahvex-ai"
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / "CosyVoice"))
sys.path.insert(0, str(root / "CosyVoice" / "third_party" / "Matcha-TTS"))

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
import wetext.wetext as normalization
# The installed frontend otherwise tries downloading unrelated languages at boot.
# Reuse only local resources; CosyVoice's existing missing-frontend fallback stays intact.
_snapshot_download = normalization.snapshot_download
def _local_snapshot(*args, **kwargs):
    kwargs['local_files_only'] = True
    return _snapshot_download(*args, **kwargs)
normalization.snapshot_download = _local_snapshot
from gateway.services import cosyvoice_api as existing
from tts_stream_worker import threaded_pcm

app = existing.app
SpeechRequest = existing.SpeechRequest
app.router.routes[:] = [route for route in app.router.routes if getattr(route, "path", None) != "/stream"]


@app.post("/stream")
async def stream(request: SpeechRequest):
    if existing.model is None:
        raise HTTPException(503, "TTS not ready")
    voice = existing.get_voice(request.voice_id)
    return StreamingResponse(
        threaded_pcm(lambda: existing.stream_pcm(request.text, voice)),
        media_type="application/octet-stream",
        headers={
            "X-Voice-ID": request.voice_id, "X-Audio-Format": "pcm_s16le",
            "X-Sample-Rate": str(existing.model.sample_rate), "X-Channels": "1",
            "Cache-Control": "no-store", "X-Accel-Buffering": "no",
        },
    )
