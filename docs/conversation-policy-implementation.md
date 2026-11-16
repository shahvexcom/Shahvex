# Conversation policy implementation

Implemented in source on 13 November 2026 after the user explicitly approved implementation. Existing unrelated workspace changes were preserved. No production deployment, service restart, real customer call, payment, enrollment, or carrier submission was performed.

## Conversation behavior

`gateway/conversation-policy.cjs` contains the master behavior from the reviewed prompt document. Both the shared tester/VICIdial conversation worker and the standalone gateway include it. The policy covers adaptive explanation depth, contextual sales progression, objections, emotional responses, hypothetical examples, truthful identity, and strict script completion before handoff.

The shared worker now uses one consolidated set of conversation rules. Conflicting legacy rules, fabricated small-talk biography, false direct AI identity replies, invented location defaults, and fixed-duration soft-objection claims are removed from its active prompt. Mandatory script openings and disclosures take priority over flexible opening defaults. Fast greeting/repeat shortcuts cannot discard an assigned script's restrictions.

Assigned-script availability questions are preserved in streamed text and speech instead of being unconditionally filtered out. Completed answers should not be repeated; unanswered required questions remain pending across detours.

Committed call history is retained instead of dropping earlier turns after 41 messages in the shared worker or 20 messages in the standalone gateway. Bounded session limits reject additional turns rather than silently deleting early facts. Actual model context capacity still limits how much the model can attend to; retained server history is not a guarantee of perfect recall.

## Transfer enforcement

VICIdial result collection first derives a script-specific checklist, independent of the customer's buying signals. Each requirement must be a source-verifiable script excerpt. The result evaluator then returns a completion check and speaker-specific evidence for every checklist item.

The server rejects missing checks, duplicate IDs, invented excerpts, unsupported evidence, ungrounded conditional skips, and interrupted mandatory statements. A single bare acknowledgement cannot satisfy several steps; distinct acknowledgement turns can. Goal completion and an explicit early request for an agent do not bypass qualification.

The stored audit is bound to the current script and conversation hashes. New voice turns invalidate prior readiness. The transfer transaction requires a current complete audit, configured lead fields, consent, successful lead sync, and actual agent availability. The existing provider confirmation and uncertain-command protections remain in place.

Grounded customer needs, preferences, objections, and unresolved questions can be retained in handoff notes and included in native comments, subject to the existing comment length limit.

The standalone gateway blocks transfer without trusted answered-question state and rejects transfer during an active turn or after a stopped call. Its shipped server still reports that a real VICIdial transfer adapter is not configured; this implementation does not invent one.

Important limit: converting unrestricted natural-language scripts into requirements and deciding semantic completion still use the configured model. Exact evidence checks prevent unsupported quotations and common bypasses; they cannot prove that the model extracted every intended condition or interpreted every answer correctly. Review each campaign script and conditional path before live use. Missing or invalid extraction blocks handoff rather than assuming readiness.

## Conduct and expressions

`gateway/customer-conduct.cjs` adds deterministic handling for explicit end requests and high-confidence directed sexual harassment or abuse. The first incident receives a calm boundary. Repeated matching conduct ends the call through the existing `end_call` event. Genuine product complaints, health discussions, and reported abuse are excluded from the direct patterns where identifiable.

Warning and ended-call state remain isolated in speculative drafts and are copied only when the draft commits. Ended sessions reject further conversation turns. The VICIdial bridge drains closing playback and skips transfer/sync initiation when the call is ending.

Existing Lissa expression selection suppresses laughter for detected harassment, explicit ending, anger, or requests not to laugh. Existing supported emotion controls and their feature flags are retained. This does not enable new expressions or acoustic capabilities on unsupported voices, and no voice engine configuration was changed.

The deterministic conduct patterns cover explicit English and selected Roman Urdu phrases, not every possible language, implication, or euphemism. The master prompt also instructs the model to redirect inappropriate behavior. Broader semantic conduct classification and multilingual acoustic evaluation remain areas for live validation; prompt instructions alone do not constitute an executable hang-up action for every novel phrase.

## Current business boundaries

Quoting, plan recommendation, enrollment, payment, and form-submission actions are explicitly disabled in these conversation workers. Existing tools elsewhere in the application were not deleted. Affordability questions may be asked when the assigned script permits; a budget must not be represented as a quote or approval.

Campaign-specific decisions about pricing permissions, tool mappings, refused-information fallbacks, and new voice capabilities remain with the user. Unsupported actions are not silently enabled by a script or by tool availability.

## Validation

- TypeScript: `tsc --noEmit --incremental false` passed.
- 90 targeted regression tests passed across conversation runtime, progress, emotion, identity, expression answers, standalone gateway/intelligence, VICIdial live adapters, speculative sessions, and streamed speech.
- Regression fixtures verify missing-step rejection, stale-audit invalidation, goal/early-agent-request bypass prevention, grounded evidence, conditional skips, warning-to-end behavior, retained early facts, and script-authorized availability speech.
- Tests use mocked model/voice services and local adapter fixtures. They validate wiring and enforcement, not conversion rate, naturalness under real model inference, or end-to-end customer-call audio quality.
- The broader repository suite was not certified. An initial separate run of `agent-test.test.cjs` encountered its existing test-loader failure resolving `@/lib/clone-voice-preview`; that unrelated harness was not modified.

The 90-test run used:

```sh
node --test tests/conversation-policy-runtime.test.cjs tests/conversation-progress.test.cjs tests/voice-emotion.test.cjs tests/identity-voice-answer.test.cjs tests/expression-answer.test.cjs tests/gateway.test.cjs tests/gateway-agent-intelligence.test.cjs tests/vicidial-live.test.cjs tests/speculative-session.test.cjs tests/agent-test-stream.test.cjs
```

Running services must load the updated source through their normal restart/build/deployment process before these changes affect them. Live model and audio evaluation should check pauses, interruptions, grief, humor, objections, script branches, and successful/failed transfers before enabling a production rollout.
