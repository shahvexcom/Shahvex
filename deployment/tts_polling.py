"""Shorten only the model instance's token-readiness poll, not global sleeps."""
from types import FunctionType, MethodType


def configure_stream_polling(native):
    if getattr(native, '_shahvex_fast_poll', False):
        return
    original = native.tts.__func__
    original_time = original.__globals__['time']

    class LocalTime:
        def sleep(self, seconds):
            return original_time.sleep(0.01 if seconds == 0.1 else seconds)

        def __getattr__(self, name):
            return getattr(original_time, name)

    scope = dict(original.__globals__, time=LocalTime())
    configured = FunctionType(original.__code__, scope, original.__name__,
                              original.__defaults__, original.__closure__)
    configured.__kwdefaults__ = original.__kwdefaults__
    native.tts = MethodType(configured, native)
    native._shahvex_fast_poll = True
