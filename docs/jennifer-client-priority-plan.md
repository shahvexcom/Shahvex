# Jennifer client-facing evaluation plan

3 November 2026. **Transport investigation paused at the user's request.** Preserve all socket/ETW/VM findings, fixtures, journals and backups; no more transport experiments or capture/provisioning work is scheduled. Existing integrity checks and stop-on-corruption behavior remain mandatory.

This review changed no production code, configuration, models, scripts, credentials or services and sent no live AI requests. Reviewed the offline style helper/proposed in-memory integration, current `core.cjs`/`services.cjs`, approved generic text corpus and retained recording/event reports. Focused style/streaming/cancellation/recording tests: **23/23 passed**, with mocked engines.

## Two independent evaluation tracks

**A. Naturalness: evaluate conservative optional wording in one existing Ollama request.**

- Keep neutral, warm, reassuring and serious as **dialogue intents**, not TTS emotion modes. Use explicit customer words, immediately relevant history and trusted workflow state. Neutral is the uncertainty fallback; stop/non-consent/transfer reserves the original workflow. Freeze intent per response. No acoustic emotion guess, second call or speech manipulation.
- The existing helper is default-disabled, adds a 343–406-character optional instruction, and leaves the original script/history as unchanged input. It is not wired into production. Prior controller CPU timings are tiny, but extra prompt/native generation latency remains unmeasured.
- The actual approved campaign wording and optional-permission regions are still unverified. Do not enable the helper for Jennifer's real campaign yet. Use the approved **generic demonstration corpus only**, or a separate offline script fixture with explicit immutable disclosure/fact/workflow spans. No application/database updates; a test-only in-memory configuration cannot grant itself production permission.
- Start with baseline versus current style request construction, then review a **candidate instruction revision** that uses concise, relevant optional wording instead of automatically prepending acknowledgements. Replace only genuinely optional wording; never replace, shorten, paraphrase or reorder required spans. Do not add filler to obtain earlier audio. Revisions require text review and are not applied in this work.
- Exact wording checks, fact/workflow audits and human review precede any new audio. Prompt-preservation tests alone cannot guarantee generated script fidelity. For an entirely verbatim response, disable style; the current API offers no independently verified per-response emotion/rate control.

**B. Latency: evaluate meaningful optional first-sentence length, keeping the parser and native engines unchanged.**

This is the highest-impact **safe candidate to test**, not a proven optimization. Encourage the existing single LLM call to express one useful, complete thought first wherever optional wording permits, preserving all required information and the rest of the answer. Avoid lengthy optional introductions and redundant reassurance. Do not introduce a hard character cap, truncate a disclosure, split tiny fragments, change punctuation in mandatory text, or move consent/disclosures later.

The 40-character clause threshold, existing sentence rules, 400-ms endpoint, onset/barge-in settings, sequential synthesis, native drain, history and ordered playback remain exactly as deployed. No TTS voice/reference/model/generation parameter changes. Shorter **optional content** can reduce synthesis work on valid transfers without requiring a transport fix; it does not make corrupt transfers acceptable or reliable.

## Retained measured latency

Recomputed from `dist/voice-191305-waveform-metrics.json`, threshold 500, five completed uncancelled turns. Summary: `dist/Jennifer-Client-Priority-Telemetry-Review.json`.

| Measure | Median | Observed range |
|---|---:|---:|
| Recorded speech-end → AI onset | **5.62 s** | **3.86–7.74 s** |
| Queue before STT | 0.0011 s | 0.0005–0.884 s |
| STT stage | 0.922 s | 0.881–5.223 s |
| LLM first token | 0.260 s | 0.038–0.371 s |
| LLM first meaningful phrase | 0.409 s | 0.166–0.773 s |
| First TTS/WAV/decode → valid PCM | **3.026 s** | **1.395–5.478 s** |

These stage medians do **not** sum to a representative turn. First-token and first-phrase times overlap; do not add them. TTS timing is composite, not isolated GPU inference. The onset measure comes from the mixed digital recording aligned to events, **not calibrated physical sound at the listener's ears**. Five turns do not establish a reliable population p95; retained descriptive p95 is 7.712 s.

First-phrase → TTS handoff is already **0–1 ms**; code starts TTS before Ollama finishes and immediately forwards the first valid segment. There is no full-reply wait to remove. Observed first phrases of 43/67/70/87 characters had composite costs 2.103/3.026/3.122/5.478 s; this association is confounded by wording, prosody and load, so it is not a causal character-to-millisecond model.

