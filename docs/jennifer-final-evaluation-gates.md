# Jennifer: final evaluation and default-off implementation proposal

3 November 2026. **Recommendation: proceed to blind review, then a separately approved local-only browser pilot; no production deployment yet.** No production code/configuration, script/database, credential, voice/model/reference, maintenance state or service was changed. No live inference ran during this preparation. Transport research stays paused, with strict integrity validation retained.

## 1. Evidence and listening gate

All existing 30 labeled WAVs and 30 blind copies match the recorded generated hashes. All 66 native request records report complete HTTP/length integrity. `dist/Jennifer-Final-Evaluation-v1/evidence-manifest.json` inventories **175 original benchmark files** with size/SHA256; originals were checked unchanged after scorecard preparation. This is verification/preservation, not an independent off-disk backup. No file was discarded or overwritten.

Prepared `blind-scorecard.csv`, `blind-pair-preferences.csv` and `SCORECARD.md` in `dist/Jennifer-Final-Evaluation-v1`. They cover naturalness, appropriate warmth, Jennifer identity/accent, pronunciation and flow, scored 1–5, with A/B/Tie preferences. Clips remain at their original location. The answer key remains separately under the benchmark's `private-key/` folder; give listeners only blind audio and blank forms.

**Listening acceptance, proposed before scoring:** three listeners; 15 pairs per listener. Four eligible optional-opening cases × three repetitions × three listeners = **36 primary paired judgments**. Concise must win at least **26/36** (ties remain in the denominator). Require median score >=4/5 in every dimension for concise, no worse median than baseline in any dimension, and no confirmed identity/accent regression, required-word omission, harmful pronunciation error or clipped mandatory ending. Uncertain voice familiarity is recorded, not scored as success. Mandatory-first control is reported separately and cannot inflate the primary preference count. Any confirmed critical defect blocks promotion; it is not averaged away. This remains exploratory preference evidence, not statistical proof of universal naturalness.

Native data already show optional-case first-valid-PCM median 2.714→1.603 s; the full corpus including mandatory-first control is 2.356→1.774 s. Worst projected starvation gap was 0 ms. **No improvement to the 5.62-s browser/recorded-conversation median has been established.** Concatenated clips cannot establish real-time gaps, speaker latency or native GPU-only timing.

## 2. Combined controller/concise review and immutable boundaries

The existing controller makes one conservative response-level intent decision (neutral/warm/reassuring/serious), appends an optional instruction to the existing single Ollama request and defaults to disabled. The proposed core integration leaves the original script/system prefix, history, model call, signal, delta stream and TTS consumer intact. Current hints permit acknowledgements, so the concise proposal should remove the expectation of routine greetings/acknowledgements and prefer one useful complete thought **only inside explicitly permitted optional regions**. Do not turn brevity into a hard output length cap or second rewriting call.

| Content | Proposed permission |
|---|---|
| Exact disclosures, consent, opt-out/refusal wording, eligibility/conditions, compliance and required order/timing | Locked; never shorten, move or paraphrase |
| Business facts, numbers, names, prices, dates, commitments and factual qualifications | Locked; optional compression cannot change or imply new facts |
| Dynamic/assigned script, test instructions, campaign identity and conversation state/history | Preserve original bytes/meaning/authority; no editing/summarization to save tokens |
| Four synthetic opening sentences explicitly defined in `concise-evaluation.cjs` | Only these opening spans are eligible in their generic fixtures; approved baseline/proposed alternatives are exactly the prepared texts |
| Mandatory-first control's disclosure and final “May I continue?” | Locked at their required positions; only its following optional explanation can vary |
| Actual Jennifer campaign opening, acknowledgements, transitions, clarifications or closing | **No sections authorized yet**; require campaign-owner-reviewed optional-region policy bound to the active script hash |

The generic examples have no supplied business facts to modify; they do not verify campaign facts. Exact required fixture spans/positions, original input script prefix and history were verified in offline tests. Matching inputs and native request text do **not** prove arbitrary LLM output or spoken audio preserves every word. Human output/audio audits remain required. The original generic follow-up fixture explicitly permits disclosure to have been given in history; this must never override a real script requiring disclosure on the current turn.

**Production blocker:** the application export has script text but no inspected explicit optional-region permission policy. Actual Jennifer campaign constraints are not verified here. Treat every unclassified region as locked. A prompt instruction alone is not an immutability enforcement mechanism; do not claim production compliance from this proposal. Free-form streaming generation cannot be promoted if required output cannot be deterministically protected/validated before it is emitted. Solving that may require a separately reviewed script/response-template mechanism, not a silent expansion of this minimal patch.

## 3. Minimal feature-flagged proposal — not implemented/deployed

Proposed server-only flag: **`SHAHVEX_DIALOGUE_STYLE_TEST=0` by default**, never `NEXT_PUBLIC_*`, never accepted from browser text. No `.env` or launcher has been changed. The server initializes the resolver only when all gates pass:

1. Flag is exactly `1` in an explicitly authorized local development test environment; reuse current local-only/production/Vercel/Railway denial checks.
2. Authenticated authorized test session and approved/verified agent/voice continue to pass the existing checks.
3. Server-owned allowlist matches the agent, campaign and **full active composed script hash**, including any custom test instructions; any change or missing policy gives baseline mode.
4. Explicit region policy authorizes optional wording for this exact test. Caller statements, browser flags and arbitrary agent-export fields cannot grant permission. Stop/withdrawal/transfer and entirely verbatim responses retain existing behavior.

Only then pass the existing optional `stylePolicy` resolver into the in-memory-reviewed Gateway integration and add one bounded concise hint to the same Ollama request. Freeze intent per response. No second LLM, emotion classifier, TTS parameters, output truncation, invented fillers or arbitrary post-generation rewrite. Keep original system prefix/history and all native options. Default/off/disallowed sessions must produce byte-identical baseline message construction.

