"""Separate local speed experiment. Never maps existing cloned voice IDs."""
import io
import json
import os
from pathlib import Path
import threading
from contextlib import asynccontextmanager
import wave

saved=json.loads((Path.home()/'.config/shahvex-autostart/port-8767.json').read_text())['env']
for key in ('CUDA_HOME','CUDA_PATH','PATH','LD_LIBRARY_PATH'):
    if key in saved:os.environ[key]=saved[key]

os.environ['HF_HOME']='/mnt/e/Shahvex/.data/pc-ai/fast-hf-cache'
os.environ['HF_HUB_DISABLE_XET']='1'
import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from tts_stream_worker import threaded_pcm

pipeline=None
lock=threading.Lock()
voices={'af_heart':('Jenifer','female'),'am_michael':('Experimental Michael','male')}
def audio(text,voice):
    with lock,torch.inference_mode():
        for _,_,samples in pipeline(text,voice=voice,speed=1):
            a=samples.detach().cpu().numpy()
            if not np.isfinite(a).all():raise RuntimeError('Invalid audio')
            yield (np.clip(a,-1,1)*32767).astype('<i2').tobytes()

@asynccontextmanager
async def lifespan(app):
    global pipeline
    from kokoro import KPipeline
    torch.set_num_threads(4)
    pipeline=KPipeline(lang_code='a',repo_id='hexgrad/Kokoro-82M',device='cuda')
    for voice in voices:
        for _ in audio('Ready to begin our conversation.',voice):pass
    yield
    pipeline=None

app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None)
class Speech(BaseModel):
    text:str=Field(min_length=1,max_length=500)
    voice_id:str='af_heart'
def validate(request):
    if request.voice_id not in voices:raise HTTPException(400,'Select an explicit experimental voice; clones are not substituted')
    if pipeline is None:raise HTTPException(503,'Loading')

@app.get('/health')
def health():return {'status':'ready' if pipeline else 'loading','cached_voice_ids':list(voices),'experiment':'alternative-voice-engine','sample_rate':24000}
@app.get('/voices')
def inventory():return {'default_voice':'af_heart','voices':[{'id':v,'name':n,'gender':g,'selectable':True}for v,(n,g)in voices.items()]}
@app.post('/stream')
async def stream(request:Speech):
    validate(request)
    return StreamingResponse(threaded_pcm(lambda:audio(request.text,request.voice_id)),headers={'content-type':'application/octet-stream','x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1','cache-control':'no-store'})
@app.post('/synthesize')
async def synthesize(request:Speech):
    validate(request)
    def generate():
        pcm=b''.join(audio(request.text,request.voice_id))
        target=io.BytesIO()
        with wave.open(target,'wb')as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(24000);f.writeframes(pcm)
        return target.getvalue()
    return Response(await run_in_threadpool(generate),media_type='audio/wav',headers={'cache-control':'no-store'})
