# Post-FirstAudio physical measurements — 2 November 2026

No physical files, model settings, credentials or running services were changed. No deployment package was prepared.

## Evidence and limits

Recording: `C:\Users\UC\Downloads\Jenifer-2026-11-02T17-16-58-005Z.webm`, decoded duration 109.98 seconds. Browser relay: `e62f9b5b-91d8-4b65-99d2-5efe736cd93f`. Gateway session: `469becd5-47b2-4673-8ef1-c4f534b1bb8f`.

Gateway log: `%LOCALAPPDATA%\Shahvex\LocalServices\logs\gateway-db227b1cf4bb43cd8c186faaa47f3b67.jsonl`. Read through a shared FileStream, despite directory listing reporting zero length. Metadata-only copy: `dist/captured-gateway-db227b1cf4bb43cd8c186faaa47f3b67.jsonl`. Pre-patch copy: `dist/captured-gateway-2271ac6d2e8f4b578df70df102b54b71.jsonl`. Browser timing source: `.next/dev/logs/next-development.log`.

Run `node gateway/inspect-performance.cjs`. The inspector now handles a recording stopped through conversation shutdown without a recorded `recording-stop` event. It explicitly reports the recording duration as unknown instead of falling back to the previous recording. Observed event span is not recording duration.

## Measured stage durations

Seconds, successful first-audio turns only. VAD is 0.400s in every row. Playback means browser scheduling, not calibrated speaker onset.

| Run/turn | STT | LLM first token | LLM complete | TTS first PCM | Endpoint to playback scheduled |
|---|---:|---:|---:|---:|---:|
| Pre 1 | .890 | .557 | 1.056 | 7.203 | 9.151 |
| Pre 2 | .859 | .210 | .822 | 9.591 | 11.274 |
| Pre 3 | .912 | .347 | 1.459 | 10.436 | 12.809 |
| Post 1 | 1.003 | 2.734 | 3.231 | 5.309 | 9.544 |
| Post 2 | .935 | .255 | .723 | 3.039 | 4.699 |
| Post 4 | .877 | .298 | .746 | 4.193 | 5.816 |
| Post 5, interrupted later | .953 | .406 | 1.044 | 2.364 | 4.363 |

These are different conversational turns, NOT identical-text paired benchmarks. Individual turns correlate by their turn IDs in browser/Gateway evidence. No transcript was collected, so an identical question/reply comparison cannot be claimed. Post first-audio times improve in aggregate but do not achieve the target. STT and LLM remain serial; the Gateway waits for the completed LLM response before TTS, despite streaming tokens being measured.

## Independent recording alignment

Times below are seconds from browser recording-start; waveform boundaries use RMS silence threshold 500 and minimum 500ms, without invented transcripts or diarization.

| Post turn | Estimated mic speech end | Estimated device output | Nearby recorded quiet interval |
|---|---:|---:|---|
| 1 | 3.828 | 13.855 | 3.74–13.96 |
| 2 | 27.216 | 32.391 | 27.14–32.44 |
| 4 | 76.612 | 82.903 | 76.56–82.96 |
| 5 | 92.620 | 97.463 | 92.58–97.54 |

The recording supports response waits around 10.22, 5.30, 6.40 and 4.96 seconds for these turns, rather than labelling every long silence inference latency. User-supplied other interval values were not reproduced with this threshold.

At recording ~45.22s, a question reaches its endpoint, then new speech cancels its STT ~0.81s later. The replacement contains only ~100ms of detected speech, returns empty STT, and produces no answer. The ~29.86s quiet interval around 46.06–75.92s includes this lost turn and waiting, not 29.86s of completed TTS. Native STT drains before the replacement starts; no post-run HTTP429 was observed.

## First segment really is emitted early

Post turn 2 first PCM arrives at 17:15:40.260Z; whole TTS completes at 17:15:44.039Z. Browser playback is scheduled at endpoint+4.699s and recorded sound begins around recording 32.44s. This rules out waiting for every TTS segment before first playback for this turn. Post turn 4 likewise produces first PCM at 17:16:30.773Z, versus whole TTS completion at 17:16:32.741Z.

