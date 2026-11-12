"""Optional bounded CUDA graph replay of the ORIGINAL ten-step flow decoder.

No quantization, reduced steps, hop changes, reference trimming or rate changes.
Only the first encountered shape is captured; all other shapes use native code.
Caller serializes inference with the existing model lock.
"""
from types import MethodType, FunctionType


def configure_decoder_graph(decoder):
    import torch
    if getattr(decoder, '_shahvex_graph', False):
        return
    original = decoder.forward
    cache = {}
    # Native forward copies this fixed CPU noise on every call; CUDA capture
    # cannot contain a synchronous host-to-device copy. Preserve its values.
    decoder.rand_noise = decoder.rand_noise.to(next(decoder.parameters()).device)
    # DiT's mask helper contains a host .item() validation. The mask is invariant
    # across diffusion steps. Reuse the mask just validated during warmup only
    # while capturing; all ordinary calls retain the original helper.
    estimator = decoder.estimator
    estimator_forward = estimator.forward.__func__
    original_mask = estimator_forward.__globals__['add_optional_chunk_mask']
    validated_mask = []
    def graph_mask(*args, **kwargs):
        if torch.cuda.is_current_stream_capturing():
            return validated_mask[0]
        result = original_mask(*args, **kwargs)
        validated_mask[:] = [result]
        return result
    scope = dict(estimator_forward.__globals__, add_optional_chunk_mask=graph_mask)
    configured = FunctionType(estimator_forward.__code__, scope, estimator_forward.__name__, estimator_forward.__defaults__, estimator_forward.__closure__)
    configured.__kwdefaults__ = estimator_forward.__kwdefaults__
    estimator.forward = MethodType(configured, estimator)

    def forward(self, *args, **kwargs):
        if args or not torch.cuda.is_available():
            return original(*args, **kwargs)
        tensors = {key: value for key, value in kwargs.items() if isinstance(value, torch.Tensor)}
        if not tensors or any(not value.is_cuda for value in tensors.values()):
            return original(**kwargs)
        key = tuple((name, tuple(value.shape), value.dtype, value.device) for name, value in tensors.items()) + tuple((name, value) for name, value in kwargs.items() if name not in tensors)
        if key not in cache:
            if cache:
                return original(**kwargs)
            static = {name: value.clone() if name in tensors else value for name, value in kwargs.items()}
            stream = torch.cuda.Stream()
            stream.wait_stream(torch.cuda.current_stream())
            with torch.cuda.stream(stream):
                for _ in range(3):
                    original(**static)
            torch.cuda.current_stream().wait_stream(stream)
            graph = torch.cuda.CUDAGraph()
            with torch.cuda.graph(graph, capture_error_mode='thread_local'):
                result = original(**static)
            cache[key] = (static, graph, result)
        static, graph, result = cache[key]
        if not torch.equal(tensors['mask'], static['mask']):
            return original(**kwargs)
        for name, value in tensors.items():
            static[name].copy_(value)
        graph.replay()
        # Output aliases graph storage; native caller consumes it before reuse.
        return result

    decoder.forward = MethodType(forward, decoder)
    decoder._shahvex_graph = True
