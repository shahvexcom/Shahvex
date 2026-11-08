# Jennifer dialogue-style controller: offline implementation review

3 November 2026. Review only; no deployment or physical service requests/restarts. No transport changes. Jennifer's voice/reference, Turbo parameters, 40-character phrase threshold, VAD, recording, credentials, approved scripts and production Gateway source are unchanged.

## Scope and decision

Implemented a small deterministic text controller in `gateway/dialogue-style.cjs`. It chooses once per completed customer utterance, then appends one bounded optional-delivery instruction to the existing system message. The original system message is an unchanged prefix; history and current customer text remain unchanged. There is no second LLM call, rewrite, acoustic classifier, TTS parameter, output preamble, artificial delay or playback transformation.

The actual `gateway/core.cjs` has **not** been edited. `gateway/style-review/proposed-core.cjs` constructs and tests the exact proposed integration in memory, failing closed if its source anchors change. The patch proposal touches only `gateway/core.cjs` and adds `gateway/dialogue-style.cjs`. Review/evaluation/test files do not belong in a physical deployment.

| Intent | Conservative trigger | Optional language direction |
|---|---|---|
| Neutral | Default, uncertainty, general questions | Clear, direct, respectful |
| Warm | Short explicit greeting | Restrained friendly acknowledgement |
| Reassuring | Explicit first-person concern or clarification request; immediate acknowledgement following that request | Calm clarification without promises |
| Serious | Trusted consent/condition/refusal intent | Plain, measured wording |

Stop/contact-removal/non-consent language and trusted stop/transfer actions reserve the original workflow and suppress the style hint entirely. These regexes are style heuristics, **not** a replacement for consent, compliance or opt-out handling. Ambiguous language defaults to neutral. No inference about customer emotion, accent, age or voice is performed. No intent state is shared across sessions or changed partway through a response.

## Permission and script safety

The constructor proposal defaults to `stylePolicy=null`: existing requests remain unchanged. Even with a resolver, `allowOptionalPhrasing` must be the boolean `true`. A future approved server-owned resolver must allowlist an audited script/configuration and return this permission. Never derive permission from a browser flag, customer request or arbitrary exported agent field. No resolver is installed or activated by this review.

The hint preserves mandatory wording, facts, conditions and workflow, prohibits promises, filler, stage directions and emotion tags, and yields to the original script if no optional wording exists. Entirely verbatim scripts must remain opted out. The unchanged assigned/dynamic test script continues to be supplied in full.

**Preserving prompt bytes does not guarantee that an LLM preserves every word in generated output.** The closed-world fixture audit rejects altered facts/disclosures/promises in authored examples; it is not a general semantic validator. Streaming output is not buffered for a second review because that would delay first audio. Accordingly this is not approved for live use: required-content and workflow fidelity must pass native evaluation before any activation. If mandatory output cannot be assured for a script, retain baseline mode. Optional punctuation/prosody benefits remain hypotheses.

## Offline results

Run from the repository, without live model/service access:

```powershell
Set-Location P:\shahvex
node --test tests/gateway-dialogue-style.test.cjs
node --test tests/gateway*.test.cjs
node gateway/style-review/evaluate.cjs
```

Observed: **9/9 focused tests; 66/66 total Gateway tests passed**, including existing authorization, STT drain, cancellation, ten-turn simulated continuity, ordered phrase streaming and recording tests. All inference/audio in these tests is mocked or synthetic. They do not constitute a microphone conversation or listening assessment.

Five paired synthetic scenarios cover greeting, factual question, clarification, concern follow-up and consent. Both sides preserve identical required statements and order. Style-side optional openings are explicitly **authored examples, not generated Ollama replies**, and the appointment fact is synthetic, not an approved business fact. Guardrails cover input immutability, exact dynamic script/history preservation, reserved flows, default denial, session isolation, one streaming call, early PCM delivery, native synthesis ordering, cancellation and stale history/audio rejection.

The saved offline run (`dist/Jennifer-Dialogue-Style-Offline-Results.json`) measured 10,000 helper invocations after 2,000 warmups, including a roughly 13,800-character script with 20 history entries. Observed controller CPU time: p50 **0.0005 ms**, p95 **0.0008 ms**, worst **0.1191 ms** on the development machine, Node v26.13.0. These are microbenchmark observations including timer overhead, not hardware-independent guarantees. The added prompt is **343–406 characters**, varying by intent. Extra Ollama prefill/decoding time and TTS effects are **unmeasured**, so negligible CPU time does not establish negligible end-to-end latency.

## Minimal patch proposal and rollback

Artifacts:

- `dist/Jennifer-Dialogue-Style-Review.patch`: exact two-file unified diff; **do not apply to the running physical Gateway**.
- `dist/Jennifer-Dialogue-Style-core.proposed.cjs`: generated source for review and syntax checks only.
- `dist/Jennifer-Dialogue-Style-Review.manifest.json`: original/proposed hashes.
- `dist/Jennifer-Dialogue-Style-Offline-Results.json`: results and deterministic randomized future trial plan.

Original repository core SHA256: `6d378952053861e66e36594ad788b7d5f310cb40068b4d7ba00d79d9c17f6617`. This is a repository baseline, **not an attestation of the currently running physical process**. The patch imports the helper, accepts an optional trusted policy resolver and prepares messages immediately before the same existing `this.llm` call. Signals, delta callback, sequential TTS, voice ID, history commit and audio delivery remain the original code. No environment flags, routes, UI, database or deployment-controller changes are proposed.

If later approved: use the existing authenticated maintenance/backup workflow, compare the deployed core to the reviewed baseline and back it up, stage the helper and patched core, verify artifact hashes, then run an explicitly approved restart. A source mismatch requires review, never forced application. Keep style disabled until the separate audited allowlist/resolver is approved. Rollback restores the backed-up **current VoiceStreaming core**, verifies its original hash, removes the new helper only if its reviewed hash matches, and restarts through the existing controller with unchanged credentials. No action is required to roll back this offline work because production was never changed.

## Native A/B gate — pending approval

Use the saved randomized 30-trial plan: five identical customer/context scenarios × baseline/style-aware × three repetitions. First have the client approve representative mandatory statements and permitted optional regions; replace synthetic facts with approved fixtures, never invent business facts. Use an isolated harness and a quiet approved window, preserving the production configuration and Jennifer voice. One Ollama call per trial; same model/options/history/script and existing sequential TTS. No new voice, emotion fields, STT/VAD changes or threshold tuning.

Record actual generated texts and audio only with explicit local test consent. Audit disclosures/facts/order/consent for every reply before any claim of correctness. Blind A/B listening should rate warmth, clarity, reassuring/serious appropriateness, rhythm, speaker identity and added verbosity. Reject unsupported reassurance, omissions, awkward openings or significant deterioration. Report failures rather than silently filtering them out.

Measure existing endpoint-to-first-audible PCM, LLM first token/first phrase, TTS first audio, completion and inter-phrase gaps; compare p50/p95/worst and prompt token counts. A conservative proposed acceptance gate is no mandatory-content/workflow failures, no voice-identity regression, and no practically meaningful first-audio regression (pre-agree a bound such as 100 ms or 5%). This sample is a screening exercise, not statistical proof. Do not enable it if the benefit is unclear. No native timing, acoustic naturalness improvement or two-second target is claimed by this offline review.
