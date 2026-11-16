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
os.environ['SHAHVEX_PRECACHE_VOICES'] = 'lissa'
os.environ['SHAHVEX_WARM_VOICE'] = 'lissa'
sys.path.insert(0, str(Path(__file__).parent))
from cosyvoice_safe_api import existing
import torch
review_threads = int(os.environ.get('SHAHVEX_REVIEW_THREADS', '0'))
if review_threads not in (0, 1, 2, 4):
    raise SystemExit('Review threads must be 0, 1, 2 or 4')
if review_threads:
    torch.set_num_threads(review_threads)
    torch.set_num_interop_threads(1)

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
hop_values = tuple(int(value) for value in os.environ.get('SHAHVEX_REVIEW_HOPS', '25,25,25').split(','))
steps = int(os.environ.get('SHAHVEX_REVIEW_FLOW_STEPS', '10'))
if steps not in (5, 10):
    raise SystemExit('Review flow steps must be 5 or 10')
if not hop_values or any(value < 5 or value > 25 for value in hop_values):
    raise SystemExit('Review hop sizes must be between 5 and 25')
folder = Path('/mnt/e/Shahvex/.data/lissa-speed-' + precision + '-' + '-'.join(map(str, hop_values)) + '-steps' + str(steps))
if review_threads:
    folder = folder.with_name(folder.name + '-threads' + str(review_threads))
fast_poll = os.environ.get('SHAHVEX_REVIEW_FAST_POLL') == '1'
if fast_poll:
    folder = folder.with_name(folder.name + '-poll10ms')
folder.mkdir(exist_ok=True)
text = 'That sounds good. We can take this one step at a time.'
cases = [text]
if os.environ.get('SHAHVEX_REVIEW_EXPRESSIONS') == '1':
    cases = ['Is now an okay time?', 'I understand. We can keep this brief.',
             'That sounds good. [quick_breath] We can take this one step at a time.',
             '[laughter] That is a lovely surprise. Thank you for sharing that.',
             'The appointment is at ten thirty on Monday morning.',
             'Could you repeat the last part? I did not catch that.']
    folder = folder / 'expressions'
    folder.mkdir(exist_ok=True)

async def main():
    results=[]
    async with existing.lifespan(existing.app):
        native = existing.model.model
        if fast_poll:
            from tts_polling import configure_stream_polling
            configure_stream_polling(native)
        original_token2wav = native.token2wav
        stages = []
        def timed_token2wav(*args, **kwargs):
            started = time.perf_counter()
            result = original_token2wav(*args, **kwargs)
            torch.cuda.synchronize()
            stages.append({'start': started, 'durationMs': round((time.perf_counter()-started)*1000)})
            return result
        native.token2wav = timed_token2wav
        if steps != 10:
            decoder = existing.model.model.flow.decoder
            original_forward = decoder.forward
            def review_forward(*args, **kwargs):
                kwargs['n_timesteps'] = steps
                return original_forward(*args, **kwargs)
            decoder.forward = review_forward
        for voice_id in ('lissa',):
            voice=existing.get_voice(voice_id)
            with existing.model_lock:
                existing.ensure_cached(voice)
            for index,hop in enumerate(hop_values):
                sample_text = cases[index % len(cases)]
                torch.manual_seed(1729)
                first=None;pieces=[];arrivals=[]
                stages.clear()
                began=time.perf_counter()
                with existing.model_lock, torch.inference_mode():
                    native=existing.model.model
                    native.token_hop_len=hop
                    for pcm in existing.stream_pcm(sample_text,voice):
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
                row['text'] = sample_text
                row['audioStages'] = [{'startedMs': round((s['start']-began)*1000), 'durationMs': s['durationMs']} for s in stages]
                results.append(row)
                (folder/'results.json').write_text(json.dumps({'text':text,'results':results},indent=2))
                print('RESULT '+json.dumps(row),flush=True)

asyncio.run(main())
