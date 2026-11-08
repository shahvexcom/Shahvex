# Agent intelligence v1: implemented, default OFF, not deployed

## Result and changed files

Implemented in the repository only. No real database access, native inference, Gateway/AI-service restart, maintenance change, voice/model/reference edit, credential rotation or deployment. Existing recordings, native benchmark evidence and paused transport work are untouched. No dependency installation or build/dev command was run.

| File | Actual change |
|---|---|
| `gateway/agent-intelligence.cjs` | Generic snapshot/turn adapter, one model call, contextual styles, trusted speech rendering, task state and guardrails |
| `gateway/intelligence-policy.cjs` | Server flag/registry loader, strict bounded policy schema, owner/campaign/script/voice binding, exact source-literal checks and immutable policy objects |
| `gateway/intelligence-stream.cjs` | Incremental bounded JSONL units, validation and final/delta consistency |
| `gateway/core.cjs` | Optional default-null adapter, pinned session snapshot, existing single-call seam, rendered-text history/state commit and distinct timing stages |
| `gateway/server.cjs` | Load the optional server-side adapter at startup; existing authenticated session/PCM protocol unchanged |
| `.env.example` | Document `SHAHVEX_AGENT_INTELLIGENCE=0` and optional local policy-registry path; no real `.env` changed |
| `tests/gateway-agent-intelligence.test.cjs` | New generic engine/flag/isolation/state/stream/cancellation/backend integration regressions |
| This document | Implementation, limits, verification and deployment/rollback review |

`gateway/dialogue-style.cjs` is an **unchanged newly required runtime dependency** for conservative intent selection. Its older prompt-rewriting function is not used by this implementation. It must be included in a future package even though no new source edit was needed. Other pre-existing workspace modifications belong to earlier tasks and were not reverted or included as changes from this task.

Review artifacts: `dist/agent-intelligence-review.patch`, `dist/agent-intelligence-implementation-manifest.json`. Read-only baseline copies are in `backups/agent-intelligence-review-v1/`: core from the approved VoiceStreaming ZIP and server from the current physical file. These copies do not attest a running process's loaded revision and do not replace a fresh deployment backup. No new deployment ZIP/controller action was created.

## Runtime behavior

OFF is the default: no registry file is read, no candidate request format is used and no intelligence task state is added to baseline sessions. Tests compare original baseline message construction with the unknown-policy fallback. The existing system prompt, model options, native clients, queue/drain, parser threshold, VAD, PCM streaming, barge-in, recording and history behavior remain the original path.

Opt-in environment variables, **for a later separately approved local pilot only**:

```text
SHAHVEX_AGENT_INTELLIGENCE=1
SHAHVEX_AGENT_INTELLIGENCE_POLICIES=<absolute local reviewed registry JSON path>
```

No `NEXT_PUBLIC` variable. Production NODE_ENV, Vercel and Railway indicators force this pilot OFF even if the flag is set. Programmatic injection is a trusted test/backend API, not a browser permission. Do not edit environments or restart anything based on this documentation alone.

The existing authorized application path already resolves the selected agent's latest assigned script before creating the Gateway session. This implementation uses that configuration dynamically; no manual script export is required by the runtime and no Jennifer name/ID/content appears in its logic. Admin/BPO authorization workflows were not broadened. The current browser test remains the existing approved controller-agent path; this change does not add a BPO testing endpoint, real calling or arbitrary tenant access.

A reviewed policy is selected by actual Gateway owner scope, campaign identifier, full current composed script SHA256 and verified voice ID. At present the physical HTTP Gateway uses owner scope `local-service` for its authenticated backend; tenant/agent ownership must continue to be established by that backend before it submits a configuration. Gateway service credentials confer trusted backend authority, not per-tenant browser authority. The in-process API supports separate owners and tests that separation. Policy fields supplied in a session request are ignored.

At creation the policy/configuration is copied and frozen. Assigned-script or registry edits apply to **new sessions**; existing conversations retain their original script, policy, facts and task state. A script hash mismatch selects baseline before candidate generation. Duplicate matches, malformed approved policies or unrecognized condition types are rejected, not guessed. Registry is re-read at new-session creation; no model-based permission extraction or per-turn database query is added.

### Policy registry

The registry is a bounded local JSON array (maximum 64 policies / 512 KiB, compiled context <=16,000 characters per policy), owned by the backend operator and kept outside Git/browser assets. It is **not** an approval mechanism for arbitrary uploaded `approved:true` JSON. The operator must establish authorized script/compliance approval before adding an entry. No new database/approval UI/policy persistence service was introduced.

Each entry requires:

