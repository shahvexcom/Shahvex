# Native TTS candidate: local review, awaiting approval

No production TTS service, tunnel, Vercel deployment, or startup unit was changed. Experiments used a separate process on loopback 8776 and temporary local preview on 3002, using the same existing cached FP32 model/voices. No new weights were downloaded. The candidate was memory-bounded to protect the live model. No Git push was performed.

## Change

The installed CosyVoice3 inherits a streaming implementation that grows `self.token_hop_len` during synthesis and retains that value across requests. Its declared native/training chunk size is 25; the retained value can reach 100. The candidate starts each request at 25 under the existing model lock and restores prior state on completion/failure. It preserves native chunk growth within a request, speaker caches, model precision, sampling and the cancellation-safe dedicated worker. This is a scheduling/chunk-state change, not a different voice or model.

`native_stream_policy.py` implements the candidate; `local_fast_tts_api.py` is the separate local wrapper. Production remains on its previous wrapper. `SHAHVEX_LOCAL_FAST_TTS=1` only routes an explicit local Next/test process to 8776; a Vercel process cannot select this override.

## Paired real TTS results

One fixed text, the same voice, seed and cached model; alternating 100/25-token starts, two pairs per voice. These are local synthesis timings, not browser-to-Cloudflare response times.

| Voice | Baseline first PCM | Candidate first PCM |
| --- | --- | --- |
| Lauren | 3873 / 4135 ms | 1644 / 1415 ms |
| Adam | 2452 / 2605 ms | 1330 / 1358 ms |

Mean improvement: approximately 62% for Lauren and 47% for Adam in this fixture. Every paired clip had the same duration/sample count. No clipping was detected. All eight recordings passed local STT checks for complete wording, the amount 2,000 Pakistani rupees and appointment confirmation. No estimated within-utterance playback underflow was observed. Signal similarity and transcription are not a human listening/naturalness certification.

## Reply continuity and cancellation

Two sequential-sentence checks reproduced a baseline inter-sentence playback gap of 2276 ms / 485 ms. The candidate had 0 ms estimated gap in both runs. These are two local samples, not a universal zero-gap guarantee.

An isolated local HTTP tester used the candidate for 16 real-engine turns over more than three minutes: 11 mid-PCM interruptions and five complete replies passed without BUSY stalls. The first cold turn took 5379 ms, including 3359 ms before the LLM's first token. Subsequent local first-audio timings were approximately 1.9–2.6 seconds. Cold LLM startup remains distinct from TTS optimization.

Additional checks passed: native-state reset/restoration including exceptions; 30 interrupted lock-owning stream fixtures; local-versus-Vercel routing isolation; targeted tester/stream/security tests (17 passed, four opt-in live checks skipped); production build and TypeScript. The separate real comparisons and soak above were actually run, beyond those skipped tests.

## Artifacts and next step

Private artifacts: `.data/pc-ai/native-tts-compare/verified-results.json`, `join-results.json`, `local-soak.json`, `signal-comparison.json` and the paired WAV files. They are Git-ignored. Audio examples use the same reference text rather than impersonating the client's reference speaker.

Candidate is ready for review/approval, not promoted to live. Human listening, real browser microphone/output and public-network acceptance remain separate checks. On approval, apply the candidate to the existing production TTS wrapper during an idle window, warm selected voices, verify public streaming, and retain the previous wrapper as rollback. Do not raise GPU concurrency or change model precision as part of that rollout.