The 5.223-s STT outlier affects tail latency, but admission/HTTP/native compute were not separated. Preserve native drain and Whisper configuration. Its cause is not established. Likewise, the 0.884-s cancelled-work drain is required work, not a queue delay to bypass. Ollama keep-alive or playback-buffer tweaks are lower-priority: current first tokens are comparatively quick and first audio already streams.

## Expected benefit, risks and decision gates

| Candidate | Expected benefit, not a result | Main risk | Proposed acceptance gate |
|---|---|---|---|
| Conservative dialogue style | Better relevance, clarity and appropriate warmth without changing identity | Added acknowledgements, repetition, unsupported reassurance; prompt conflicts | Zero mandatory-word/fact/flow violations; neutral on ambiguity; clear blinded preference |
| Concise meaningful optional opening | Less first-WAV synthesis work on applicable replies | Unnatural brevity, omitted context, extra later jobs/gaps; many mandatory openings cannot change | At least 20% paired first-playable improvement on eligible fixtures, no omitted content and no added gap >250 ms versus A |
| STT outlier follow-up, deferred | Potential tail-latency improvement | Misidentifying admission/drain as compute | Diagnose first; no Whisper/VAD changes proposed |

The already-approved ten generic texts are **listening examples, not a latency patch**. Offline segmentation shows neutral unchanged (38/28 characters); friendly first phrase grows 38→45; hesitant and concerned add a phrase; serious lengthens its later phrase. Do not silently edit these approved texts or advertise them as faster. Keep them as the first listening comparison; prepare any concise alternatives as a separately reviewed text set.

For style-only A/B, pre-agree a noninferiority budget: paired p50 first-audible no more than 100 ms worse, and descriptive p95 no more than 150 ms worse. Do not relax budgets after seeing results. For naturalness, proposed screening gate: at least 70% style preference across 15 blinded paired judgments (five scenarios × three listeners), no consistent voice/accent/rhythm regression and no required-content failure. Small listening samples are exploratory, not statistical proof of general quality.

## Minimal sequence and rollback

1. **Now, offline only:** retain the generic baseline/style pairs and recordings; annotate immutable spans and permitted optional regions in synthetic fixtures. Review request text, intent decisions, word/order invariants, first-phrase length and segment count. Listen to existing Jennifer recordings for baseline rhythm/identity; they do not supply a matched style-aware result. Lissa material must never condition the voice; no reference recording is assumed to have been analyzed.
2. **Separately approved native text evaluation:** one `shahvex-natural` call per variant/turn, identical model/options/history and fixed customer contexts, randomized paired trials. Review all generated texts before any synthesis. No second live rewrite call or streamed-output patching; the production path remains unmodified.
3. **Separately approved TTS comparison:** fresh authenticated maintenance/idle verification, no competing direct native work, exact existing Jennifer voice/settings and sequential requests. Existing generic ten-sample plan remains intact. Stop on the first corruption/instability; retain failures and unrun slots. No automatic corrupted-response retry, synthetic padding or skipped validation. A transport failure can interrupt evaluation without restarting the transport investigation.
4. **Separately approved browser pilot only after text/listening gates:** ten consecutive questions including concern, clarification, consent and interruption. Preserve active script/history and record with consent. Measure speech-end → first valid PCM, first playback scheduled and independently aligned recorded onset separately; retain queue/STT/LLM/first-WAV and between-phrase timing. Report successful/cancelled/failed denominators, cold/warm conditions and median/p95/worst without excluding slow valid turns.
5. **Deployment remains a separate decision.** Default-deny style policy stays disabled for unverified campaign scripts. A later approved experiment must be session-scoped; approved script bytes/hash and native settings stay fixed.

Rollback for offline evaluation: return to baseline request construction and discard only the candidate instruction, retaining evidence. No production rollback is needed now. If a future approved pilot integrates the helper, disable its trusted test-only resolver (default null), close only the test session, and use the existing backup/controller workflow to restore the current VoiceStreaming files if necessary. Do not rotate credentials, restore pre-VoiceStreaming code, change the database or alter Jennifer's voice.

**Target interpretation:** 2–3 seconds is an evaluation goal, not a demonstrated outcome. The best retained completed onset is 3.86 s. Prior optimistic sums of unrelated best stages are neither measured turns nor hardware floors. Content-focused evaluation may improve perceived responsiveness and first-WAV work, but no numerical speedup, real acoustic expressiveness or two-second response is promised.
