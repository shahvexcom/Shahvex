"""Local-only candidate on 8776. No production routes or services changed."""
import json
import os
from pathlib import Path
import subprocess

saved=json.loads((Path.home()/'.config/shahvex-autostart/port-8767.json').read_text())['env']
for key in ('CUDA_HOME','CUDA_PATH','PATH','LD_LIBRARY_PATH','CONDA_PREFIX'):
    if key in saved:os.environ[key]=saved[key]
free=int(subprocess.check_output(['nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits'],text=True).strip().splitlines()[0])
if free<6000:raise RuntimeError('Insufficient spare GPU memory; refusing separate candidate')
os.environ['SHAHVEX_PRECACHE_VOICES']='female_02,male_02'
os.environ['SHAHVEX_WARM_VOICE']='female_02'
from cosyvoice_safe_api import app, existing
from native_stream_policy import fresh_native_stream
import torch
torch.cuda.set_per_process_memory_fraction(min(0.25,(free-1200)/24576))
original_stream=existing.stream_pcm
def candidate_stream(text,voice):
    yield from fresh_native_stream(existing.model,existing.model_lock,lambda:original_stream(text,voice))
existing.stream_pcm=candidate_stream

@app.get('/candidate/health')
def candidate_health():
    return {'ready':existing.model is not None,'mode':'native-first-chunk-reset','initialTokens':25,'productionChanged':False}
