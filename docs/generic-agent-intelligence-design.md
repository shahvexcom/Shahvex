# Generic, dynamic agent intelligence — revised proposal

3 November 2026. **Design review only. No production code/service/configuration/database/credential/maintenance change, deployment, restart or live inference.** Generic/native benchmarks and the paused transport investigation were not repeated. All prior audio and diagnostic findings remain preserved.

## Decision and superseded assumptions

Build an optional **script-driven contextual response layer**, not a Jennifer-specific personality and not a whole-conversation response-ID catalog. Jennifer and the approved short-text pairs are evaluation fixtures only. Agents may have unrelated identities, domains, objectives, styles, knowledge and allowed actions without Gateway/TTS source changes.

This supersedes two parts of earlier proposals:

1. **Do not constrain all answers to prewritten response IDs.** Generate relevant explanations, questions and follow-ups using the current single Ollama call. Reserve trusted literal rendering/IDs for exact statements, verified fact blocks and confirmed action results.
2. **Ordinary script edits affect subsequent authorized sessions, not the script halfway through an ongoing conversation.** Pin the script/configuration/policy snapshot for that session. Security revocation is a separate stop condition, not an ordinary script update.

The old prompt-only style patch and `locked-response-review.cjs` remain evidence/proofs, not this feature's deployable implementation. No manual export is required during normal operation.

## 1. Current architecture: verified source, not new functionality

| Current component | Existing behavior | Consequence for proposal |
|---|---|---|
| `app/api/admin/local-voice/route.ts` | Authenticated local creation obtains selected approved controller agent through current export workflow, composes optional test instructions and creates a relay | Reuse authorization; do not trust caller-supplied identity/policy |
| `app/api/admin/agents/gateway-export/route.ts` | Selects current assigned text for approved non-BPO controller agent; one verified native default voice | Not a universal BPO/voice/knowledge resolver; don't broaden its privileges or silently assign that voice to all agents |
| Admin/BPO script assignment routes | Existing role/ownership-checked assignment/update workflows | Remain unchanged for users; normal scripts still work with feature OFF |
| `Gateway.create` | Validates voice/configuration; `structuredClone(config)` per owner-scoped session | Existing foundation for immutable session snapshots |
| Capacity defaults | Gateway defaults to one active session; bounded worker queue | Generic agent support does not establish concurrent-call capacity; no admission/load changes proposed |
| `Gateway.turn` | STT, one streaming Ollama call with full script and bounded history, `PhraseStream`, one sequential TTS consumer | Preserve overlap, 40-character clause rule, sentence rules and cancellation/native-drain behavior |
| Successful turn commit | Stores user/rendered assistant history after successful audio delivery; last 20 messages retained | Do not claim unlimited memory or commit cancelled proposals/actions |
| `services.cjs` | Existing model, bounded streaming JSON parsing and strict native WAV validation before PCM | No voice/model/sampling/precision/transport changes |
| Admin documents route | Exposes stored script/lead files and previews | No implemented general RAG/vector search or verified-company knowledge API established by this inspection |
| Telephony adapter | Interface pending confirmed client media/API contract | No active VICIdial or external booking/payment capability should be inferred |

The current system instruction identifies the agent internally as automated but does not mechanically prepend that sentence to each emitted reply. Candidate disclosure state must avoid unnecessary reintroductions without concealing required disclosure.

## 2. Minimum module and session model

Proposed trusted backend snapshot, resolved once at session creation through the existing authorized agent/assignment workflow:

```text
tenant + actor/owner authorization scope + agentId + assignmentId
agent identity/role + verified voice profile + assigned script
effective composed instructions + script/config/policy hashes
compiled mandatory rules + verified company-fact snapshot/provenance
permitted knowledge/tool capabilities + approval/compiler version
```

Unknown or unsupported voice mappings do not default to Jennifer. Keep each eligible agent's existing verified profile. Never copy her script, role, domain, company facts or style into defaults.