Final turn first PCM arrives at 17:16:45.328Z. Whole TTS has not completed when Stop cancels at 17:16:57.998Z. The recording ends with only ~1.28s of sound followed by ~11.16s quiet. A later-segment pipeline stall is a plausible contributor; current telemetry cannot distinguish native generation, its lock wait, HTTP transfer, and output backpressure for that segment. Do not call all of this GPU inference.

## Resident approved-voice benchmark

Three synthetic requests were attempted through the existing localhost `/synthesize`, using the existing voice unchanged. Authenticated Gateway readiness and zero sessions/queue were checked before requests and after successful requests. No audio was retained and no model was loaded by the benchmark client.

| Text characters | HTTP headers | Complete WAV | Audio duration | HTTP real-time factor |
|---|---:|---:|---:|---:|
| 12 | 1.1499s | 1.1500s | 1.040s | 1.106 |
| 48 | 2.2020s | 2.2021s | 2.960s | .744 |
| 81 | Unknown | FAILED receiving WAV: Windows 10054 connection reset | Unknown | Unknown |

The failed third sample is excluded, not presented as a slow successful synthesis. Chatterbox health still returned ready afterward. No automatic retry or restart was performed.

Exact GPU inference and lock wait cannot be recovered from the HTTP API. The physical wrapper prints inference duration and character count to its console but does not persist them or return timing headers. Gateway logs contain aggregate TTS duration, not first-segment character count. Therefore those historical character counts and native GPU durations remain unknown.

The wrapper loads Turbo and prepares Jennifer's reference once, outside requests, and warms it once. Each request serializes through a native lock, generates an entire segment, watermarks/converts it, then sends a complete WAV. Gateway segmentation is sequential. There is no evidence of per-request model reload. Cancellation of a TTS HTTP request cannot preempt native generation: a later request can still wait for the native lock. Current logs do not quantify that wait.

GPU snapshot before benchmarks: 7705/8188MiB used, 1% utilization. Later snapshot: 4682MiB, 9%. These snapshots show changing residency, not proof of contention during the recording. Do not unload Ollama or alter GPU allocations based on this alone.

## Concrete next action

Keep the approved voice and working configuration. First investigate the failed longer WAV and later-segment stall at the physical Chatterbox console, retaining only its existing `TTS <seconds> | <characters> chars | VRAM ...` output and any exception type. Next measurement should add metadata-only per-segment request-start, lock-acquired, generation-complete, WAV-ready, HTTP-complete and browser buffer-underrun markers under a separately reviewed change; no audio/text/credentials are needed. Do not deploy another Gateway package merely to shorten chunks again.

The same-voice 48-character request already costs 2.20s; adding observed ~.9s STT, ~.7s LLM and .4s endpoint means around 4.2s before playback in a serial pipeline. That is an estimate assembled from separate measurements, not a measured conversation. Under-three-second typical conversation is not demonstrated. Shorter meaningful replies and sentence-ready LLM/TTS pipelining merit controlled tests, preserving required disclosures and avoiding GPU overlap until measured. Do not use filler or blindly reduce decoder quality.

For an isolated alternative A/B, prioritize the upstream Chatterbox Nano candidate (same family, reference-audio support) or Pocket TTS CPU reference-voice synthesis. Use a separate reviewed environment and localhost port; never point the working contract at it. These alternatives are NOT installed or benchmarked on this PC; no speed or voice-equivalence claim is made. A new model can alter Jennifer's identity even with the same reference and requires explicit listening approval. Official references: https://github.com/resemble-ai/chatterbox and https://github.com/kyutai-labs/pocket-tts. Do not load additional GPU weights into the current near-full GPU simply to obtain a benchmark.

## Validation and rollback

16 focused Node tests passed: performance inspector, first-audio ordering, cancellation, multi-turn recovery/history, STT drain and timing privacy. The ten-turn test uses mocked engines; it is not ten spoken physical questions. Actual physical evidence here is the supplied recording, Gateway/browser traces and two successful resident TTS probes plus one failed probe.

Only diagnostic files were changed in the repository: `gateway/inspect-performance.cjs`, `gateway/benchmark_resident_tts.py`, `tests/gateway-performance-inspector.test.cjs`, and this report. Running physical configuration was untouched; no service rollback is necessary.
