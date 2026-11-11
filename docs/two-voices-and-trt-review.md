# Jenifer/Lissa catalog and acceleration attempt

## Current status: voice-quality rollback

The user reported that Lissa's voice changed after acceleration. The production
wrapper has now removed the five-step decoder override, TF32 precision overrides,
modified token polling and extra optimized-path warmup. It uses the original
native decoder and a 25-token initial hop, retaining cancellation safety and
Lissa speaker precaching. The idle cloning service was restarted. The installed
reference and original prepared Lissa reference have identical SHA-256 hashes:
`a18fe5631493cb0b83c1b20b06dfe94c09a2273c16c7cfe9147e79bb486a505e`.
The acceleration results below are historical, not the current production setup.
Voice fidelity takes priority; no one-second latency or listening-match claim is
made. Do not re-enable reduced-quality synthesis on the basis of STT alone.

The user requested only Jenifer and Lissa in the selector and a maximum one-second
response. The shared catalog now includes only `af_heart` (Jenifer) and `lissa`;
`localVoices` also filters the list, including when a remote backend returns legacy
voices. Existing voice files, registry history and saved agent choices were not
deleted. TypeScript and ten catalog/audio-streaming tests passed. Reloading the
adapter is still necessary for the catalog source change to become live.

## Actual acceleration work

Installed CosyVoice requires TensorRT 10.13.3.9. An initial unpinned download was
cancelled before installation after reading that requirement. The exact version
was downloaded and installed only under `.data/lissa-tensorrt-10-review`, not into
the running conda environment. Pip reported a CUDA runtime version conflict with
the installed Torch requirements; no production compatibility claim is made.

The isolated model-plus-builder benchmark parsed the existing 1.3 GB ONNX model,
but WSL's out-of-memory killer terminated the review process. No plan was created.
Both production voice health endpoints subsequently reported ready.

A second standalone builder avoided loading another PyTorch model and used a
512 MiB builder workspace, low builder optimization level and RAM watchdog. The
watchdog stopped it while parsing once its memory threshold was reached. No plan
was created and no live model was changed. The observed WSL allocation was roughly
15.8 GB RAM with almost all 4 GB swap occupied.

Reproducers: `deployment/lissa_trt_speed_review.py` and
`deployment/lissa_trt_build_review.py`. Both require explicit benchmark opt-in.
The standalone RAM guard exits rather than repeatedly forcing an OOM.

## Remaining limitation

The one-second end-to-end limit is not achieved. Prior best measured native TTS
candidate was 1464 ms, excluding transcription, dialogue generation, networking
and audible browser playback. No unsupported success claim, generic replacement
voice, fake filler latency, or emotion activation was used to conceal that limit.

## Completed follow-up

An idle-only build stopped the exact cloning service and restored it in a finally
block. With a 4 GiB builder workspace, TensorRT successfully produced the plan.
Its first-PCM measurements were 2443, 1968 and 2009 ms, slower than native TF32.
The plan was therefore not enabled in production.

Native TF32 with smaller initial hops was also tested: hop 10 started at 1129
and 938 ms but caused predicted playback gaps of up to 556 ms. Hop 15 also
produced gaps. Neither was deployed; the 938 ms result does not meet the user's
smooth, end-to-end one-second requirement.

The cancellation-safe service wrapper now enables TF32 on Ampere-or-newer GPUs
and resets the initial hop to 25 under the model lock for each streaming request.
This retains the gap-free candidate's chunk size and prevents subsequent replies
from inheriting a larger chunk. The exact idle cloning service was restarted.
Conversation prompts were not changed. Expressive mode remains gated off.

Lissa now precaches and warms at service startup. After the final restart, live
HTTP first-PCM timings were 1836, 1496 and 1583 ms, with no predicted playback
underflows in these three samples. Results: `.data/lissa-native-live-review.json`.
These are TTS-only measurements, not customer-end-of-speech to audible playback.
Ten catalog/audio tests and TypeScript checks passed. The Windows adapter still
needs an administrator reload for the source catalog and text cleanup changes.

## Lissa-only faster flow deployment

Tested a five-step flow decoder with initial hop 20, retaining the original
authorized reference, FP32 weights and TF32 math. Three seeded plain samples
started at 1008, 948 and 932 ms without predicted playback gaps. Six varied
samples, including native breath/laughter, started at 941–1191 ms without gaps.
Local STT recovered the intended words for all six and did not speak tag names.
This verifies intelligibility only, not subjective smoothness or speaker fidelity.

The live wrapper now applies these settings only to Lissa, under the model lock,
and restores the decoder even on failure. Set SHAHVEX_LISSA_FAST_FLOW=0 and reload
the voice service to revert to the ten-step/hop-25 path. Other voices retain their
decoder settings. The idle service was restarted and live HTTP measurements were
1236, 1084 and 1232 ms, with no predicted gaps in these three replies. Evidence:
`.data/lissa-fast-flow-live-review.json`. Full conversation latency remains above
the strict one-second requirement. Expression insertion remains opt-in and the
Windows adapter catalog/cleanup reload is still pending; prompts were untouched.

Validation: scoped-setting restoration test, 30 interrupted-stream cleanup
iterations, and ten speech/catalog/streaming tests passed. Short-reference plus
single-thread experiments were not deployed. No acoustic listening approval or
universal latency guarantee is claimed.

## Readiness polling and optimized-path warmup

Further chunk-size trials (16, 18, 22) and single-thread CPU trials did not show
a consistent improvement, so those settings were not deployed. Stage profiling
identified the native stream loop's 100 ms readiness polling. An instance-local
function binding now uses 10 ms only for that poll; process-wide time.sleep and
other instances remain untouched. Set SHAHVEX_LISSA_FAST_POLL=0 before service
restart to disable it. The service also drains one optimized-path warmup before
becoming ready; that audio is never played to callers.

After the idle service restart, six uncached live HTTP samples started at 1107,
1048, 1070, 1082, 1210 and 1157 ms with no predicted underflows. The three texts
shared with the preceding run changed from 1236/1084/1232 to 1107/1048/1070 ms.
These small samples show a modest improvement, not a statistical latency bound.
Evidence: `.data/lissa-fast-poll-live-review.json`. Offline STT recovered intended
words from all six polling-review samples, including native expression tags.
Instance isolation/idempotence, decoder restoration, and 30 interrupted-stream
cleanup checks passed. No script/prompt, expression activation or Windows adapter
reload was included. The strict one-second end-to-end target remains unmet.