```text
version: 1, approved: true, approvalId,
owner, campaignId, scriptSha256, voiceId,
allowOptionalSpeech: boolean, allowGeneralKnowledge: boolean,
defaultStyle: neutral | warm | reassuring | professional | serious,
objective/personality: bounded optional instructions,
stopResponse: optional exact script literal for explicit withdrawal,
facts: { factId: exact assigned-script text },
questions: { fieldId: exact assigned-script question },
required: [{id, text, position: prefix|suffix,
            when: session-start|each-turn|customer-mentions,
            match: literal string only for customer-mentions}]
```

Fact/question/required text must occur verbatim in the assigned script or match the platform disclosure; no fuzzy paraphrase. Unknown schema keys, excessive content, dangerous prototype IDs, duplicate required IDs or unsupported triggers fail. `customer-mentions` is deliberately a conservative literal match, not inference about eligibility, negation, consent or legal applicability. Complex business conditions are unsupported and require a separately reviewed policy extension before eligibility; do not encode them as a simplistic keyword match.

No optional speech/general-knowledge permission exists unless its server policy boolean is exactly true. This is operator-reviewed permission, not automatic natural-language discovery. Missing policy means unchanged baseline. Approved exact statements render from trusted literals; false human identity/current-action confirmation literal guards apply even to references. Platform disclosure is inserted first on the initial completed candidate conversation turn; conflicting suffix placement is rejected. Direct detected AI/human questions receive a truthful server-rendered answer. The system policy remains explicit about truthful identity even when wording is not detected by the conservative heuristic.

Recognized explicit stop/non-consent language never enters open generation. If an exact approved `stopResponse` exists, it is rendered with applicable mandatory statements and further candidate turns are blocked until a new session; there is no model call or external hangup claim. If no approved stop response exists, the turn stops before model/TTS. This is a conservative lexical withdrawal gate, not a general consent/legal interpretation engine. The browser's existing Stop/close controls remain responsible for session resource cleanup; no new telephony action was implemented.

### One-call streaming and task context

The candidate adds a bounded instruction/context suffix after the unchanged original script prefix/history and calls the **same LLM adapter once**. Raw model JSONL is not spoken. Supported closed units are:

```json
{"kind":"speech","text":"Relevant optional conversational sentence."}
{"kind":"general","text":"Relevant general explanation, not a company commitment."}
{"kind":"fact","id":"approved_fact_id"}
{"kind":"question","id":"approved_question_id"}
{"kind":"answer","id":"approved_question_id","value":"literal words from current user utterance"}
```

Each complete eligible unit can feed the existing phrase stream before the model's final reply. Required prefix/suffix obligations are inserted by the server, not left to model recall. Facts/questions use exact approved text. Already answered task questions and duplicate question units are suppressed. Answer values must be bounded literal text present in the current customer utterance; they are **not verified consent, business state or tool receipts**. Full history plus snapshot objective/personality/facts/answered questions informs relevant follow-ups, objections and task progression. The final rendered spoken reply, not JSONL, is stored in history.

No tools are configured by this layer. Unknown fact IDs, actions, malformed records, unexpected fields, duplicates, missing optional permissions and recognized restricted claims stop the candidate turn. No automatic retry or switch to baseline occurs after candidate audio starts. State and history commit only after successful completion; cancellation uses the existing signal, generation rejection and accepted native drain. A subsequent explicit turn can recover with unchanged prior state.

Telemetry adds `intelligence-start`, `intelligence-unit`, `intelligence-first-safe-text`, `intelligence-first-text-chunk`, `intelligence-text-chunk` and `intelligence-complete`. Deterministic stop decisions use `intelligence-decision`/`intelligence-stop`/`intelligence-render-complete`, not fictitious LLM-call timestamps. Existing first-token, TTS, PCM and playback timing remains; raw candidate JSON token timing is not a meaningful spoken phrase. Timing events contain metadata only, no generated/customer text or policy payload. These events **do not measure physical first-audible latency**.

## Validation

Executed against synthetic/mocked engines and temporary loopback fixture servers only:

