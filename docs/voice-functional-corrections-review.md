# Targeted voice corrections — repository only

No physical services were stopped, patched or restarted. No models, reference audio, scripts, UI, recording code, credentials or database were changed. These corrections require explicit deployment approval; they are not claimed physically verified.

## Reproduction and corrections

### False barge-in

The new regression failed against the original AudioStream: five voiced 20ms frames followed by silence changed the active generation from 1 to 3, cancelling a real pending answer and scheduling a replacement. This reproduces the observed 100ms false interruption without using customer audio.

`gateway/audio-stream.cjs` now requires eight consecutive above-threshold frames (160ms) before interruption, clear or speech-start. Initial frames are retained. Sub-threshold candidates reset without an STT call. The existing 400ms endpoint is unchanged. Confirmation can be configured through the constructor (`onsetFrames`, allowed 6–15). Sustained noise or echo can still pass energy VAD; this is not a neural speech classifier. Genuine words shorter than 160ms may also be rejected; physical short-answer and headset tests remain necessary.

### Native cancellation and hidden synthesis queue

The deployed Python wrapper blocks additional HTTP handlers on its lock. Aborting the Gateway HTTP request does not cancel native GPU inference. The Gateway could previously release its queue worker while that work continued, admitting subsequent work that then waited on the native lock.

`gateway/services.cjs` now drains accepted Chatterbox WAV responses, with the existing 60s bound, before releasing the queue worker, matching the existing Whisper drain policy. Cancellation still clears playback immediately; drained stale audio is discarded, later segments are not requested, and cancelled history is not committed. It does not retry a failed/uncertain synthesis request. A timeout or broken connection cannot prove that native inference ended; the reviewed Python admission gate provides the separate overlap safeguard. Native work itself is not forcibly preempted.

### HTTP disconnect handling and native admission

The read-only physical source SHA256 at review was `F43E647D0B32C88D45E61E6A9E46CF9F407281E027D11EE0D0A894758D85A234`.

An isolated fault-injection test compiled only its Handler class, without importing torch or loading models. A simulated Windows 10053 body-write failure caused the original outer handler to attempt a second HTTP response after the WAV's 200 headers. This is a confirmed defect; it does not prove the cause of the earlier real 10054 reset.

The review copy at `gateway/reviewed-chatterbox/chatterbox_voice_server.py`:

- Handles header/body/flush socket errors without attempting a second response.
- Sends bounded 64KiB writes and explicit connection-close framing.
- Rejects overlapping native requests promptly with HTTP429 rather than building a lock queue; native inference remains single-job.
- Releases the lock on native exceptions and allows the next request to recover.
- Logs only request ID, character count, synchronized native synthesis wall time, WAV-ready time, audio duration, byte count, transfer duration, GPU allocated/reserved bytes and safe exception type.

The model class, model loading, Jennifer reference path, prepared conditioning, warmup and `MODEL.generate(text.strip())` parameters remain unchanged. The wrapper still returns a full WAV, not native streaming audio. The logged native synthesis time includes generation and synchronization; it is not isolated GPU kernel execution time.

An isolated loopback HTTP test transferred 2,000,044 WAV bytes intact (41.667 seconds synthetic mono PCM16 at 24kHz). Transfer was about 2ms. A concurrent request was rejected within one second while the simulated first synthesis remained active. Simulated generation failure returned HTTP500, released the lock, and the next full WAV succeeded. These are transport/concurrency tests using fake synthesis and fake GPU counters, not native model performance results.

## Actual unchanged physical-service measurement

One authenticated-idle-guarded repeat of the same synthetic 81-character sample through the existing approved voice succeeded:

| Measurement | Result |
|---|---:|
| HTTP headers / complete native WAV available | 1619.2ms |
| Complete WAV received | 1619.4ms |
| Received bytes | 211244 |
| Generated audio | 4.400s |
| HTTP real-time factor | 0.368 |
| GPU memory before / after | 4737 / 4736MiB |
| GPU utilization snapshots before / after | 6% / 87% |

No raw audio was saved or played, and no live conversation history was used. The benchmark client now reports headers/expected bytes and bounded incremental reads, plus safe failure metadata. The prior longer sample's reset did not recur in this single repeat. Sampling stochastic synthesis once cannot establish typical latency or long-run reliability. Ollama `/api/ps` returned no resident models after this probe, whereas the earlier snapshot used ~7705MiB: residency differs from an active full conversation. This does not establish GPU contention as the cause.

The current API cannot expose native lock wait or GPU-only execution time, and original Chatterbox console timings were not persisted. Exact native cause of the historical later-segment stall remains unverified. Use the reviewed wrapper's metadata after approved deployment to distinguish generation, transfer and admission; do not label all silence GPU inference.

## Latency and continuity verdict

Actual latest browser endpoint-to-first-playback scheduling remains 4.363–9.544s; no patched physical browser measurements exist yet. The supplied recording verifies audible response waits around 4.96–10.22s on matched turns, with a separate false-interruption gap and final unfinished-reply gap.

The native 1.619s success demonstrates that the resident voice can produce this short sample quickly on the RTX4060. Combining that sample with separate observed STT ~.9s, warm complete LLM ~.7s and endpoint .4s estimates ~3.6s plus playback overhead in the current serial pipeline. This is a budget estimate, not a measured conversation. Typical under-three-second complete-system response is not demonstrated; hardware capability cannot be ruled out, but shortening endpointing alone cannot guarantee it. No quality reduction or model substitution was made.

## Validation

52 Gateway Node tests pass, covering authorization/local-only gates, recording, scripts/history, isolation, streaming, barge-in, native STT/TTS drain, cancellation and cleanup. Four Python tests pass, including real loopback long-WAV transfer, concurrency rejection, recovery after native failure, and AST verification of unchanged model, reference voice and generation arguments. Ten-turn conversation tests are simulated engines, not ten physically spoken questions. Existing speech fixtures were lengthened from 20/100ms to 200ms so that ordinary transport/multi-turn tests represent confirmed utterances; the separate 100ms regression verifies rejection.

Commands from `P:\shahvex`:

```powershell
$tests=@(Get-ChildItem tests -Filter 'gateway*.test.cjs' | ForEach-Object {$_.FullName})
& node --test @tests
& 'C:\Shahvex-AI\.venv\Scripts\python.exe' -B tests/chatterbox_transport_test.py
```

The Python regression reads the current physical Handler source for the original-behavior check only; it imports no model modules and never binds port8765. Synthetic HTTP tests bind a temporary loopback port.

## Review boundary

Runtime changes are limited to `gateway/audio-stream.cjs`, `gateway/services.cjs` and the reviewed Python copy. Test/diagnostic changes include `gateway/benchmark_resident_tts.py`, new `tests/gateway-barge-confirmation.test.cjs` and `tests/chatterbox_transport_test.py`, plus existing endpoint, first-audio, integration, physical-bridge and multi-turn test fixtures. No deployment ZIP/controller/authentication changes were made.

Physical deployment must be explicitly approved and use verified current-file hashes, separate backups of these three runtime files, authenticated maintenance/drain and the existing trusted restart configuration. Restoring those exact backups is the rollback; no token/model changes are required. Do not replace the physical Chatterbox script while its process is running. No rollback is needed now because all physical files remain untouched.

After approved deployment, record at least five questions including a natural pause, a short yes/no answer, 100ms incidental sound and an intentional interruption. Match native request IDs/character counts/synthesis and transfer times to Gateway turns and browser playback; verify full subsequent sentences, follow-up history, recording download and zero sessions/queue after Stop. Until then, functional physical success and sub-three-second latency remain unverified.
