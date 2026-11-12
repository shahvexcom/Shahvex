# Lissa native recovery and speed review — 2026-11-11

The one-second end-to-end response requirement is **not achieved**. The live
recovery patch is active; the speed experiments below are not active. Lissa and
Jenifer remain available. There is no measured evidence that removing Jenifer's
catalog entry would solve the Lissa decoder bottleneck.

## Activated recovery changes

The installed CosyVoice token worker sets its finished flag only on normal
completion. An exception leaves the consumer polling indefinitely. The supervised
worker now records the failure, signals completion in `finally`, propagates a
controlled stream error and cleans per-request state. This reproduces a native
failure path; it does not prove the user's original microphone incident had that
exact cause.

On disconnect, the previous HTTP producer drained the entire cancelled synthesis
while holding the model lock. The producer now supplies a cooperative event.
Queued cancelled requests skip inference; active token generation stops at a
token boundary, stale decoding is skipped, and the native loop drains through
cleanup on its original producer thread. Cancelled empty outputs are filtered
before the public facade's duration/RTF calculation. No unplayed output is added.
The native worker is joined before exceptional cleanup removes its state.

Native token readiness polls every 10 ms instead of 100 ms, scoped to the model
instance. Original FP32 precision, ten-step decoder, initial hop 25, playback
rate, model weights, prompts and reference recording remain. Graph replay,
reference caching, optimized sampling and reduced-step synthesis are not used by
the live wrapper.

Activation restarted only `shahvex-port-8767.service` after authenticated adapter
status reported sessions=0/busy=0 and the restart helper checked for established
TTS connections. Health returned ready and cached voice `lissa`. Reference SHA256
before/after is
`a18fe5631493cb0b83c1b20b06dfe94c09a2273c16c7cfe9147e79bb486a505e`.
Backup: `.data/lissa-before-native-lifecycle`; activation metadata:
`.data/lissa-lifecycle-activation.json`. The Windows adapter was not restarted.

## Verification

- Four native lifecycle unit tests, the existing 30-interruption producer test
  with an added cooperative-disconnect assertion, polling isolation tests, 17
  browser/input/session tests and TypeScript passed.
- Isolated real-model token-worker error released in 11 ms. Cancellation at
  10/250/1800 ms released 45/37/17 ms after cancellation. Following synthesis
  returned 65,280 bytes, with empty native request-state dictionaries.
- Chrome worklet test: synthetic barge-in detected at 208 ms, silence within the
  25 ms check, stale epoch rejected, next audio resumed. The 130.95-second soak
  completed 130 playback rounds. This fixture excludes STT/LLM/Lissa.
- Live Lissa HTTP soak: 135.8 seconds, 32 requests, seven deliberately disconnected
  long streams, all subsequent requests returned PCM. Artifact:
  `.data/lissa-live-recovery-soak.json`. Completed requests started at
  1501–2371 ms to first received PCM. These are TTS-only synthetic requests;
  microphone endpointing, STT, LLM, network routing and device output add time.

The browser worklet and native HTTP tests are separate. They do not constitute
a real acoustic microphone-to-Lissa conversation or subjective listening review.
The original two-minute incident has not been reproduced with the user's mic.

## Speed evidence and rejected activation

The earlier Jenifer fixture used Kokoro and measured 760–800 ms from speech end
to worklet playback. Lissa uses the separate CosyVoice cloning model. With native
FP32 and original hop/steps, isolated profiling measured 698–920 ms before the
first token-to-wave call and 812–833 ms inside that first call.

Bounded CUDA graph replay of the original ten-step flow was tested. Synchronous
noise transfer and attention-mask validation required capture preparation;
capturing while the independent token worker sampled also failed. Preparing with
fixed tokens allowed an identical-PCM check, but six warm full TTS samples still
started at 1416–1569 ms. Graphs remain off.

A guarded causal-reference cache and equivalent FP32 sampler synchronization
experiment also preserved fixed-token PCM. The sampler matched the original
draw/RNG result on 100 seeded synthetic distributions. The cache reported 70 hits
and 10 initial misses. Six TTS first-PCM samples were
1493/1486/1476/1568/1554/1529 ms. These limited checks do not establish universal
quality or performance, and the candidate misses the target, so it remains off.

Reproducer: `deployment/lissa_graph_review.py`, requiring
`SHAHVEX_LOCAL_TTS_COMPARE=1`. Additional review flags select lifecycle checks,
reference caching or sampler synchronization. Results remain private under
`.data/lissa-original-*-review`. Do not enable these candidates based on this
review. No sub-second or completed overall-task claim is supported.
