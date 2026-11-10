"""Candidate policy: reset to the model's native 25-token first chunk per request."""
def fresh_native_stream(model, lock, factory):
    # Must run on the single lock-owning worker used by threaded_pcm.
    with lock:
        native = model.model
        previous = native.token_hop_len
        try:
            native.token_hop_len = 25
            yield from factory()
        finally:
            native.token_hop_len = previous
