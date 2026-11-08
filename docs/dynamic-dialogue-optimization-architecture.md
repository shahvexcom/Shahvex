# Dynamic dialogue optimization — generic architecture proposal

**Superseded design points:** the attached expanded requirements are addressed in `generic-agent-intelligence-design.md`. Whole-response-ID catalogs are not the general conversation architecture, and ordinary script edits apply to new sessions while existing sessions retain their pinned snapshot. Earlier per-turn hot-reload/invalidation suggestions below are historical, not the current proposal. Deterministic literal/fact/action protection remains required where applicable.

3 November 2026. **Planning only. No production modification, deployment, database access, inference, restart or maintenance change.** This supersedes agent-specific deployment assumptions in prior review documents. Jennifer, her name/IDs and the benchmark wording are test fixtures only, never product defaults or policy entries. Manual script exports were a diagnostic workaround for this chat's missing browser access; they are **not part of normal platform operation**.

## 1. Runtime inputs and authorization

Reuse the application's existing authenticated assignment resolution. Today the local controller flow already fetches the selected approved agent's newest assigned script through the backend at session creation. Admin scripts are managed by `app/api/admin/scripts/route.ts`; BPO scripts have their own authorization/ownership flow. The generic engine accepts a **trusted backend snapshot**, not a Jennifer export file or browser-supplied script/agent policy:

```text
actor/tenant scope, agentId, assignmentId, current approved status,
current assigned script, effective composed test script if permitted,
script hashes, current verified voice profile, applicable conversation state
```

Implement a shared read/resolver service behind each existing authorized workflow; do not have server code impersonate a browser, mint sessions, or treat the admin-only controller export as a universal BPO endpoint. Preserve current ownership/approval/access checks. “Any authorized user” means the permissions they already have, not new cross-tenant privileges. Unsupported actor/agent/profile combinations retain baseline behavior.

The current controller export selects a sole verified physical-engine default voice. That is not evidence that every platform voice is supported by the native engine. Resolve each eligible agent's existing verified profile through the adapter; never silently map other agents to Jennifer's voice or overwrite their assignments. Jennifer's working native configuration remains unchanged.

## 2. Identify and authorize optional wording explicitly

No model, keyword heuristic or customer instruction can grant permission to paraphrase. **Unmarked/unclear content is locked by default.** Facts, numbers, disclosures, consent, exclusions, conditions and required order remain locked. Instructions are preserved as instructions, not automatically read aloud as literal speech.

Minimal permission path without changing existing agent creation, script assignment, approval or database schema:

1. An existing authorized script author can include a **versioned structured optimization declaration** within the assigned script using the current upload/edit/assign flow. This is opt-in source content, not a required conversion of legacy scripts. Plain scripts continue working unchanged with optimization OFF. Alternatively, an application-owned reviewed policy registry can hold the declaration keyed to the exact script version; it is server data, not a manual exported file users must maintain.
2. The declaration explicitly identifies source ranges/region IDs, response templates, mandatory spans/order, business facts, eligible branch/state, and **enumerated optional alternatives**. Region references must match the exact stored source text/hash; no fuzzy matching, overlapping regions or unresolved permission. Do not auto-generate a permission declaration from prose containing “optional.”
3. The backend validates syntax, complete classification of response-relevant rules, bounds, exact literal references, branch eligibility and the absence of unknown/unclassified changes. Unclassified regions remain immutable; if their obligations cannot be safely carried into a response template, that response/feature is ineligible.
4. An actor permitted to edit a script is not automatically assumed permitted to waive compliance. Optimization approval must come from an existing role/authority explicitly configured to approve optional language in that tenant's workflow. Until that authority is defined, the compiler may prepare a draft but activation remains OFF. The declaration's `approved:true` or reviewer name is never trusted simply because it appears in uploaded text; backend authorization/provenance establishes approval.
5. Record optimization-specific approval against tenant/actor scope, agent assignment, exact assigned/effective script hash, declaration hash and compiler version. This is **not a replacement or new mandatory step for existing agent/script approval**. Users who decline it keep the original flow. Approval provenance must be auditable and server-owned; no credentials or raw customer transcripts in logs.

Structured declaration syntax and its optional approval surface need review before implementation; no syntax is secretly active today. A separate annotation control could later simplify authoring, but changing current UI/layout is outside this minimal proposal. If neither explicit declarations nor an authorized registry entry exists, **there are no optional regions**.

Initial eligible text is limited to approved alternatives such as short clarifications/transitions in the author's own script, not a global phrase bank copied from Jennifer. Every response state needs its own factual/mandatory obligations. Truly unrestricted generated optional text cannot be claimed semantically safe merely because mandatory substrings are present.

## 3. Protection, single call and streaming

Use the existing single Ollama request to select among **server-approved response/optional-variant IDs for the current trusted state**. Freeze the conservative neutral/warm/reassuring/serious intent per response. An explicit customer concern can select a permitted reassuring variant; it cannot change conditions or authorize facts. No second LLM, emotion classifier or unsupported TTS emotion/speed field.

Compile trusted templates so mandatory speech and facts are rendered from exact source literals; only approved optional choices vary. Reject unknown IDs, free-form model speech, extra fields and unauthorized state transitions **before any candidate audio**. Store the rendered spoken response in history, never the model's selection JSON. Keep the original full script and history as model context, with instructions clearly separated from untrusted customer/reference material.