Session-local state contains bounded history, validated customer-provided answers and their source, task progress, pending clarification, disclosure obligations and confirmed tool receipts. Distinguish `requested`, `pending`, `confirmed`, `failed` and `cancelled`. A model suggestion is not verified business state. Customer-provided facts do not become authoritative company policy. Avoid repeating answered questions when evidence is clear; clarify conflicting/ambiguous answers rather than guessing.

Ordinary assignment/config/knowledge edits invalidate the **latest-version cache/policy binding for new sessions**. A new session loads the new version and requires appropriate validation. Existing sessions keep their pinned version and history; they do not inherit new text or silently switch branches/voices. Retain versioned policy entries while sessions reference them. End/reauthorize a session explicitly if the operator wants an update applied immediately. Permission withdrawal, prohibited-action changes or emergency compliance revocation can cancel active sessions through existing generation/drain controls; do not mistake that for routine hot replacement.

Cache/policy identity includes tenant, agent, assignment, exact assigned/effective script SHA256, relevant configuration/knowledge versions and compiler/approval version. Do not key on names, filenames or creation timestamps; the existing update flow can edit text without a new creation time. A cache alone is not an authorization source or cross-instance revocation mechanism.

## 3. Instruction priority, dynamic script meaning and permission

Use this explicit precedence:

1. Platform safety and reviewed applicable legal/disclosure obligations.
2. Authorized agent identity/configuration, subject to level 1.
3. Mandatory script instructions, exact wording and business/conditional restrictions.
4. Retrieved **verified** company knowledge with provenance/freshness/scope.
5. Relevant general factual knowledge, clearly not a company commitment.
6. Optional conversational style and concision.

Separate immutable **script source** from mandatory **spoken literals**. A script's task instruction is not necessarily a sentence to repeat aloud. Preserve instructions/facts/constraints; allow contextual language where explicitly permitted. Ambiguous exactness or optional permission remains locked/pending validation, not silently reclassified by the model. Unmarked legacy scripts continue their existing baseline operation; optimized mode defaults OFF until policy is established.

A lightweight compiler recognizes supported explicit exact-text/disclosure/fact/action declarations and binding configuration. It does not claim to fully interpret arbitrary prose law/business rules. Optional ranges/alternatives must be authorized by the existing appropriate script/compliance authority, through a future reviewed structured declaration in the normal editor or a server-owned policy registry. Uploaded `approved:true`, a customer's instruction or a retrieved document cannot grant authority. No script-format migration or manual export is required for baseline use. Complete semantic policy/approval persistence remains an implementation decision, not a capability already present.

Do not add a second LLM call to infer permissions. Complex/unclear conditional obligations require policy review or a conservative clarification branch. Never let ordinary style instructions override mandatory wording or change a business fact.

## 4. Contextual reasoning and knowledge boundaries

Compose the single existing Ollama request from pinned identity/task/script, current session history/state and a bounded relevant source pack. Questions need not appear verbatim in the script. A relevant plumbing-service follow-up, for example, may receive a cautious general explanation from model knowledge; a price, service-area promise or availability statement must come from current verified company data. Missing company facts require a concise question or explicit limitation, not a plausible number.

Default retrieval can be absent; do not introduce a vector database or indexing service. For future documents, use only configured authorized readers, tenant/agent filters, provenance, freshness and size limits. Retrieved content is untrusted **instructionally** even when a particular factual claim is approved: documents/customer text cannot change priorities, disclose secrets, authorize tools or switch agents. Conflicting/stale company sources produce clarification, not arbitrary source selection. No actual document retrieval was run here.

Task progress uses the customer response and relevant script, rather than a fixed Q&A list. Select a useful next question, objection response, explanation or permitted action. Do not hardcode supported business domains. Tool capability descriptions are supplied by configured integrations, never invented by a model. Validate action arguments, authorization, prerequisites, consent and idempotency before executing. Do not say booked/paid/updated/transferred without a matching successful result. If no integration exists, explain the limitation or collect a request without claiming completion. No new side-effectful integration is activated by this design.

Normal no-tool turns retain **one LLM call**. If an approved action needs a result mid-turn, prefer a trusted literal confirmation/limitation from its actual receipt, with no extra call. A second reasoning call, if indispensable in a later tool design, needs separate latency/behavior review; it is not hidden in the baseline feature.

