# Minimal first-audio candidate — review only

**Production unchanged. No inference, TTS, model loading, deployment, restart, maintenance or credential change occurred.**

## Diagnosis that is supported

The exact96.18second recording and ending were inspected offline. Provisional response waits are6.24–6.42,5.04–5.12,6.82–6.86,4.26–4.32 and4.14–4.46seconds. Customer thinking pauses were excluded. The largest identifiable wait is the AI-explanation response. Main final wording is reconstructed as “Of course. Please go ahead. I'm all ears.” The subsequent tail is uncertain; its source and any stale-audio event are unproved.

No matching stage/event logs have been recovered: current November3Gateway logs are empty, the current Next log contains no voice session, no browser event file was saved, and current services began after the recording. Per-turn VAD endpoints, STT completion, LLM first phrase, TTS request/validated PCM, scheduled playback, cancellation and completion must therefore remain unavailable. Nominal400ms VAD is configuration, not measured endpoint delay. See `dist/Client-Demo-20261103-135540/REVIEW.md`; no new ASR was run for this candidate.

Historical first-PCM median3.026s is the largest measured component **of the historical session**, not an attributed component of this recording. Source inspection and existing streaming tests show TTS starts before complete Ollama output and later sequential synthesis can overlap earlier playback. Prior measured phrase handoff0–1ms is not the bottleneck. No artificial pipeline reordering, VAD change or model residency change is justified.

## Exactly what changes

`gateway/concise-opening-review.cjs` adds one default-OFF local wrapper around the **existing single Ollama call**. For an explicitly approved exact script hash only, it adds a short optional-language instruction before the untouched assigned-script suffix: answer directly, use a complete substantive short opening where allowed, avoid optional introductory filler and retain required openings/wording. It never rewrites emitted text, removes words, buffers a full reply or changes model request options. History and output deltas remain original. No emotional classifier, new model or second call exists.

The candidate `dist/Concise-Opening-Review-v1/server.cjs` differs from the deployed baseline only by importing that wrapper and wrapping the default services factory. No core/audio/services/TTS/browser file is patched. Wrapper and entry point are staged, not deployed. `SHAHVEX_CONCISE_OPENING_REVIEW` is unset/OFF by default. Agent Intelligence is neither used nor enabled.

This is a model phrasing hint, **not deterministic semantic compliance enforcement**. It preserves script/instruction bytes; output accuracy still requires review. No claim is made that prompts alone guarantee mandatory-word compliance. Unclassified or changed scripts receive byte-identical baseline requests. Approval must be explicit and trusted locally; client-supplied flags cannot authorize it. Policy example (synthetic only; do not invent Jennifer approval):

```json
[{"scriptSha256":"<SHA256 of the complete current assigned script>","allowOptionalPhrasing":true,"approvalReference":"<real optional-language authorization>"}]
```

No real campaign approval is supplied. Without verified optional-wording permission, this feature must remain OFF for Jennifer. Required long openings remain long; do not shorten them to meet a latency target.

## Why test this instead of another pipeline patch

Completed native concise-opening evidence:30replies,66sequential TTS requests,zero integrity failures. Eligible optional cases had first validated PCM medians2714.16→1602.88ms. This supports testing reduced optional opening workload with the unchanged voice, not a predicted browser saving or proof of naturalness. The authored benchmark texts differ from generated actual campaign responses. The wrapper's generated phrase lengths and audio still need measuring. Smaller phrases can uncover later synthesis gaps.

## Validation and rollback

Focused tests verify default-OFF identity, hosted/intelligence refusal, explicit permissions, script-hash invalidation, exact mandatory/script/history request preservation, one call, unchanged deltas, first PCM before model completion, sequential TTS and cancellation. Existing streaming/cancellation tests remain applicable. Full run:154passed,5existing skips,zero failures. Both candidate files pass node --check.

Manifest pins original server SHA256 `ED75E21F899FA71F42910C2B8E6AF61BE380C995373128E520C71F3860725BF6` plus both candidate hashes. Do not overwrite the physical Gateway. After separate approval, stage the two files over a **new isolated copy** of the eight verified baseline runtime files, using the existing private engine contract and existing DPAPI token; no credential copies or regeneration. Bind the review listener to a different loopback port and use a separately approved local backend target switch. Do not reuse a Groq launcher or a controller patch enum that does not support this candidate.

Before review launch, require authenticated maintenance/ready/zero-activity evidence and safe GPU headroom. If a cold Ollama load cannot meet the reviewed safety gate, keep the experiment blocked rather than pin/preload/unload models. The candidate changes no keep-alive setting.

Rollback after an approved isolated test: stop only the review child; restore the backend process's original Gateway URL `http://127.0.0.1:8787` under the approved backend-restart procedure. Unset the candidate process-only flag and approval-file path for subsequent launches. Original Gateway/Whisper/Ollama/Chatterbox files and processes need no restoration. Do not delete logs or apply a different release. No rollback action is needed now because no process/configuration was changed.

## One later browser test, not authorized/executed here

Use the same assigned script and five customer questions, with one interruption, in a continuous consented two-sided recording. Download the recording and browser timing array **before leaving the page**. Save Gateway/TTS timing stdout for that same session. Record per turn: microphone speech end; measured endpoint delay; STT; first meaningful phrase and its character count; first validated TTS PCM; recorded audible onset; complete reply; audible phrase gaps; errors/cancellation. Separate thinking pauses and interrupted turns from successful-response statistics. Review final-response words and tail against exact generated text and played audio.

Acceptance: target median<=3s; report actual median/maximum and compare like-for-like metrics; no mandatory/fact violations, duplicated/stale audio, WAV integrity failures or unnatural ending. Include real audible phrase gaps and interruption behavior. This candidate is **not a fix for the unclassified final-tail defect**. Any failure keeps client-demo status NO-GO; no automatic retries, voice substitution or concealed tail trimming.
