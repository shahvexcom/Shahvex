"""Offline-weight, separate-process local TTS benchmark. Never patches live state."""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import wave

if os.environ.get('SHAHVEX_LOCAL_TTS_COMPARE') != '1':
    raise SystemExit('Explicit local benchmark opt-in required')
saved = json.loads((Path.home()/'.config/shahvex-autostart/port-8767.json').read_text())['env']
for key in ('CUDA_HOME','CUDA_PATH','PATH','LD_LIBRARY_PATH','CONDA_PREFIX'):
    if key in saved:os.environ[key]=saved[key]
free = int(subprocess.check_output(['nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits'], text=True).strip().splitlines()[0])
if free < 6000:
    raise SystemExit('Insufficient spare GPU memory; production left unchanged')
os.environ['SHAHVEX_PRECACHE_VOICES'] = 'female_02,male_02'
os.environ['SHAHVEX_WARM_VOICE'] = 'female_02'
sys.path.insert(0, str(Path(__file__).parent))
from cosyvoice_safe_api import existing
import torch

precision=os.environ.get('SHAHVEX_LOCAL_TTS_PRECISION','fp32')
if precision not in ('fp32','fp16','tf32'):raise SystemExit('Unsupported local precision')
if precision=='tf32':
    torch.backends.cuda.matmul.allow_tf32=True
    torch.backends.cudnn.allow_tf32=True
    torch.set_float32_matmul_precision('high')
if precision=='fp16':
    original_model=existing.AutoModel
    def local_model(*args,**kwargs):
        kwargs['fp16']=True
        return original_model(*args,**kwargs)
    existing.AutoModel=local_model

torch.cuda.set_per_process_memory_fraction(min(0.25, (free-1200)/24576))
folder = Path('/mnt/e/Shahvex/.data/pc-ai/native-tts-compare' + ('-'+precision if precision!='fp32' else ''))
folder.mkdir(exist_ok=True)
text = 'Your consultation costs two thousand Pakistani rupees, and our staff will confirm your preferred appointment time.'

async def main():
    results=[]
    async with existing.lifespan(existing.app):
        for voice_id in ('female_02','male_02'):
            voice=existing.get_voice(voice_id)
            with existing.model_lock:
                existing.ensure_cached(voice)
            for index,hop in enumerate((100,25,100,25)):
                torch.manual_seed(1729)
                first=None;pieces=[];arrivals=[]
                began=time.perf_counter()
                with existing.model_lock, torch.inference_mode():
                    native=existing.model.model
                    native.token_hop_len=hop
                    for pcm in existing.stream_pcm(text,voice):
                        now=time.perf_counter()-began
                        if first is None:first=now
                        pieces.append(pcm);arrivals.append({'atSeconds':round(now,4),'audioSeconds':len(pcm)/48000})
                pcm=b''.join(pieces)
                name=f'{voice_id}-{index+1}-hop{hop}.wav'
                with wave.open(str(folder/name),'wb') as f:
                    f.setnchannels(1);f.setsampwidth(2);f.setframerate(24000);f.writeframes(pcm)
                queued_until=first or 0;underflows=[]
                for piece in arrivals:
                    if piece['atSeconds']>queued_until+.04:underflows.append(round(piece['atSeconds']-queued_until,3))
                    queued_until=max(queued_until,piece['atSeconds'])+piece['audioSeconds']
                row={'voice':voice_id,'precision':precision,'initialHop':hop,'firstPcmMs':round(first*1000),'totalMs':round((time.perf_counter()-began)*1000),'durationSeconds':round(len(pcm)/48000,3),'chunks':len(pieces),'underflowSeconds':underflows,'file':name,'arrivals':arrivals}
                results.append(row)
                (folder/'results.json').write_text(json.dumps({'text':text,'results':results},indent=2))
                print('RESULT '+json.dumps(row),flush=True)

asyncio.run(main())