## 5. Open generation with bounded deterministic controls

Avoid an upfront whole-reply plan that delays the first useful phrase. Candidate protocol proposal: a bounded stream of small typed units from the **same** Ollama stream, parsed incrementally, each closed unit eligible for rendering:

```text
speech(text)                 contextual explanation/question
fact(referenceId)           authorized company fact -> trusted rendering
required(referenceId)       exact literal -> trusted source text
action(proposalId, arguments) configured action request, never spoken as success
```

The model's `kind` label is untrusted, not proof a statement is safe. A policy gate checks current obligations, authorization, eligible fact IDs and action receipts before each unit. For required opening/consent text with deterministic workflow triggers, the orchestrator schedules the literal itself; it must not depend on the model remembering to emit `required`. For ambiguous branches, clarify instead of guessing an obligation. Exact-span overlap, repetition and order constraints are tracked across units/phrases. Unknown IDs, malformed/oversized units, forbidden actions or unmet mandatory-before-speech obligations fail before that unit reaches TTS. Never read raw JSON/control markers aloud.

Bound record size/total text by existing limits; no tool result, permission or mandatory metadata preamble must wait for an entire response. Rendered text feeds the existing unchanged `PhraseStream` and sequential native consumer. A renderer must return the exact concatenated spoken text as the final reply so existing final/delta consistency and history checks remain meaningful. Keep cancellation signal/generation validation throughout.

Critical limitation: open-ended semantic truthfulness **cannot be guaranteed by typed labels, a substring/number regex, or prompting**. Deterministic enforcement covers exact literals, known fact/action references and identified workflow obligations; it does not prove every generated explanation is factually correct. High-risk company commitments must use verified renderer paths, and candidate general speech must be evaluated for disguised/implicit company claims. If a script's risk/constraints cannot be enforced to its approved standard without full-reply validation or extra reasoning, keep candidate mode disabled for that script. Do not sell a universal hallucination-proof stream.

The typed stream is a proposed protocol change, not a supported current Ollama/Gateway capability. Current `services.cjs` only exposes raw content deltas. Before implementation approval, choose and test record framing/escaping/limits against the installed model. Measure complete-unit latency; do not assume a small JSON unit is free or that safe early speech is always possible.

## 6. Identity, disclosure and conversational style

Support neutral, warm, reassuring, **professional** and serious as contextual **text styles**, not five TTS emotion sliders. Combine explicit words, task intent and pinned personality. Do not infer an emotion confidently from weak acoustics. A personality may prefer formal/informal language; mandatory content and factual boundaries still win. Use only relevant optional acknowledgements; no routine repeated introductions, filler or arbitrary one-sentence cap when the task requires detail.

A configurable introduction can express the approved name/team/role without claiming human status. Disclosure timing is controlled by the reviewed platform/workflow policy: at required points and truthfully on a direct AI/human question, not automatically in every reply. A script cannot suppress a higher-priority obligation. Disclosure completion requires the defined delivery evidence, not merely a queued model token. If interruption prevents completion, leave the obligation pending. Existing playback delivery acknowledgments must be assessed before claiming physical delivery is known; no such new protocol was implemented here.

## 7. Exact proposed code scope — future patch only

| File/module | Proposed change |
|---|---|
| New shared server `lib/agent-runtime-context.ts` | Build trusted context through existing admin/BPO ownership checks; current assignment/voice/config snapshot; no browser impersonation or manual export |
| New `gateway/intelligence-policy.cjs` | Generic versioned policy compiler, source/hash/tenant binding, mandatory/fact/action obligations and capability eligibility; no agent content constants |
| New `gateway/agent-intelligence.cjs` | Pure `createSnapshot(context)`, `prepareTurn(snapshot,state,history,userText)` and response/task-state orchestration; five contextual style intents |
| New `gateway/intelligence-stream.cjs` | Bounded incremental record parser and unit-to-trusted-text renderer with exact literal/fact/action gates and cancellation |
| `gateway/core.cjs` | Optional `intelligence=null` constructor hook; pin snapshot at create; branch request/renderer only when trusted candidate policy is enabled; history receives rendered speech; existing OFF branch unchanged |
| `gateway/services.cjs` | Optional single-call protocol request support only if required by chosen framing; same existing model/options, streaming transport, limits and native-drain behavior; no TTS client patch |
| Authorized local session creation integration | Pass backend-resolved snapshot/feature eligibility; retain existing role, local-origin, approval and voice checks; no database schema or assignment UI redesign |