```powershell
Set-Location P:\shahvex
node --test tests/*.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Observed full JavaScript suite: **119 passed, 5 pre-existing retired-route skips, 0 failures** (124 total). TypeScript completed without errors. The new suite covers 24 intelligence cases, including:

- default/hosted OFF and unknown-policy baseline equivalence;
- unrelated agent identities/scripts/facts and strict owner/history/state separation;
- old-session snapshots versus next-session script/policy updates;
- server policy permission/binding/source validation; no request-supplied approval;
- exact disclosures/facts/conditional text, relevant general answers, missing-info clarification, objections and multi-turn answer retention using one call;
- truthful identity, unconfigured actions, recognized fabricated claims and ungrounded customer-state rejection;
- bounded/escaped incremental parsing, final/delta mismatch and no raw control speech;
- first-safe-text-before-model-completion, sequential synthesis and private timing metadata;
- cancellation at STT/LLM/TTS/playback, accepted-work drain, stale-output rejection and state rollback;
- recovery only on a later explicit turn, registry reload and authenticated existing backend/PCM integration.

These tests validate implementation mechanics with model fixtures, **not live Ollama adherence, semantic intelligence, actual spoken-word accuracy, voice naturalness, injection immunity or improved browser latency**. Generic/native performance and listening benchmarks were not rerun.

## Remaining limitations — activation gates

1. **General semantic factuality is not solved.** Exact reference rendering is deterministic, but free speech/general units remain model-generated. `safeSpeech` is a conservative restricted-claim/identity screen, not a semantic verifier. Spelled-out prices, implicit commitments or misleading paraphrases may evade lexical checks. Do not enable unrestricted candidate speech for high-risk scripts on the strength of these tests. Use trusted reference-only responses or keep the feature OFF until an adequate reviewed policy exists.
2. Policies are operator-managed and hash-bound; no automatic interpretation of every script, human approval UI, document retrieval, external tool execution or complete business workflow engine is implemented. Source inclusion alone does not make a fact current/correct; approval/provenance is the operator's responsibility. Conditional support is intentionally narrow.
3. Installed `shahvex-natural` has not been tested live against this JSONL format. A model that produces prose/fences instead will fail safely; early safe prefix audio may already have played before a later protocol error. A failed/cancelled response cannot complete a mandatory suffix; its start obligations remain pending because state is not committed. Streaming cannot retrospectively retract audio already heard.
4. General knowledge and script understanding are prompted, not verified by a second model. No second call was introduced. Literal answer extraction cannot determine negation/intent/consent; task state must not authorize an external action. No acoustic emotion inference or emotion/speed TTS parameters.
5. Disclosure bookkeeping means completed Gateway response delivery under existing callbacks, not calibrated evidence of sound reaching the customer's ears. The fixed truthful-answer heuristic does not recognize every linguistic form. The model instructions and literal screens are defenses, not universal identity-proof guarantees.
6. Existing history stays bounded to 20 messages; task-state fields are bounded by configured question IDs, not unlimited memory. Capacity remains the prior configured/default one-session queue; no concurrency claim or admission change.
7. No emergency cross-instance policy revocation system is added. Normal updates intentionally affect new sessions. Existing authorized operators can close sessions; stricter revocation needs separate design. Snapshot freezing intentionally ignores later policy-file edits for an active conversation.

## Reviewed rollout and rollback proposal — no execution authorized

First approve code/policy protocol and use a synthetic configured agent for an explicitly approved **text-only** model compatibility check. Then separately authorize a local voice pilot with fresh authenticated maintenance/idle checks and no competing native work. Evaluate the actual agent's approved script/policy, voice consistency, five matched browser turns, interruption/cleanup and actual recorded audible onset. Stop on any WAV corruption; preserve failures and do not resume transport research automatically. Native first PCM or simulated frames do not establish the 2–3-s browser target.

Future runtime package must contain exactly these dependency files, with manifest hashes verified:

```text
server.cjs
core.cjs
agent-intelligence.cjs
intelligence-policy.cjs
intelligence-stream.cjs
dialogue-style.cjs
```

No new npm/Python dependency is needed. Do not deploy the review patch without its unchanged `dialogue-style.cjs` dependency. The current deployment controller has **no AgentIntelligence patch action**; do not substitute `-Patch VoiceStreaming`, which would stage the older release. Any package/controller registration and coordinated Gateway restart must be separately reviewed through the existing maintenance/proof/DPAPI workflow, not improvised or executed here.

Before an approved installation, recheck live target hashes against the manifest and take a fresh backup of only affected files plus an absence list for newly introduced dependencies. Existing saved review baselines are core SHA256 `6d378952053861e66e36594ad788b7d5f310cb40068b4d7ba00d79d9c17f6617`, server SHA256 `ed75e21f899fa71f42910c2b8e6af61be380c995373128e520c71f3860725bf6`; mismatches require review, not forced replacement. Preserve all other files, contract, tokens, voices and AI services.

Flag-only rollback applies at Gateway startup: setting the variable to 0 **does not alter a running process**. Any restart requires approval. For code rollback, restore the backed-up current VoiceStreaming `core.cjs`/`server.cjs`, remove only newly introduced files whose hashes/absence were verified, and use the existing approved Gateway-only recovery procedure with the same credentials. Do not restore pre-streaming code, reset the database, stop other AI services or delete policy/evidence indiscriminately. Retest authenticated health, normal/cancelled sessions and cleanup before releasing maintenance under explicit approval.

Current state remains: repository implementation default OFF, **not deployed and not physically evaluated**.
