# Local response latency prototype — 10 November 2026

Status: user approved the fast female voice and requested localhost/live rollout on 10 November 2026. See the approved rollout notes below.

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

## Approved rollout

The approved default is Heart (`af_heart`). Male remains excluded from the public voice inventory pending pronunciation review. Saved voice records are not rewritten; admin testing and demo sessions select the approved fast default when it is available. Local/adapter launch configuration enables `SHAHVEX_FAST_VOICE=1` and phrase streaming. Vercel continues to use the authenticated PC adapter; it does not need direct model access.

`lib/agent-test-speculative.ts` implements the shared production draft transaction: one bounded isolated draft per session, authenticated owner checks, exact turn-token checks, 60 drafts/minute per owner, 30-second abandoned-draft cleanup and cancellation on stop/interruption. Drafts hold the parent session's capacity slot. Only confirmed drafts update conversation history; the browser retains its 500 ms endpoint guard and blocks all draft output until confirmation. Resumed speech aborts the draft without losing the original utterance.

Integrated production-handler browser verification: 12 warm trials, 760?870 ms, plus four pause/resume trials at or below 880 ms. These are still local synthetic-microphone measurements, not a live-domain latency guarantee. Regression: 14 passed, two explicit opt-in cases skipped; TypeScript and production build passed.

`deployment/Install-FastVoice.py` installs `shahvex-fast-voice.service` for loopback port 8778 with startup warmup and automatic restart. The existing Windows watchdog keeps WSL alive, so this unit joins the existing reboot recovery. A complete physical reboot remains untested.

Rollback: remove `SHAHVEX_FAST_VOICE=1` from the private adapter launch configuration and local `.env`, then restart the idle adapter. Existing original voice engines remain available. Restore the prior application commit to disable speculative browser requests as part of a full rollback. Do not publish the earlier local fixed-owner prototype routes.

Public tunnel verification after adapter reload: six female-voice browser trials measured 890?1,280 ms, with correct fee/hours and no false booking confirmation. This includes the public Cloudflare PC-tunnel round trip, but excludes Vercel's application proxy hop. The hard one-second target did not pass on this public path. The Vercel status for application commit `df82668` was successful, and localhost/live home pages returned HTTP 200. An automatic admin-session construction check was rejected by approval review and was not executed; authenticated end-to-end website-browser timing remains unverified. No admin session was created by that rejected action.

Confirmed drafts keep the original 110-second inference deadline instead of the 30-second unconfirmed-draft lease. Interrupting confirmed playback preserves the customer turn and partial interrupted answer; cancelling unconfirmed speech discards it. Both cases have regression coverage.

## Live preview, request ordering and audio download follow-up

The live HTTP adapter supplies buffered JSON bodies. Fast voice selection now accepts both direct string bodies and buffered Uint8Array bodies; real authenticated public `/engine/8767/synthesize` and `/stream` returned audible-format audio after this fix. Voice identity and synthesis settings are unchanged.

Cancellation now targets an exact turn token. A bounded per-session cancellation fence rejects an older upload even when its cancellation arrives first, and a late cancellation cannot abort a newer draft. Cancellation waits for the matching active worker to release; the client no longer ignores interruption failures. Tests cover cancelled uploads arriving late and normal turns using cancelled tokens.

Script extraction for hosted callers now runs through authenticated `/tester/extract` on the persistent PC service. Its existing owner/script-hash cache survives Vercel instance changes, so opening the panel and then starting the same script does not repeat extraction inference. Grounding and owner isolation remain checked.

Conversation downloads are real mono 16 kHz PCM16 WAV files. Browser MediaRecorder chunks are decoded and converted locally after recording stops; audio is not uploaded for export. Real Chrome recording verification produced a RIFF/WAV file with 9,600 audible samples, one channel and the correct 16 kHz header. The button uses the `.wav` extension and audio/wav MIME type. Recording size limits remain enforced.

## Customer questions and immediate barge-in

Removed the blanket prohibition on repeating introductions: requested identity answers now remain allowed. A final per-turn grounding instruction distinguishes questions/corrections from confirmation, prioritizes answering the actual question over scripted branches, limits answers to supplied facts and acknowledges missing information without invented policies. Inference temperature is zero. Six real-model cases cover both supplied awkward identity phrasings, identity plus calling purpose, an unknown phone-number source, explicit non-confirmation and refusal. The same cases also pass with the old no-reintroduction instruction seeded into session history. These are regression cases, not a guarantee that arbitrary model output will always be correct.

Barge-in retains echo correlation and energy checks, but requires three voiced frames (60 ms) during playback. A local GainNode mutes rendered and recorded playback immediately on interruption, before any HTTP cancellation. Playback stays gated until the AudioWorklet acknowledges clearing its old epoch. Stale frames cannot reopen playback; the next epoch can resume normally. The worklet URL uses `?v=2` to avoid a cached processor without the acknowledgment protocol.

Real Chrome synthetic interruption check measured 56 ms from simulated speech onset to clear, with silence verified 25 ms after clear while simulated backend cancellation was still pending. Stale audio rejection and next-epoch playback passed. This checks digital browser output, not physical microphone/speaker timing or every acoustic environment. Unit regressions also reject short noise and correlated playback echo.
