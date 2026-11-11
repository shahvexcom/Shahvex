# Lissa expression and latency review

## Follow-up native acceleration experiments

After approval access resumed, two isolated, memory-capped experiments ran using
the installed weights on the RTX 3090. Neither changed the live service.

- TF32 with the original Lissa reference and native 25-token first chunks:
  1528, 1464 and 1474 ms to first PCM. No measured playback underflow on these
  three samples. STT recovered the intended sentence.
- FP16 with a 3.39-second complete excerpt of the same authorized recording:
  1558, 1877 and 1611 ms. One sample had a 163 ms predicted playback underflow.
  The excerpt and sample transcript matched in local STT. This candidate was
  rejected for activation because it did not meet the latency or smoothness goal.

Artifacts: `.data/lissa-speed-tf32` and `.data/lissa-short-speed-fp16`.
Reproducers: `deployment/lissa_speed_review.py` and
`deployment/lissa_short_speed_review.py`, requiring explicit benchmark opt-in.
The installed cloning environment has ONNX Runtime but neither TensorRT nor
vLLM. No packages were installed. These measurements still exclude STT, language
model, network and actual speaker playback. A one-second end-to-end limit remains
unachieved; these experiments are not deployment approval or proof of that limit.

Status: **the requested sub-800 ms response requirement is not met**. Expressive
mode remains OFF. No agent script, conversation prompt, model parameters, reference
voice, VAD timing or playback rate was changed by this work.

## Audio-layer changes

`gateway/speech-text.cjs` removes emoji sequences and non-spoken markers such as
`[interrupted]` before synthesis. Existing numbers, currency normalization and
ordinary words remain. Recognized unsupported emotion labels are stripped instead
of being spoken literally. The streaming worker applies normalization once, skips
marker-only output, retains ordered PCM, and preserves cancellation behavior.

The opt-in `SHAHVEX_LISSA_EXPRESSIVE=1` path maps explicit laugh/chuckle, breath and
sigh tags to installed CosyVoice3 native tokens. It is restricted to voice `lissa`
and at most one event per response. This flag was **not enabled**. No additional
model call, automatic random laughter, prefixed breath/filler, extra hold time or
playback slowdown was introduced. Automatic situation-based emotion selection and
occasional untagged breathing are not implemented by this change.

Installed token definitions were inspected directly. `[laughter]`, `[breath]`,
`[quick_breath]` and `[sigh]` exist. No verified surprise/gasp control was established.
The installed streaming model only supports its speed parameter in non-streaming
finalization; no unverified speed knob was added.

## Native measurements

Sequential requests to the existing local `/stream` endpoint, selected voice Lissa.
The clock starts before the HTTP request and ends at receipt of PCM containing
samples above the audible-energy threshold. This is TTS-only time, not actual
speaker playback, microphone endpointing, transcription or language-model latency.

| Input | First audible PCM (ms) |
| --- | ---: |
| Normal two-sentence reply, first sample | 2961 |
| Same reply with `[quick_breath]` | 2286 |
| Reply with `[laughter]` | 2048 |
| Normal two-sentence reply, repeated | 2489 |
| `Okay.`, warm | 1470 |
| `Is now an okay time?` | 1814 |
| `Okay.`, repeated warm | 1344 |

Raw WAVs and JSON are private under `.data/lissa-expression-review`. The small
sample set does not establish p95, load performance, or any bound on all calls.
Even the best measured warm short reply misses the 800 ms limit before the rest
of the conversation pipeline is included. Faster numbers for one tagged sample
do not prove that expression improves performance.

Local STT recovered the expected spoken words from the breath and laughter
samples without reading the tag names. This does not establish acoustic quality,
emotion suitability or speaker similarity; listening review remains necessary.

## Verification and activation

TypeScript passed and nine speech-normalization/streaming tests passed, including
split markers, marker-only text, emoji sequences, native effect throttling,
currency preservation, ordered playback and interruption cancellation.
No production adapter restart or deployment was performed for this revision.
The cleanup is implemented in source; the expressive feature remains gated off
because the user's combined performance and quality acceptance criteria failed.

Achieving the target for uncached, dynamic Lissa speech requires further engine
acceleration or a different cloning backend and a measured end-to-end trial. A
cache of fixed phrases would not establish the requested bound for arbitrary
responses. No claim of a completed sub-800 ms solution is made.
