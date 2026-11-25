"""Independent GPU engine for shared voice clones."""
import io
import json
import os
import sys
import threading
import wave
from contextlib import asynccontextmanager
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ.setdefault('TRITON_CACHE_DIR', '/tmp/shahvex-clone-triton')
os.environ.setdefault('MPLCONFIGDIR', '/tmp/shahvex-matplotlib')
os.environ.setdefault('NUMBA_CACHE_DIR', '/tmp/shahvex-numba')
BACKEND = Path(os.environ.get('SHAHVEX_CLONE_BACKEND_ROOT', str(Path(__file__).resolve().parents[3] / 'linux-root/home/nazeer_ahmed/shahvex-ai')))
LAUREN_REFERENCE = Path(__file__).resolve().parents[1] / '.data/voice-clones-lauren'
CLONE_VOICE_IDS = ('emma', 'olivia', 'lauren')
sys.path.insert(0, str(BACKEND / 'CosyVoice'))
sys.path.insert(0, str(BACKEND / 'CosyVoice/third_party/Matcha-TTS'))
import torch
# Inference does not use the optional DeepSpeed training/compiler integration.
import transformers.integrations.deepspeed as training_integration
training_integration.is_deepspeed_available = lambda: False
import wetext.wetext as normalization
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from tts_stream_worker import threaded_pcm
from tts_native_lifecycle import configure_native_lifecycle, cancellation_scope
from tts_polling import configure_stream_polling
# maximum limit of 4 threads for inference, to avoid over-subscription of cpu resources when multiple requests are being p4rocessed in parallel. This is especially important for CPU inference, where the default number of threads can be very high and lead to performance degradation.
torch.set_num_threads(4)
_snapshot = normalization.snapshot_download
def local_snapshot(*args, **kwargs):
    kwargs['local_files_only'] = True
    return _snapshot(*args, **kwargs)
normalization.snapshot_download = local_snapshot
from cosyvoice.cli.cosyvoice import AutoModel

model = None
lock = threading.RLock()
voices = {}
cached = set()


class Speech(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    voice_id: str


def pcm(text, voice_id, stopped=None):
    if voice_id not in voices:
        raise HTTPException(404, 'Unknown clone voice')
    with lock, torch.inference_mode():
        if stopped is not None and stopped.is_set():
            return
        voice = voices[voice_id]
        cache_id = 'independent_' + voice_id
        if cache_id not in cached:
            model.add_zero_shot_spk('You are a helpful assistant.<|endofprompt|>' + voice['reference_transcript'], str(voice_reference_dir(voice_id) / 'reference.wav'), cache_id)
            cached.add(cache_id)
        model.model.token_hop_len = 25
        with cancellation_scope(model.model, stopped):
            for item in model.inference_zero_shot(text, '', '', zero_shot_spk_id=cache_id, stream=True, text_frontend=False):
                if stopped is not None and stopped.is_set():
                    break
                yield item['tts_speech'].detach().cpu().squeeze().clamp(-1, 1).mul(32767).to(torch.int16).numpy().tobytes()


def voice_reference_dir(voice_id):
    if voice_id == 'lauren' and (LAUREN_REFERENCE / 'metadata.json').is_file() and (LAUREN_REFERENCE / 'reference.wav').is_file():
        return LAUREN_REFERENCE
    return BACKEND / 'gateway/voices' / voice_id


@asynccontextmanager
async def lifespan(app):
    global model
    configured_voices = os.environ.get('SHAHVEX_CLONE_VOICE_IDS')
    voice_ids = (tuple(dict.fromkeys(voice.strip() for voice in configured_voices.split(',')))
                 if configured_voices is not None else CLONE_VOICE_IDS)
    if any(voice_id not in CLONE_VOICE_IDS for voice_id in voice_ids):
        raise RuntimeError('SHAHVEX_CLONE_VOICE_IDS contains an unknown clone voice')
    for voice_id in voice_ids:
        metadata = voice_reference_dir(voice_id) / 'metadata.json'
        if configured_voices is None and voice_id == 'lauren' and not metadata.is_file():
            continue
        voices[voice_id] = json.loads(metadata.read_text())
    if not torch.cuda.is_available():
        raise RuntimeError("Live clone voices require CUDA; refusing slow CPU fallback")
    model = AutoModel(model_dir=str(BACKEND / 'CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B-HF'), load_trt=False, fp16=False)
    configure_stream_polling(model.model)
    configure_native_lifecycle(model.model)
    # Warm speaker caches and GPU kernels before readiness.
    for voice_id in voices:
        for _ in pcm('Ready.', voice_id):
            pass
    yield


app = FastAPI(lifespan=lifespan)


@app.get('/health')
def health():
    return {'status': 'ready' if model else 'loading', 'sample_rate': 24000, 'cached_voice_ids': sorted(key.removeprefix('independent_') for key in cached), 'independent_clones': True, 'device': str(model.model.device) if model else None}


@app.get('/voices')
def catalog():
    return {'default_voice': next(iter(voices), None), 'voices': [dict(id=key, name=v['name'], gender=v['gender'], language='English', accent=v['accent'], selectable=True) for key, v in voices.items()]}


@app.post('/stream')
async def stream(request: Speech):
    if request.voice_id not in voices:
        raise HTTPException(404, 'Unknown clone voice')
    return StreamingResponse(threaded_pcm(lambda stopped: pcm(request.text, request.voice_id, stopped), cooperative=True), media_type='application/octet-stream', headers={'X-Audio-Format': 'pcm_s16le', 'X-Sample-Rate': '24000', 'X-Channels': '1', 'Cache-Control': 'no-store'})


def wav(text, voice_id):
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        for chunk in pcm(text, voice_id):
            audio.writeframes(chunk)
    return output.getvalue()


@app.post('/synthesize')
async def synthesize(request: Speech):
    if request.voice_id not in voices:
        raise HTTPException(404, 'Unknown clone voice')
    return Response(await run_in_threadpool(wav, request.text, request.voice_id), media_type='audio/wav', headers={'Cache-Control': 'no-store'})
