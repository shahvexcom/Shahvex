"""Isolated original-quality CUDA graph trial with seeded PCM equivalence."""
import os
import sys
import json
import asyncio
import time
from pathlib import Path

if os.environ.get('SHAHVEX_LOCAL_TTS_COMPARE') != '1':
    raise SystemExit('Explicit benchmark opt-in required')
saved = json.loads((Path.home()/'.config/shahvex-autostart/port-8767.json').read_text())['env']
for key in ('CUDA_HOME','CUDA_PATH','PATH','LD_LIBRARY_PATH','CONDA_PREFIX'):
    if key in saved:
        os.environ[key] = saved[key]
sys.path.insert(0, str(Path(__file__).parent))
from cosyvoice_safe_api import existing
from tts_decoder_graph import configure_decoder_graph
from tts_polling import configure_stream_polling
import torch
import subprocess
free = int(subprocess.check_output(['nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits'],text=True).splitlines()[0])
if free < 6000:
    raise SystemExit('Insufficient spare GPU memory; live service unchanged')
torch.cuda.set_per_process_memory_fraction(0.25)
reference_cache = os.environ.get('SHAHVEX_REVIEW_REFERENCE_CACHE') == '1'
sampling_sync = os.environ.get('SHAHVEX_REVIEW_SAMPLING_SYNC') == '1'
folder = Path('/mnt/e/Shahvex/.data/lissa-original-sampling-sync-review' if sampling_sync else '/mnt/e/Shahvex/.data/lissa-original-reference-cache-review' if reference_cache else '/mnt/e/Shahvex/.data/lissa-original-graph-review')
folder.mkdir(exist_ok=True)

def sample(text, voice):
    torch.manual_seed(1729)
    native = existing.model.model
    native.token_hop_len = 25
    start = time.perf_counter()
    pieces, arrivals = [], []
    for pcm in existing.stream_pcm(text, voice):
        arrivals.append({'ms': round((time.perf_counter()-start)*1000), 'seconds': len(pcm)/48000})
        pieces.append(pcm)
    return b''.join(pieces), arrivals

async def main():
    async with existing.lifespan(existing.app):
        configure_stream_polling(existing.model.model)
        if os.environ.get('SHAHVEX_REVIEW_LIFECYCLE') == '1':
            from lissa_lifecycle_review import review_lifecycle
            review_lifecycle(existing)
            return
        voice = existing.get_voice('lissa')
        cases = ['That sounds good. We can take this one step at a time.', 'The appointment is at ten thirty on Monday morning.', 'Could you repeat the last part? I did not catch that.']
        native = existing.model.model
        inference = native.llm.inference
        recorded = []
        def recording(*args, **kwargs):
            for token in inference(*args, **kwargs):
                recorded.append(token)
                yield token
        native.llm.inference = recording
        sample(cases[0], voice)
        native.llm.inference = lambda *args, **kwargs: iter(recorded)
        fixed_baseline = sample(cases[0], voice)[0]
        if sampling_sync:
            from tts_sampling_sync import configure_sampling_sync
            original_sampling = native.llm.sampling
            configure_sampling_sync(native.llm)
            for seed in range(100):
                torch.manual_seed(seed)
                scores = torch.randn(6761, device='cuda') * (1 + seed % 8)
                history = list(range(seed % 11))
                torch.manual_seed(seed + 1000)
                expected = original_sampling(scores.clone(), history, 25)
                torch.manual_seed(seed + 1000)
                actual = native.llm.sampling(scores.clone(), history, 25)
                assert actual == expected, 'Sampler token/RNG mismatch'
            print('SAMPLING_EQUIVALENCE 100 seeded FP32 distributions', flush=True)
        if reference_cache:
            from tts_reference_cache import configure_reference_cache
            info = existing.model.frontend.spk2info[existing.ensure_cached(voice)]
            configure_reference_cache(native, info['prompt_speech_feat'].shape[1])
        elif not sampling_sync:
            configure_decoder_graph(existing.model.model.flow.decoder)
        fixed_graph = sample(cases[0], voice)[0]
        # The first cached pass populates the per-step reference states.
        if reference_cache:
            fixed_graph = sample(cases[0], voice)[0]
        identical = fixed_baseline == fixed_graph
        print('FIXED_TOKENS_PCM_IDENTICAL '+str(identical), flush=True)
        if not identical:
            raise RuntimeError('Fixed-token PCM equivalence failed; candidate rejected')
        native.llm.inference = inference
        rows = []
        for repeat in range(2):
            for index, text in enumerate(cases):
                pcm, arrivals = sample(text, voice)
                row = {'case': index, 'repeat': repeat, 'fixedTokenPcmIdentical': identical, 'arrivals': arrivals}
                if reference_cache:
                    row['cache'] = dict(native.flow.decoder.estimator._shahvex_reference_stats)
                rows.append(row)
                (folder/'results.json').write_text(json.dumps(rows, indent=2))
                print('RESULT '+json.dumps(row), flush=True)

asyncio.run(main())