Minimal proposed runtime file scope: `gateway/core.cjs` for the existing one-call hook/default-off resolver and `gateway/dialogue-style.cjs` for concise optional policy. A reviewed server-owned test policy/flag wiring and focused tests are also necessary before a pilot. The old `Jennifer-Dialogue-Style-Review.patch` alone does not supply these new gates or deterministic output protection and is **not a final deployable release**.

Keep 40-character clause threshold and sentence rules, 400-ms VAD endpoint, onset/echo handling, native STT/TTS drain, generation checks, sequential synthesis, ordered playback, history commit, recordings and cleanup unchanged. Keep Jennifer's native reference/accent/model/settings/watermark. No database schema/record changes or production UI redesign.

## 4. Five-turn end-to-end browser acceptance

Pending separate implementation/run approval and listening success. Use generic permitted fixtures initially; real campaign testing needs the policy above. Run **two matched five-turn sessions**, baseline and candidate, with the same customer prompts, script/hash, devices and warm service state. Randomize session order, never run concurrently. The old 5.62-s measurement is historical context, not a matched control. Obtain local recording consent; no real calls.

| Completed turn | Test |
|---|---|
| 1 | Neutral factual/next-step question; preserve any mandatory opening exactly |
| 2 | Follow-up referring to turn 1; verify remembered context and unchanged active dynamic script |
| 3 | Explicit concern/clarification; reassuring concise content without promises or emotional speculation |
| 4 | Ask a question, interrupt once during Jennifer's reply, then complete a replacement question; verify the stale response stops and the replacement completes |
| 5 | Serious consent/condition question, then Stop Conversation and close; preserve required wording and release resources |

There must be five **completed measured responses**. The interrupted generation in turn 4 is an additional cancelled attempt, reported separately; do not silently substitute it into the five response medians. A cancellation is not an engine failure, but stale output, omitted replacement response or lost history is a failure. No unapproved scripted business facts are introduced.

Collect existing turnId/generation-correlated VAD endpoint, queue, STT, first LLM token/phrase, TTS first valid PCM, playback schedule, cancellation and cleanup events. Record both sides and separate user/generated tracks where the existing tooling allows. For **actual audible response**, independently record customer speech and physical speaker/headphone output on a shared timebase, calibrating alignment before the test. Use an already available capture/recording method; do not install software or change production audio configuration automatically. Manually verify speech-end and first Jennifer onset; automated RMS is supporting evidence only. The application's mixed digital recording/scheduled start alone is not proof of physical audible onset. If physical capture is unavailable, label that metric unmeasured and do not pass the actual-audible gate.

Measure:

- Customer speech-end→first actual audible Jennifer sample for each completed turn, separate from scheduled/valid-PCM time.
- Actual inter-phrase silence, distinguishing natural punctuation pauses from buffer starvation using waveform plus events.
- User interruption onset→cessation of old output; any stale-generation PCM/text/history commits.
- Final cleanup: mic tracks stopped, playback queue empty, relay/session closed and active/starting relays, sessions and queue counts return to zero within 5 s of Stop/close. Do not infer cleanup from an unauthenticated health failure.

**Exact proposed browser acceptance gates:**

1. 5/5 completed responses in each session; no freeze, duplicate session, stale audio, dropped/reordered required words, unauthorized facts, hidden engine error or script/history loss. Zero WAV corruption; stop immediately on corruption, no retry. Failed/unrun slots remain reported.
2. Candidate first-audible median **<=3.0 s and >=20% faster** than the matched baseline median; no valid completed candidate response **>5.0 s**. These are acceptance targets, not forecasts. If unmet, report actual stage bottleneck rather than changing VAD/voice/quality to pass.
3. No candidate unexplained/starvation gap **>500 ms**, and no matched gap worsens by **>250 ms**; retain intentional/natural pauses separately. Do not pad initial playback or insert filler to conceal gaps.
4. Old playback ceases within **300 ms** of confirmed user interruption onset; zero old-generation audio thereafter, replacement completes and context is preserved. Record raw speech onset and confirmed barge-in event separately to avoid hiding detection delay.
5. Median listening dimension scores >=4/5, no decline versus baseline, no critical content/voice/pronunciation defect; cleanup meets the 5-s gate. A pre-existing baseline failure does not waive the candidate gate.

Report each turn plus p50/descriptive p95/worst, all failures/cancellations, device/recording alignment uncertainty and cold/warm state. Five turns are a pilot, not reliable population p95, concurrency or production-capacity evidence. Passing still does not authorize deployment.

## 5. Rollback and final decision

Current recommendation is **default-off local pilot only after blind/content gates**, not production activation. If required campaign regions or pre-emission protection cannot be verified, retain baseline. No automatic deployment, maintenance change, service restart or new native test is authorized by this document.

Before any later approved pilot, use existing authenticated maintenance/backup procedure and hash the then-current **VoiceStreaming** `core.cjs`, `services.cjs`, `audio-stream.cjs`, parser and native wrapper/reference. Preserve existing backups; restore only actually changed files. Check full assigned/composed script hash without editing it.

Rollback: stop only the test session; disable the server-owned test flag/resolver so newly created sessions use baseline, and verify off-mode requests are unchanged. If restoring code requires a restart, obtain explicit approval and use the existing controller to restore the exact backed-up VoiceStreaming files/hashes; remove only introduced hash-matching files. Do not restore pre-VoiceStreaming releases or rotate tokens. Re-run baseline health, normal/cancellation/session cleanup checks through approved access. Keep all audio/scorecards/metrics even if the candidate is rejected.
