"""Generate independent CPU clone previews; never imports or restarts the live service."""
import argparse
import hashlib
import json
import os
import sys
import time
import wave
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backend-root', type=Path, required=True)
    parser.add_argument('--prepared', type=Path, default=Path(__file__).resolve().parents[1] / '.data/voice-clones-emma-olivia')
    args = parser.parse_args()
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ.setdefault('MPLCONFIGDIR', '/tmp/shahvex-matplotlib')
    os.environ.setdefault('NUMBA_CACHE_DIR', '/tmp/shahvex-numba')
    os.environ.setdefault('TRITON_CACHE_DIR', '/tmp/shahvex-clone-triton')
    cosy = args.backend_root / 'CosyVoice'
    sys.path.insert(0, str(cosy))
    sys.path.insert(0, str(cosy / 'third_party/Matcha-TTS'))
    protected = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in (args.backend_root / 'gateway/voices/lissa').glob('*') if p.is_file()}
    import torch
    torch.set_num_threads(4)
    # This process remains on CPU even when a production service uses the GPU.
    torch.cuda.is_available = lambda: False
    import wetext.wetext as normalization
    snapshot_download = normalization.snapshot_download
    def local_snapshot(*a, **kw):
        kw['local_files_only'] = True
        return snapshot_download(*a, **kw)
    normalization.snapshot_download = local_snapshot
    from cosyvoice.cli.cosyvoice import AutoModel
    model = AutoModel(model_dir=str(cosy / 'pretrained_models/Fun-CosyVoice3-0.5B-HF'), load_trt=False, fp16=False)
    results = {}
    for voice, name in [('emma', 'Emma'), ('olivia', 'Olivia')]:
        folder = args.prepared / voice
        metadata = json.loads((folder / 'metadata.json').read_text())
        reference = folder / 'reference.wav'
        if hashlib.sha256(reference.read_bytes()).hexdigest() != metadata['reference_sha256']:
            raise ValueError(f'Reference checksum mismatch: {voice}')
        text = f'Hi, this is {name}. How can I help you today?'
        started, pieces = time.monotonic(), []
        with torch.inference_mode():
            for chunk in model.inference_zero_shot(text, 'You are a helpful assistant.<|endofprompt|>' + metadata['reference_transcript'], str(reference), stream=False, text_frontend=False):
                pieces.append(chunk['tts_speech'].detach().cpu())
        if not pieces:
            raise RuntimeError(f'No generated speech for {voice}')
        audio = torch.cat(pieces, dim=1).squeeze().clamp(-1, 1).mul(32767).to(torch.int16).numpy().tobytes()
        with wave.open(str(folder / 'preview.wav'), 'wb') as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(model.sample_rate)
            out.writeframes(audio)
        results[voice] = {'text': text, 'sample_rate': model.sample_rate, 'duration': len(audio) / (2 * model.sample_rate), 'generation_seconds': time.monotonic() - started, 'production_service_modified': False}
        (folder / 'preview-result.json').write_text(json.dumps(results[voice], indent=2))
        print(json.dumps({voice: results[voice]}), flush=True)
    if any(hashlib.sha256(p.read_bytes()).hexdigest() != h for p, h in protected.items()):
        raise RuntimeError('Lissa checksum changed')
    print('Lissa assets unchanged; no service restart or production cache modification.')


if __name__ == '__main__':
    main()
