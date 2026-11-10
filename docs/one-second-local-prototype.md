# Local response latency prototype — 10 November 2026

Status: local review only. Not pushed or deployed; existing cloned voices and live services remain unchanged.

## Measurement

Warm Chrome synthetic microphone -> existing speech capture -> real local STT -> real local LLM -> experimental Kokoro TTS -> first AudioWorklet playback event. Timing starts at the last detected voiced microphone frame. This measures digital playback, not physical speaker output. Cloudflare/Vercel network time and cold starts are excluded.

| Verified suite | Trials | Maximum |
| --- | ---: | ---: |
| Questions, two experimental voices | 12 | 880 ms |
| Speech resumes after a middle pause | 4 | 860 ms |
| Appointment memory and corrections | 8 | 871 ms |

All 24 verified warm trials were 750–880 ms. The continuous suite ran over three minutes in total, comprising two four-turn sessions; it was not one continuous three-minute call. Baseline without overlapping processing took 1,030–1,430 ms. Eight separate mid-audio cancellation cases and a subsequent complete reply passed.

## How it works

Optional speculative capture starts hidden processing after 100 ms of silence. It retains the existing 500 ms end-of-speech guard. No draft audio/text is released before that guard. Resumed speech cancels the draft and retains the complete utterance. Draft history is isolated and merged only after confirmed finalization. Default production capture does not enable speculation.

The isolated test server is a prototype, not a public API: production integration still needs authenticated owner routing, bounded draft lifetimes and capacity/rate controls. These local fixed-owner routes must not be published.

## Voice trade-off and limits

The fast voices are different presets, not Lauren/Adam clones. Existing CosyVoice clones still exceeded one second in measured TTS-only tests. FP16 and TF32 did not provide a reliable improvement; TF32 also had estimated male playback underflows of 71/99 ms. Neither was selected.

Female approval sample: `.data/pc-ai/one-second-browser-overlap/fast-female.wav`. Local transcription preserved the complete two-thousand-Pakistani-rupees sentence. Male sample transcription inconsistently omitted “rupees” (one follow-up preserved it, another did not); hold male pronunciation approval pending further review. Transcription is not a substitute for listening or a subjective naturalness assessment.

Kokoro source: https://github.com/hexgrad/kokoro ; model: https://huggingface.co/hexgrad/Kokoro-82M . Installed only in `.data/pc-ai/fast-tts-env`, with private local model cache. No customer recordings were uploaded for this experiment.

This is evidence for a limited warm local budget, not a guarantee for arbitrary speech, cold starts or the live domain. Voice approval and public-path validation are required before live adoption.

## Evidence and regression

Private results: `.data/pc-ai/one-second-browser-overlap/results.json`, `one-second-browser-overlap-resumption/results.json`, `one-second-browser-overlap-continuous/results.json`.

Local opt-in harness: `tests/local-one-second-browser.cjs` with `SHAHVEX_LOCAL_BROWSER_LATENCY=1` and `SHAHVEX_LOCAL_OVERLAP=1`; optional `SHAHVEX_LOCAL_RESUMPTION=1` or `SHAHVEX_LOCAL_CONTINUOUS=1`. Requires the isolated local TTS service on 8778 and existing local STT/LLM. It does not use website accounts or the live adapter.

Regression: 20 passed, two explicit opt-in cases skipped; production build and TypeScript checks passed. Speculative capture tests cover delayed release, draft invalidation/full utterance preservation and unchanged production defaults.
