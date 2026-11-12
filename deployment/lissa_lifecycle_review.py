"""Run against an already-loaded isolated model; never changes the live service."""
import json
import time
import threading
from pathlib import Path
from tts_native_lifecycle import configure_native_lifecycle, cancellation_scope


def review_lifecycle(existing):
    native = existing.model.model
    configure_native_lifecycle(native)
    voice = existing.get_voice('lissa')
    original_inference = native.llm.inference
    def broken(*args, **kwargs):
        raise ValueError('Synthetic isolated token-worker failure')
        yield 0
    began = time.perf_counter()
    native.llm.inference = broken
    try:
        try:
            list(existing.stream_pcm('Could you repeat that?', voice))
            raise AssertionError('Token failure did not propagate')
        except RuntimeError as error:
            assert 'token generation failed' in str(error)
    finally:
        native.llm.inference = original_inference
    rows = [{'tokenWorkerErrorReleasedMs': round((time.perf_counter()-began)*1000)}]
    def empty_state():
        assert not native.tts_speech_token_dict
        assert not native.llm_end_dict
        assert not native.hift_cache_dict
    empty_state()
    for delay in (.01, .25, 1.8):
        stopped = threading.Event()
        timer = threading.Timer(delay, stopped.set)
        timer.start()
        began = time.perf_counter()
        try:
            with cancellation_scope(native, stopped):
                list(existing.stream_pcm('The appointment is at ten thirty on Monday morning. Our staff will call you to confirm the details.', voice))
        finally:
            timer.cancel()
        elapsed = (time.perf_counter()-began)*1000
        empty_state()
        rows.append({'cancelAtMs': round(delay*1000), 'releasedMs': round(elapsed), 'afterCancelMs': round(elapsed-delay*1000)})
    began = time.perf_counter()
    pieces = list(existing.stream_pcm('Could you repeat that?', voice))
    assert sum(map(len, pieces)) > 1000
    empty_state()
    rows.append({'subsequentSpeechBytes': sum(map(len, pieces)), 'totalMs': round((time.perf_counter()-began)*1000)})
    Path('/mnt/e/Shahvex/.data/lissa-native-lifecycle-review.json').write_text(json.dumps(rows, indent=2))
    print('LIFECYCLE_RESULT '+json.dumps(rows), flush=True)