Conceptual core seam (not an applied diff):

```javascript
// Session creation: trusted already-authorized data, never client approval flags.
session.intelligence = intelligence?.createSnapshot(trustedContext) ?? null;
// Turn: baseline path stays exactly as-is when no eligible snapshot exists.
const plan = session.intelligence && intelligence.prepareTurn(
  session.intelligence, session.taskState, session.history, customerText);
// Same one llm call; optional unit renderer emits only eligible spoken deltas.
// Existing phrase stream, TTS consumer, signals/drain and playback remain unchanged.
```

These interfaces need implementation review after protocol/policy decisions. They are not new exported runtime APIs, tested integrations or a drop-in patch. Do not combine/apply the earlier response-ID-only patch as if it implemented this architecture.

## 8. Latency/naturalness evaluation and rollout

Current measured recorded-conversation median remains **5.62 s**, not changed by native testing. Native concise-opening optional cases improved first-valid-PCM median 2.714→1.603 s in the completed randomized corpus; that does not include STT, endpoint, model-unit generation, browser scheduling or acoustic output. First-WAV composite remains the largest regular measured stage; native GPU-only cost was not separated. Do not change the voice model/parameters, 40-character rule, VAD, STT, native drain, playback buffering or cancellation to manufacture a speedup.

Start with offline multi-agent prompt/unit/state tests and existing audio. No additional generic TTS benchmark is needed now. Verify generated candidate text before any later approved audio test. A future physical pilot requires explicit approval, fresh authenticated maintenance/readiness/idle checks and no competing native tests. Preserve strict WAV integrity; stop on corruption without retry and report failed/unrun denominators. No transport research is resumed automatically.

Matched baseline/candidate five-completed-turn sessions should cover an actual relevant unscripted question, factual limitation, history-dependent follow-up/objection, interruption and conditional task step. Record actual speech-end→audible output on a calibrated shared timebase; distinguish raw first-token, first complete safe unit, valid PCM, scheduled playback and physical onset. Report per-turn/median/worst and genuine phrase starvation gaps. Retain cancelled attempts separately. Target median <=3 s and >=20% faster, no completed response >5 s, no audible phrase gap >500 ms, zero mandatory/fact/action/identity violations, stale audio or integrity failures. Targets are not demonstrated results. Respect script-required natural pauses; if the strict gap target conflicts, report it rather than silently excluding pauses.

Proposed server-only `SHAHVEX_AGENT_INTELLIGENCE=0` by default. Initial testing remains local-only under existing hosted/production denial gates. Enable only reviewed tenant/agent/script/policy combinations; do not create a special Jennifer branch. Roll out first to mocked fixtures, then separately approved text/model evaluation, then one local browser test agent and a second unrelated agent. No production generalization until isolated histories, source versions, facts/actions and disclosure tests pass. A live feature flag is not permission to start services or inference.

## 9. Rollback and authorization boundary

OFF must delegate the original request construction and one model call with byte-equivalent messages and unchanged audio behavior. End only a candidate test session when rolling back; do not mix candidate state into a baseline continuation. Preserve its logs/recordings. Before any later approved installation, back up/hash the then-current **VoiceStreaming** baseline using the existing controller workflow. Restore only reviewed changed files and disable the candidate flag, with separate approval for any required restart. Do not restore pre-streaming code, rotate credentials or change scripts/database/models.

Current state: design documents/profile proofs only; **no implementation or deployment approval inferred**. No facts about Jennifer's actual campaign, Lissa's voice or unconfigured tools were invented. See `generic-agent-intelligence-test-plan.md` for the required regression matrix and unresolved gates.