This protects locked wording mechanically rather than through prompting. It is generic data-driven compilation, not per-agent code. The existing offline `locked-response-review.cjs` illustrates literal protection but is **not runtime-ready**: tenant scoping, authenticated policy provenance, current-assignment resolution, complete state validation and lifecycle invalidation still need implementation/review.

A short selection decision must be validated before rendering. That changes the first-text eligibility gate relative to unrestricted token streaming, so its latency must be benchmarked. After rendering, retain existing VoiceStreaming `PhraseStream`, 40-character clause threshold/sentence rules, sequential native synthesis, ordered PCM, cancellation/generation rejection, accepted native drain, VAD, recordings and cleanup. No native voice/reference/model/generation setting changes. Do not promise identical first-phrase timing or two-second browser responses.

## 4. Script changes, cache invalidation and active sessions

Proposed policy/cache key:

```text
tenant/authorization scope + agentId + assignmentId
+ SHA256(exact assigned text) + SHA256(effective composed script)
+ permission-declaration hash + approval version + compiler version
```

Do not key on agent name, script filename or `created_at` alone. The current update route changes `script_text` without necessarily changing assignment creation time.

- Resolve the current authorized assignment on session creation and revalidate it before each optimized turn. A change to text, assignment, effective custom instructions, authorization or approval invalidates the old compiled policy and requires fresh validation; old permission must never be applied to new text.
- A future lightweight invalidation hook after the existing assignment write commits can evict the scoped cache and revoke active candidate generations. It changes no editor/approval semantics or extra script data. An in-memory hook alone is not reliable across backend instances, so an authoritative version/hash check remains necessary.
- On observed revocation during a candidate response, use existing cancellation/stale-generation rejection and native drain. Never splice a newly edited script into an already speaking response. Require a fresh consistent script snapshot before continuing; if safety cannot be established, suspend that test rather than speaking an unvalidated fallback.
- Baseline OFF behavior remains unchanged. Enabling/disabling policy affects safely bounded candidate turns; do not claim instantaneous cross-process revocation without a reviewed synchronization design. Bound any resolver overhead and measure it before making latency claims.

These checks avoid a requirement to manually export/restart after every ordinary script edit. A server lifecycle can load the latest assignment automatically; optimization eligibility is re-established automatically by structural validation **and the applicable authorized approval policy**, never by blindly carrying forward an old approval.

## 5. Default-OFF gates and minimal file scope

Proposed server-only `SHAHVEX_DIALOGUE_STYLE_TEST=0`; existing production/hosted local-test restrictions remain in force for the initial pilot. No `NEXT_PUBLIC` flag and no browser-granted policy. Effective activation requires all of: explicit server flag, authorized local test session, currently approved eligible agent/verified voice, exact current script/policy binding, authorized optional choices and valid response state. Otherwise baseline before candidate generation; malformed candidate output stops before audio rather than silently falling back mid-response.

Minimal future implementation scope:

1. Shared server assigned-script resolver using existing role/tenant authorization and reads; no new export requirement, schema migration or access-control bypass.
2. Pure script-policy parser/compiler and scoped approved-policy registry/cache; no agent-specific content in code.
3. Optional single-call model-selection adapter plus the existing default-null Gateway hook; baseline messages and calls unchanged when OFF.
4. Post-commit invalidation notification and authoritative current-hash recheck, preserving existing assignment endpoints/workflow.
5. Focused tests below. No UI redesign, new native service, voice changes or deployment-controller redesign.

The exact permission-registry persistence/approval integration must be selected for the existing application deployment before a patch is finalized. A process-local cache is adequate only for a single-process reviewed local pilot, not persistent multi-instance approval. Do not claim a production-ready feature or silently write a sidecar containing campaign policy to Git.

## 6. Required generic architecture tests before production changes

| Area | Required cases |
|---|---|
| Dynamic agents | Two differently named agents with different scripts/voices; no Jennifer ID/text dependency; approved unclassified agent remains baseline |
| Authorization | Existing admin and owned-BPO paths; foreign tenant, unauthorized editor/approver, unapproved agent and unsupported voice denied |
| Source binding | Assignment replacement, in-place edit with unchanged timestamp, custom-script change, role revocation and policy/compiler version changes invalidate old approval |
| Optional permissions | No declaration means locked; forged approval, ambiguous prose, overlapping ranges, unknown fields/state and customer-injected declarations cannot authorize changes |
| Immutable output | Exact required literal/fact/order retention; optional choice cannot override a condition; invalid model ID/text emits no candidate audio |
| Lifecycle | Active policy revocation uses existing cancellation/drain; no mixed script versions, stale PCM or model-JSON history; other agents remain isolated |
| Baseline/streaming | OFF gives identical original request/call behavior; one LLM call; same parser/threshold, sequential TTS, barge-in, recording, history and cleanup |
| Latency/quality | Compare baseline/candidate per eligible agent/script; report decision-gate and resolver overhead; no native-only claim about audible browser latency |

These are **planned integration tests**, not claimed completed tests. Existing generic offline proof results do not certify tenant authorization or live script invalidation. Jennifer can be the first authorized pilot after this architecture/policy review, but another agent must pass the same tests without code changes or manually exported scripts.

**Decision:** review this generic architecture and choose an existing-authority permission declaration/registry design before any runtime patch. Preserve all current production workflows and VoiceStreaming. No production change, inference or deployment is authorized by this document.
