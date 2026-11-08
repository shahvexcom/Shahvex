"""CPU-only synthetic encoding microbenchmark. AST-extract wav_bytes; never import torch/models."""
import ast
import hashlib
import io
import json
import statistics
import time
import wave
from pathlib import Path
import numpy as np

source = Path(r'C:\Shahvex-AI\chatterbox-testing\chatterbox_voice_server.py')
tree = ast.parse(source.read_text())
function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'wav_bytes')
namespace = {'np': np, 'io': io, 'wave': wave}
exec(compile(ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[])), '<encoding-only>', 'exec'), namespace)
rows = []
for seconds in (1, 3, 10):
    samples = np.linspace(-.2, .2, 24000*seconds, dtype=np.float32)
    durations = []
    for repeat in range(40):
        begin = time.perf_counter()
        wav = namespace['wav_bytes'](samples, 24000)
        elapsed = (time.perf_counter()-begin)*1000
        with wave.open(io.BytesIO(wav), 'rb') as w:
            assert w.getframerate() == 24000 and w.getnframes() == samples.size
        if repeat >= 10:
            durations.append(elapsed)
    rows.append({'syntheticSeconds': seconds, 'samples': len(durations), 'p50Ms': statistics.median(durations),
                 'p95Ms': sorted(durations)[28], 'worstMs': max(durations)})
print(json.dumps({'productionRequests': 0, 'gpuUsed': False, 'modelImported': False,
                  'wrapperSourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'rows': rows}, indent=2))
