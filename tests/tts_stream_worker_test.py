import asyncio
import sys
import threading
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / "deployment"))
from tts_stream_worker import threaded_pcm

async def main():
    lock = threading.RLock()
    completed = []
    def inference():
        with lock:
            owner = threading.get_ident()
            for index in range(12):
                assert threading.get_ident() == owner
                time.sleep(0.002)
                yield b'pcm'
            completed.append(True)
    for _ in range(30):
        stream = threaded_pcm(inference)
        assert await asyncio.wait_for(anext(stream), 2) == b'pcm'
        await stream.aclose()
    chunks = [chunk async for chunk in threaded_pcm(inference)]
    assert len(chunks) == 12
    assert len(completed) == 31, len(completed)
    def broken():
        raise ValueError('fixture')
        yield b''
    try:
        async for _ in threaded_pcm(broken()):
            pass
        raise AssertionError('Expected failure')
    except RuntimeError:
        pass
    print('PASS 30 interrupted lock-owning streams, subsequent synthesis, thread affinity, error propagation')

asyncio.run(main())
