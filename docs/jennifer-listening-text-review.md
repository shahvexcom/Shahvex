# Jennifer listening comparison — text approval stage

No audio generated, live service requests, production edits, restarts or deployment. Current voice, generation settings and 40-character threshold remain unchanged.

## Important source limitation

These are **authored synthetic pairs** derived from the existing `gateway/style-review/scenarios.cjs` fixture, not newly generated Ollama responses or historical Jennifer replies. Its appointment detail is explicitly synthetic. Jennifer's approved exported campaign script and permitted optional regions were not available in the inspected review files. Do not use these fixture facts in customer conversations. Actual campaign compliance is pending that source; fixture equality alone does not establish approval. No new optional phrasing has been introduced beyond the existing review examples.

## Exact text pairs

The baseline is identical for all five synthetic scenarios:

> I am Jennifer, an automated assistant. The sample appointment lasts 20 minutes. May I continue?

**Neutral** — customer: “How long is the appointment?”

Style-aware:
> I am Jennifer, an automated assistant. The sample appointment lasts 20 minutes. May I continue?

Difference: none. Intent neutral. This identical-text control helps identify normal synthesis variation.

**Friendly** — customer: “Hello, Jennifer.”

Style-aware:
> Hello, thanks for speaking with me. I am Jennifer, an automated assistant. The sample appointment lasts 20 minutes. May I continue?

Difference: prepends “Hello, thanks for speaking with me.” Intent warm.

**Hesitant** — customer: “I'm not sure I understand. Can you explain?”

Style-aware:
> I can clarify the appointment details. I am Jennifer, an automated assistant. The sample appointment lasts 20 minutes. May I continue?

Difference: prepends “I can clarify the appointment details.” Intent reassuring, based on the explicit clarification request, not inferred hesitation in speech.

**Concerned** — customer: “I am worried about the appointment.”

Style-aware:
> We can go through the details. I am Jennifer, an automated assistant. The sample appointment lasts 20 minutes. May I continue?

Difference: prepends “We can go through the details.” Intent reassuring; no outcome promise.

**Serious** — customer: “What am I agreeing to?”

Style-aware:
> Please review the following information. I am Jennifer, an automated assistant. The sample appointment lasts 20 minutes. May I continue?

Difference: prepends “Please review the following information.” Intent serious, set by the synthetic consent-step policy, not a guess about customer emotion.

All pairs retain the fixture disclosure, 20-minute fact and consent question **verbatim and in the same order**. No required text is deleted or substituted. Optional openings precede the disclosure only because this synthetic fixture permits them. If the real script requires disclosure first, these openings must move to an approved location or be omitted before approval.

The examples test optional wording only. They do not demonstrate four independently controllable Turbo acoustic emotions. Added acknowledgements can also lengthen the answer or sound repetitive; assess this rather than assuming improvement.

## Approval gates

1. Supply the local approved Jennifer export/script path. Validate exact mandatory spans, workflow, disclosure position and permitted optional regions; revise these pairs if needed.
2. Approve the resulting exact ten texts before synthesis. If actual Ollama outputs are desired, request an isolated native text-generation run separately; review those outputs before any audio. No model-generated-text evaluation has occurred here.
3. Separately approve live Chatterbox use and a quiet window. Immediately before testing, the protected signed-in local health endpoint must show HTTP 200, authenticated=true, ready=true, maintenance=true, activeSessions=0, queue.active=0, queue.pending=0, activeRelays=0, startingRelays=0. Confirm no direct AI tests or other native synthesis are running; Gateway counters cannot prove that by themselves. Stop if any check fails. Do not restart services or change settings.

## Proposed audio comparison after approval

Use only Jennifer's existing prepared reference and current text-only `/synthesize` contract. No model reload, alternate voice, emotion/speed parameters, seed/settings change or controller deployment. Keep the same existing PhraseStream and 40-character first-clause threshold for both variants; do not create a separate sentence splitter.

Generate sequentially: five scenarios × two variants × three randomized repeats = 30 complete replies. Never overlap native synthesis or automatically retry transport failures. Each approved phrase request must drain fully before another; stop the run on a transfer-integrity error and retain the failure record. Apply bounded existing diagnostic timeouts, not arbitrary increases. The previous intermittent WAV transfer issue is still relevant; successful isolated transfers do not resolve it.

Save labeled source WAVs such as `neutral-baseline-r1.wav` and `neutral-style-r1.wav` in a new local results directory. Create blind copies with opaque random sample IDs; keep the variant key in a separate file unavailable to listeners. Preserve the native WAV sample rate, channels and PCM; do not normalize, pitch-shift or time-stretch. If assembling phrase WAVs, validate each header/body and combine PCM with a valid new WAV header. Keep individual phrase files and timings as well. Store metadata separately from audio; no tokens, reference audio or customer data in logs.

Measure with a monotonic clock, per phrase: request start, headers received, first valid PCM received, body complete, declared/received bytes, validation result, and HTTP/socket errors. Also record full reply wall time, audio duration and phrase boundaries. Distinguish first PCM transfer from first **playable** audio: a complete-body validating client cannot play at its first received byte. Native GPU inference time remains unavailable unless existing server telemetry exposes it; never label header-wait time as inference time.

For a playback comparison, use the unchanged ordered browser playback pipeline and capture actual playback timing. Report scheduled gaps separately from measured audible gaps; listening to concatenated WAVs alone cannot measure real-time pipeline gaps. Text-to-first-PCM and playback measurements are not customer-speech-end latency; no STT/VAD/Ollama delay is measured by direct TTS synthesis. Report failures with their denominator and only compute valid timing percentiles over successful, properly attributed trials.

Blind listeners rate naturalness, warmth/appropriateness, rhythm, clarity, repetition and Jennifer voice identity. Audit required text and factual content again against the real script. Compare paired first-playable/audio and complete-reply timing, p50/p95/worst, gaps and failures; keep the identical neutral control. Three repeats are exploratory, not a statistical guarantee. Pre-agree a practical regression threshold (for example 100 ms or 5% in paired first-playable latency). Extra opening words can cause additional synthesis time; measure rather than promise zero overhead. Retain baseline if benefit is unclear, content changes, delivery worsens or additional latency is unacceptable.

## Current results

Text/fixture checks only. No WAVs, native synthesis timing, actual Ollama outputs, listening ratings or naturalness improvement are claimed. The style-controller patch remains undeployed. Machine-readable exact pairs: `dist/Jennifer-Listening-Text-Review.json`.
