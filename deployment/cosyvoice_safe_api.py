"""Cancellation-safe wrapper; preserves installed models, voices and lifespan."""
import sys
import os
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
os.environ['SHAHVEX_PRECACHE_VOICES'] = 'lissa'
os.environ['SHAHVEX_WARM_VOICE'] = 'lissa'
from gateway.services import cosyvoice_api as existing
from tts_stream_worker import threaded_pcm
from tts_native_lifecycle import configure_native_lifecycle, cancellation_scope
from tts_polling import configure_stream_polling


def stream_voice(text, voice, stopped=None):
    # CosyVoice grows this shared value during inference. Reset under its RLock
    # so subsequent replies don't inherit the previous reply's largest chunk.
    with existing.model_lock:
        if stopped is not None and stopped.is_set():
            return
        if not getattr(existing.model.model, '_shahvex_lifecycle', False):
            configure_stream_polling(existing.model.model)
            configure_native_lifecycle(existing.model.model)
        # Keep the original decoder and precision. Reduced-step inference was
        # rejected after the user reported changed voice quality. Readiness
        # polling above changes scheduling only, never the token/flow settings.
        existing.model.model.token_hop_len = 25
        with cancellation_scope(existing.model.model, stopped):
            yield from existing.stream_pcm(text, voice)

app = existing.app


SpeechRequest = existing.SpeechRequest
app.router.routes[:] = [route for route in app.router.routes if getattr(route, "path", None) != "/stream"]


@app.post("/stream")
async def stream(request: SpeechRequest):
    if existing.model is None:
        raise HTTPException(503, "TTS not ready")
    voice = existing.get_voice(request.voice_id)
    return StreamingResponse(
        threaded_pcm(lambda stopped: stream_voice(request.text, voice, stopped), cooperative=True),
        media_type="application/octet-stream",
        headers={
            "X-Voice-ID": request.voice_id, "X-Audio-Format": "pcm_s16le",
            "X-Sample-Rate": str(existing.model.sample_rate), "X-Channels": "1",
            "Cache-Control": "no-store", "X-Accel-Buffering": "no",
        },
    )
