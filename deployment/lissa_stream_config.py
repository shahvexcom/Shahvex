"""Scoped Lissa decoder settings; caller must hold the native model lock."""
from contextlib import contextmanager


@contextmanager
def lissa_stream_config(native, enabled):
    previous_hop = native.token_hop_len
    native.token_hop_len = 20 if enabled else 25
    decoder = native.flow.decoder
    original_forward = decoder.forward
    had_override = 'forward' in decoder.__dict__
    try:
        if enabled:
            def faster_forward(*args, **kwargs):
                kwargs['n_timesteps'] = 5
                return original_forward(*args, **kwargs)
            decoder.forward = faster_forward
        yield
    finally:
        if enabled:
            if had_override:
                decoder.forward = original_forward
            else:
                del decoder.forward
        native.token_hop_len = previous_hop
