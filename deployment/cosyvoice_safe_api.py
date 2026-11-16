"""Cancellation-safe wrapper; preserves installed models, voices and lifespan."""
import sys
import os
import io
import time
import wave
from typing import Literal
from contextlib import asynccontextmanager
from pathlib import Path

root = Path.home() / "shahvex-ai"
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / "CosyVoice"))
sys.path.insert(0, str(root / "CosyVoice" / "third_party" / "Matcha-TTS"))

from fastapi import HTTPException
from fastapi.responses import StreamingResponse, Response
from starlette.concurrency import run_in_threadpool
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
from lissa_emotions import LissaEmotions

emotions = LissaEmotions(existing)


def stream_voice(text, voice, stopped=None, emotion="neutral"):
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
            yield from emotions.pcm(text, voice, emotion)

app = existing.app


class SpeechRequest(existing.SpeechRequest):
    emotion: Literal["neutral", "laugh", "sad", "surprise", "reassure"] = "neutral"


_original_lifespan = app.router.lifespan_context


@asynccontextmanager
async def approved_emotion_lifespan(app):
    async with _original_lifespan(app):
        with existing.model_lock, existing.torch.inference_mode():
            emotions.prepare()
            voice = existing.get_voice("lissa")
            for name, definition in emotions.enabled.items():
                for _ in stream_voice(definition["warm"], voice, emotion=name):
                    pass
        existing.log.info("APPROVED_LISSA_EMOTIONS_READY %s", sorted(emotions.enabled))
        yield


app.router.lifespan_context = approved_emotion_lifespan
app.router.routes[:] = [route for route in app.router.routes if getattr(route, "path", None) not in ("/stream", "/synthesize", "/health")]


@app.get("/health")
def health():
    return {**existing.health(), "approved_emotions": sorted(emotions.enabled), "emotion_voice_id": "lissa", "neutral_default": True}


@app.post("/stream")
async def stream(request: SpeechRequest):
    if existing.model is None:
        raise HTTPException(503, "TTS not ready")
    voice = existing.get_voice(request.voice_id)
    emotion = emotions.effective(voice, request.emotion)
    return StreamingResponse(
        threaded_pcm(lambda stopped: stream_voice(request.text, voice, stopped, emotion), cooperative=True),
        media_type="application/octet-stream",
        headers={
            "X-Voice-ID": request.voice_id, "X-Audio-Format": "pcm_s16le",
            "X-Sample-Rate": str(existing.model.sample_rate), "X-Channels": "1",
            "X-Voice-Emotion": emotion,
            "Cache-Control": "no-store", "X-Accel-Buffering": "no",
        },
    )


def emotional_wav(text, voice, emotion):
    began = time.perf_counter()
    pieces, first = [], None
    for pcm in stream_voice(text, voice, emotion=emotion):
        if first is None:
            first = time.perf_counter() - began
        pieces.append(pcm)
    if not pieces:
        raise RuntimeError("No emotional audio generated")
    target = io.BytesIO()
    with wave.open(target, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(existing.model.sample_rate)
        wav.writeframes(b"".join(pieces))
    return target.getvalue(), first, time.perf_counter() - began


@app.post("/synthesize")
async def synthesize(request: SpeechRequest):
    if existing.model is None:
        raise HTTPException(503, "TTS not ready")
    voice = existing.get_voice(request.voice_id)
    emotion = emotions.effective(voice, request.emotion)
    if emotion == "neutral":
        return await existing.synthesize(request)
    try:
        wav, first, total = await run_in_threadpool(emotional_wav, request.text, voice, emotion)
    except Exception:
        existing.log.exception("Approved emotion WAV synthesis failed")
        raise HTTPException(500, "Speech synthesis failed")
    return Response(wav, media_type="audio/wav", headers={
        "X-Voice-ID": request.voice_id, "X-Voice-Emotion": emotion,
        "X-First-Chunk-Seconds": f"{first:.4f}", "X-Synthesis-Seconds": f"{total:.4f}",
    })
