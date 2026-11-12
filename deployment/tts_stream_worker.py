"""Keep a lock-owning synchronous inference iterator on ONE thread.

On HTTP disconnect finish inference while discarding output, so model locks and
the model's own generator state are released normally. Never abandon a generator
that holds an RLock inside Starlette's per-next-call thread pool.
"""
import asyncio
import queue
import threading


async def threaded_pcm(factory, *, cooperative=False):
    output = queue.Queue(maxsize=4)
    stopped = threading.Event()
    done = threading.Event()
    failures = []

    def produce():
        try:
            for chunk in (factory(stopped) if cooperative else factory()):
                # Keep iterating on disconnect, but do not enqueue stale audio.
                while not stopped.is_set():
                    try:
                        output.put(chunk, timeout=0.05)
                        break
                    except queue.Full:
                        pass
        except Exception as exc:
            failures.append(exc)
        finally:
            done.set()

    threading.Thread(target=produce, daemon=True, name="cosyvoice-stream").start()
    try:
        while not done.is_set() or not output.empty():
            try:
                chunk = output.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.01)
                continue
            yield chunk
        if failures:
            raise RuntimeError("Speech synthesis failed") from failures[0]
    finally:
        stopped.set()

