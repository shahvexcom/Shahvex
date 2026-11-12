"""Cooperative cancellation and error cleanup for serialized CosyVoice streams.

Callers hold the model RLock for the entire inference. Completed requests retain
the original tokens, decoder steps, precision, chunk sizes and reference audio.
"""
from contextlib import contextmanager
from types import MethodType
from threading import Event


def configure_native_lifecycle(native):
    if getattr(native, '_shahvex_lifecycle', False):
        return
    original_tts = native.tts
    original_job = native.llm_job
    original_decode = native.token2wav
    original_inference = native.llm.inference
    failures = {}
    jobs = {}
    native._shahvex_cancel = None

    def cancelled():
        event = native._shahvex_cancel
        return event is not None and event.is_set()

    def inference(self, *args, **kwargs):
        iterator = original_inference(*args, **kwargs)
        try:
            while not cancelled():
                try:
                    token = next(iterator)
                except StopIteration:
                    return
                if cancelled():
                    return
                yield token
        finally:
            close = getattr(iterator, 'close', None)
            if close is not None:
                close()

    def job(self, *args, **kwargs):
        request_id = kwargs.get('uuid', args[-1] if args else None)
        completed = Event()
        jobs[request_id] = completed
        try:
            original_job(*args, **kwargs)
        except Exception as error:
            failures[request_id] = error
        finally:
            # An exception in the token thread otherwise leaves tts polling forever.
            self.llm_end_dict[request_id] = True
            completed.set()

    def decode(self, *args, **kwargs):
        request_id = kwargs.get('uuid')
        if request_id in failures:
            raise RuntimeError('Speech token generation failed') from failures[request_id]
        if cancelled():
            # Drain the native loop and its normal cleanup without stale decoding.
            import torch
            return torch.zeros(1, 0)
        return original_decode(*args, **kwargs)

    def tts(self, *args, **kwargs):
        before = set(self.tts_speech_token_dict)
        previous_event = self._shahvex_cancel
        if previous_event is None:
            self._shahvex_cancel = Event()
        try:
            for output in original_tts(*args, **kwargs):
                # Do not expose zero-length cancellation sentinels to the public
                # facade, which calculates RTF by dividing by speech duration.
                if not cancelled():
                    yield output
        finally:
            # Native cleanup is after its final yield, not in a finally block.
            # The HTTP producer always drains; this also covers decoder failure.
            created = (set(self.tts_speech_token_dict) | set(jobs)) - before
            for request_id in created:
                if request_id in jobs and not jobs[request_id].is_set():
                    self._shahvex_cancel.set()
                    jobs[request_id].wait()
            with self.lock:
                for request_id in created:
                    for state in (self.tts_speech_token_dict, self.llm_end_dict, self.hift_cache_dict):
                        state.pop(request_id, None)
                    failures.pop(request_id, None)
                    jobs.pop(request_id, None)
            self._shahvex_cancel = previous_event

    native.llm.inference = MethodType(inference, native.llm)
    native.llm_job = MethodType(job, native)
    native.token2wav = MethodType(decode, native)
    native.tts = MethodType(tts, native)
    native._shahvex_lifecycle = True


@contextmanager
def cancellation_scope(native, event):
    previous = native._shahvex_cancel
    native._shahvex_cancel = event
    try:
        yield
    finally:
        native._shahvex_cancel = previous
