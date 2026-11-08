# Incremental Ollama → Chatterbox review — not deployed

## Confirmed existing buffering

Actual archived Gateway log: `dist/captured-gateway-db227b1cf4bb43cd8c186faaa47f3b67.jsonl`, matched browser relay `e62f9b5b-91d8-4b65-99d2-5efe736cd93f`. Times are UTC on 2 November 2026.

| Turn prefix | First token | First text chunk | LLM complete | TTS start |
|---|---|---|---|---|
| 1b318ac9 | 17:15:15.910 | Not recorded | 17:15:16.407 | 17:15:16.407 |
| 7e167fc4 | 17:15:36.752 | Not recorded | 17:15:37.220 | 17:15:37.221 |
| 837cef7c | 17:16:26.133 | Not recorded | 17:16:26.580 | 17:16:26.580 |

The old adapter parsed streaming NDJSON but accumulated and returned one complete string. Core awaited it before invoking TTS. No intermediate text-chunk event existed, so its historical timestamp cannot be reconstructed. FirstAudio segmented that completed string; it did not stream partial Ollama text into synthesis.

## Repository implementation

`gateway/services.cjs` delivers each validated Ollama content delta to the new callback while continuing to read NDJSON. It retains UTF-8 handling, localhost/redirect restrictions, the existing model and stream setting, byte/character limits and timeout. Nonstreaming adapters remain compatible, but cannot provide early phrases. The working physical contract is not edited.

`gateway/phrase-stream.cjs` retains unfinished words and forms bounded text phrases from complete sentences or clauses. It waits for separator evidence after punctuation; abbreviations and decimal numbers are protected. Ordinary sentence chunks require at least24 characters, clauses40. Oversized unpunctuated output uses whole-word boundaries within300 characters to satisfy the existing native limit; grammatical clause completeness cannot be guaranteed for punctuation-free model output. A final complete model response can legitimately be short. Nothing is paraphrased, filled, reordered or truncated. Total reply remains bounded at16000 characters, with at most1024 queued phrases. No phrase text is logged.

`gateway/core.cjs` runs the LLM reader and one sequential TTS consumer together. First synthesis starts when the first phrase is ready, while the producer can finish later text. Each returned valid PCM frame is forwarded through the existing generation-aware audio transport immediately. Only one native Chatterbox request is accepted from the consumer at a time. Accepted STT/TTS work still drains under the existing bounds before another queued turn proceeds; cancellation clears playback and rejects stale frames, pending text and history. A genuine LLM failure remains distinguishable from interruption, even when it cancels the internal pipeline during native synthesis. The full original reply is committed to history only after successful audio delivery, preserving the complete dynamic script and existing conversation memory rules.

The browser playback queue already schedules PCM in order and can play the first phrase while the next synthesizes. It is unchanged. Later phrases can fill that queue while prior audio plays, but a slow native WAV synthesis can still cause gaps. No deliberate initial delay or fake filler was introduced. The native API still returns a full WAV per segment; this is incremental text-to-speech scheduling, not native sample-by-sample Chatterbox inference streaming.

LLM and TTS GPU work may now overlap. Chatterbox jobs remain sequential, but shared8GB GPU contention must be measured physically. No sampling, decoder, reference voice, model or quality setting was changed to force a target.

## Timing telemetry

Added first phrase/text-chunk time, later phrase events, segment index/character count, segment start/first-PCM/completion and whole TTS completion. Gateway JSONL keeps these numeric metadata fields. Browser forwards the same metadata without any visual redesign. `gateway/timing-report.cjs` / `inspect-performance.cjs` report first-token, first-text-chunk, phrase-to-TTS delay, whether TTS preceded LLM completion, and per-phrase first PCM/elapsed time. Playback scheduling remains separate from actual audible onset measured in a recording.

Current source changes: `gateway/core.cjs`, `gateway/services.cjs`, new `gateway/phrase-stream.cjs`, `gateway/telemetry.cjs`, `gateway/timing-report.cjs`, and metadata forwarding only in `app/components/local-agent-voice-test.tsx`. New test: `tests/gateway-llm-streaming.test.cjs`; cancellation/telemetry tests updated. New optional probe: `gateway/benchmark-streaming.cjs`.

## Validation and actual measurement blocker

57 Gateway Node tests and4 Python transport tests pass; TypeScript `--noEmit` passes. The new controlled test holds Ollama completion until the first PCM frame is delivered, proving audio precedes full generation. It verifies exact word ordering/disclosure wording, split tokens/abbreviations/decimals, no overlapping TTS, failure classification, cancellation, stale-audio rejection, memory bounds and history commit. Tests use simulated engines, not a physical microphone.

A headless comparison was attempted against the unchanged actual local engines with the existing private contract/credential and approved resident voice. STT was deliberately stubbed; no browser audio was played or recorded and no production agent was edited. The first attempt failed with a nonspecific TypeError. After adding safe phase/error-code reporting and verifying Node authenticated HTTP200 connectivity, the diagnostic attempt stopped in **buffered mode at tts-segment-start** with:

```
engineStage: tts
errorType: TypeError
causeCode: UND_ERR_RES_CONTENT_LENGTH_MISMATCH
```

This means the HTTP WAV response ended before its advertised Content-Length was received. The incremental mode was not reached. There is no valid physical before/after comparison or new first-audible measurement to report. No automatic inference retry, deployment, restart, credential rotation or model change followed the failure. A separate authenticated health request returned ready=true and Gateway sessions/queue zero; it does not account for headless work submitted directly to engine endpoints and is not used as permission to terminate anything.

The transport failure is a concrete prerequisite to reliable physical benchmarking. The previously reviewed functional wrapper addresses disconnect response handling and native admission, but remains unverified physically. Do not claim this streaming change repairs a truncated WAV by itself. Deploy any reviewed physical correction only with explicit approval through the existing workflow, then repeat the headless probe and five consented browser microphone turns.

## Performance verdict

Prior measured browser endpoint-to-playback scheduling remains4.36–9.54s. Existing completed replies had roughly0.45–0.64s between first token and complete response, so overlap alone may save considerably less than those long total pauses; a meaningful phrase becomes available later than the first token. Earlier valid post-FirstAudio TTS-first-PCM measurements were2.36–5.31s. Streaming does not establish a two-second target, and GPU overlap may increase native latency.

After approved deployment, capture five answered questions in one session with one deliberate interruption, retain mixed local recording plus browser/Gateway/native metadata, and compare the same endpoint-to-scheduled-playback metric separately from speech-end-to-audible onset and full-reply continuity. Use `node gateway/inspect-performance.cjs`. Identify the largest actual stage rather than estimating audible onset from HTTP completion.

No physical files were overwritten or services restarted. The earlier `Shahvex-Voice-Functional-Review-v1.zip` remains unchanged with SHA256 `49C9BF3029EC7BEF3BD00EF6F56129E9E281ADE40F0C3492109E12ED445AF96B`; it does not contain this new streaming implementation. No new deployment archive/controller/authentication workflow was built. A future approved streaming bundle must include the new helper and all dependent Gateway files together; do not deploy only services.cjs into an older core.
