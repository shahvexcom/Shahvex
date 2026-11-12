"""Experimental equivalent FP32 nucleus sampling with one host synchronization.

Preserves stable sorting, FP32 sequential accumulation, top-p/top-k, selected
probabilities, original multinomial draw, repetition policy and RNG consumption.
"""
import functools
import struct
from types import FunctionType


def configure_sampling_sync(llm):
    import torch
    if getattr(llm, '_shahvex_sampling_sync', False):
        return
    selected = llm.sampling
    base = selected.func if isinstance(selected, functools.partial) else selected
    if base.__name__ != 'ras_sampling':
        raise ValueError('Only the installed ras_sampling policy is supported')
    original = base.__globals__['nucleus_sampling']
    def f32(value):
        return struct.unpack('f', struct.pack('f', value))[0]
    def nucleus(weighted_scores, top_p=.8, top_k=25):
        if weighted_scores.dtype != torch.float32 or not weighted_scores.is_cuda:
            return original(weighted_scores, top_p=top_p, top_k=top_k)
        values, indices = weighted_scores.softmax(dim=0).sort(descending=True, stable=True)
        # One device transfer replaces per-candidate .item()/bool synchronizations.
        candidates = values[:top_k].tolist()
        cumulative, count = 0.0, 0
        threshold = f32(top_p)
        for value in candidates:
            if cumulative >= threshold:
                break
            cumulative = f32(cumulative + value)
            count += 1
        return indices[:count][values[:count].multinomial(1, replacement=True)].item()
    configured = FunctionType(base.__code__, dict(base.__globals__, nucleus_sampling=nucleus), base.__name__, base.__defaults__, base.__closure__)
    configured.__kwdefaults__ = base.__kwdefaults__
    if isinstance(selected, functools.partial):
        configured = functools.partial(configured, *selected.args, **selected.keywords)
    llm.sampling = configured
    llm._shahvex_sampling_sync = True
