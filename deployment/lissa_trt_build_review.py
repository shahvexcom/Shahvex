"""Standalone, offline TensorRT plan build. No live model/service edits."""
import os
from pathlib import Path
import sys
import threading
import time

if os.environ.get('SHAHVEX_LOCAL_TTS_COMPARE') != '1':
    raise SystemExit('Explicit benchmark opt-in required')
sys.path.insert(0, '/mnt/e/Shahvex/.data/lissa-tensorrt-10-review')

def memory_guard():
    while True:
        fields = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
        available = int(fields['MemAvailable'].split()[0])
        status = Path('/proc/self/status').read_text().splitlines()
        rss = int(next(line for line in status if line.startswith('VmRSS:')).split()[1])
        if available < 900 * 1024 or rss > int(os.environ.get("SHAHVEX_TRT_RSS_LIMIT_MB", "5800")) * 1024:
            print('BUILD STOPPED: RAM guard reached; live services preserved', flush=True)
            os._exit(75)
        time.sleep(.25)

threading.Thread(target=memory_guard, daemon=True).start()
import tensorrt as trt

root = Path.home() / 'shahvex-ai/CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B-HF'
out = Path('/mnt/e/Shahvex/.data/lissa-trt-speed-tf32/lissa-flow.fp32.plan')
logger = trt.Logger(trt.Logger.WARNING)
builder = trt.Builder(logger)
builder.max_threads = 2
network = builder.create_network(1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH))
parser = trt.OnnxParser(network, logger)
config = builder.create_builder_config()
config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, 1 << 32)
config.builder_optimization_level = 0
print('Parsing existing ONNX without loading a second PyTorch voice model', flush=True)
if not parser.parse_from_file(str(root / 'flow.decoder.estimator.fp32.onnx')):
    raise RuntimeError('\n'.join(str(parser.get_error(i)) for i in range(parser.num_errors)))
profile = builder.create_optimization_profile()
for name, channels in [('x',80),('mask',1),('mu',80),('cond',80)]:
    profile.set_shape(name,(2,channels,4),(2,channels,500),(2,channels,3000))
config.add_optimization_profile(profile)
print('Building isolated plan with 4 GiB workspace and RAM watchdog', flush=True)
plan = builder.build_serialized_network(network, config)
if plan is None:
    raise RuntimeError('TensorRT plan build failed')
out.parent.mkdir(exist_ok=True)
out.write_bytes(bytes(plan))
print('Standalone TensorRT plan built', flush=True)
