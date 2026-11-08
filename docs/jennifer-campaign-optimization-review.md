# Jennifer campaign optimization: disabled pending script authorization

Architecture clarification: `docs/dynamic-dialogue-optimization-architecture.md` is the current platform-wide proposal. Jennifer-specific file exports below are optional diagnostic snapshots for review, never a requirement in the product or a source of hardcoded agent policy. No runtime implementation may depend on Jennifer's name, ID, text or voice.

3 November 2026. Reviewed application source and prepared offline protection tests only. **No database query, authenticated-session extraction, inference request, generic/native rebenchmark, production code/configuration change, maintenance change, credential change, restart or deployment.** All benchmark audio/metrics and paused transport findings remain preserved.

## 1. Actual-script access and classification status

The existing authorized path is the local controller's Local Voice Studio in **Assigned Script** mode. Its current implementation requests `/api/admin/local-voice?scriptAgentId=<id>`, which delegates to `/api/admin/agents/gateway-export?agentId=<id>`. The export validates the existing ADMIN session, requires an APPROVED non-BPO controller agent and selects the latest `script_assignments.script_text`. No explicit optional-wording policy is exported.

This session has **no connected authenticated application browser**; document-session discovery was unavailable. No JWT was minted, cookie obtained, credential used to bypass application login, or direct database connection attempted. The export's `db()` call can run schema initialization on a fresh server process, so it was not invoked to claim an unconditional no-write operation. Source inspection verifies the retrieval rules, not Jennifer's current script content or approval.

| Required classification | Actual Jennifer status |
|---|---|
| Mandatory verbatim wording | Unavailable; do not infer from generic fixtures |
| Disclosures/compliance | Unavailable; no campaign-specific wording verified |
| Business facts/fixed responses | Unavailable; no values invented |
| Conditional conversation rules | Unavailable; no branch eligibility inferred |
| Explicitly optional language | **None authorized** |
| Unclear/unclassified text | Treat the entire unavailable script as immutable; feature disabled |

### Obtain a local review copy without a new backend/database request

In the already signed-in **local** controller, use Jennifer's existing modal with its **Assigned Script** already loaded. Do not edit it or start a conversation. The following DevTools snippet saves only the displayed assigned-script snapshot; it does not fetch a route, alter app/database records, or disclose cookies/tokens:

```javascript
(() => {
  if (location.origin !== 'http://127.0.0.1:3000') throw Error('Use the signed-in local controller');
  const dialog = document.querySelector('[role="dialog"]');
  const text = dialog?.querySelector('textarea[id^="script-"]');
  if (!text) throw Error('Open Jennifer’s existing Local Voice Studio');
  const label = dialog.querySelector(`label[for="${CSS.escape(text.id)}"]`);
  const name = dialog.querySelector('h2')?.textContent?.trim();
  if (!/^jenn?ifer$/i.test(name || '') || !label?.textContent?.includes('Assigned Script'))
    throw Error('Require Jennifer and Assigned Script mode; do not export custom instructions');
  if (!text.value.trim()) throw Error('Assigned script is not loaded');
  const snapshot = {agentName:name,agentId:text.id.slice('script-'.length),script:text.value,
    source:'existing assigned-script UI snapshot',capturedAt:new Date().toISOString()};
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)], {type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download='Jennifer-Assigned-Script-Review.json';
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
})();
```

Give the local saved file path only; do not paste cookies or tokens. The snapshot represents what the modal currently displays, not an independent fresh database attestation. Verify its current approval through the existing application/owner workflow. If the campaign permits optional wording only in a separate client instruction, supply that approved policy as well; silence or the word “optional” in customer text is not authorization. Keep exported campaign material private and out of Git.

After access: bind the source hash and annotate every source range as verbatim, fact, instruction, conditional, explicitly optional or unclear. Require full coverage and no overlap. Record exact quotes and positions, conditional prerequisites, required output order and provenance of optional permission. Do not paraphrase locked wording in the classification. Any unclear range keeps candidate activation disabled.

## 2. Recommended protection beyond prompts

The prior prompt-only style patch is **not sufficient for this campaign guarantee**. Appending “preserve mandatory words” cannot ensure the model's free-form streamed output does so.

Minimal bounded candidate: trusted approved **response templates/choices**, with locked content rendered from exact server-owned source ranges. Only the audited optional alternatives vary. The existing single Ollama call selects a small response ID from the current server-approved conversation state; **generated speech text is not accepted**. After complete decision validation, the server returns only the already compiled trusted response to the existing phrase/TTS pipeline. No second LLM or acoustic classifier.

The backend, not the model, determines which response IDs are eligible for the reviewed script state (consent, refusal, clarification, etc.). Fact values and conditions are never filled from arbitrary model strings. Unsupported questions use only a specifically approved clarification/stop path, or fail before audio; never fall back to unvalidated text after partially emitting a candidate response. If the required state/response inventory cannot be enumerated safely, the feature stays disabled.

`gateway/style-review/locked-response-review.cjs` is a **new offline proof module, not imported by production**. It demonstrates:

- default off; deny wrong agent/campaign/script hash/state or unclassified source regions;
- exact full-script range partition; locked text comes from original source slices, optional text only from enumerated reviewed alternatives;
- required-span order checks for each trusted response plan;
- model decision limited to one approved `responseId`; free-form text, extra fields and unknown IDs rejected before audio;
- immutable compiled snapshot, preventing later input-policy mutation from changing rendered words.

It does **not** authenticate users, derive campaign rules, validate a reviewer's semantic policy, integrate a flag, execute Ollama, arbitrate runtime campaign state or certify TTS pronunciation. A human-approved state/response catalog must list **all** required spans for each response, including factual/conditional obligations; the model cannot supply that catalog. Literal text protection prevents LLM paraphrasing, but spoken accuracy still requires voice listening/acceptance.

This constrained selection can limit free-form conversational flexibility. It also waits for a short complete ID before rendering, unlike current first-text-phrase streaming. Existing PCM streaming, sequential synthesis and 40-character splitting are reused after that gate, but first-audio impact must be measured. Do not promise it preserves the current LLM-to-first-phrase timing. If preserving unrestricted text streaming is mandatory, this safety requirement cannot be met by the current prompt-only helper; do not deploy it anyway.

## 3. Default-OFF server feature proposal

Proposed `SHAHVEX_DIALOGUE_STYLE_TEST=0`, server-only; no environment/launcher file was edited. Flag on is necessary but not sufficient: reuse existing local-only, authenticated/admin, production/Vercel/Railway denial gates, and require server-owned approval bound to Jennifer's agent, campaign, **full active composed script hash**, policy version and eligible response state. Missing/changed policy or script means baseline with flag effectively off **before creating a candidate turn**. Customer prompts, browser flags and custom test text cannot authorize optional language.

Runtime scope to review after script/policy approval:

1. `gateway/dialogue-style.cjs`: retain conservative per-response neutral/warm/reassuring/serious selection; use it only to choose among permitted optional variants, never to change locked literals. Default neutral on uncertainty; preserve stop/consent priority.
2. Reviewed server-owned compiled response-policy helper and optional single-call LLM adapter: request only an allowed response ID, validate the full decision, render exact approved text. Raw model deltas must never be forwarded as speech in candidate mode.
3. Minimal `gateway/core.cjs` hook to select the adapter once per turn under the trusted policy/flag. Flag off must delegate the original call with unchanged arguments/messages; preserve original cancellation signal, queue/drain, phrase consumer, history commit and cleanup.

The controller's assigned script/database, approved facts, voice/reference/model/settings, 40-character clause threshold/sentence rules, VAD, barge-in, recording and ordered PCM playback remain unchanged. The history must store the rendered spoken reply, not the model's JSON decision. Candidate policy is session-scoped; a custom-script edit changes the active hash and disables it unless separately reviewed. No production patch/package is prepared because actual script permissions and runtime state are not yet known.

## 4. Tests and release gates

New offline proof: **3/3 tests passed**, covering default denial, wrong identities/hash/state, unclassified source, exact literal rendering, unknown/free-form/extra-field output rejection, post-review mutation, missing/reordered required text and unauthorized optional choices. These use synthetic wording, not Jennifer's actual campaign. No generic/native benchmarks were repeated.

Before any approved integration/pilot, require:

- Jennifer's complete actual script classification and explicit optional-region/state approval; no unclassified sections.
- Compile every allowed response/variant; verify required exact spans/positions, facts and flow for that state. Invalid/missing decision produces no TTS request. Test injection attempts and all mandatory literal changes, including negation, numbers and omitted consent.
- Flag-off byte-identical baseline model requests and behavior; local/session/agent/hash isolation and hosted denial.
- Exactly one model call per turn; raw decision deltas never reach audio/history. Cancellation during decision selection, STT, synthesis/playback drains/rejects stale work; no duplicated or missing words across rendered phrase boundaries.
- Existing VoiceStreaming/barge-in/recording/cleanup regressions stay green. Separate manual spoken-word and identity checks are mandatory; exact submitted text is not proof of pronunciation.

## 5. Actual-script matched browser acceptance — blocked until script access

Prepare question wording only **after** the real conditions/facts are classified. Do not invent a campaign offer, consent question or disclosure now. Use identical actual assigned/composed script hash, device, warm state and five customer questions in separate baseline and candidate sessions; randomize order and never overlap. No real calls. Consent to local two-sided recording first.

1. Approved opening and actual next-step question: check exact disclosure and unchanged mandatory-first timing.
2. Follow-up referring to a verified business fact from turn 1: test history and exact fact retention.
3. Explicit concern/clarification about a real permitted topic: test restrained reassurance without added guarantees.
4. Actual permitted question, interrupt during reply, then ask its replacement: report the cancelled attempt separately and obtain one completed replacement response.
5. Actual consent/condition question under its verified branch, then Stop/close: check exact words, condition handling and resource cleanup.

Five completed responses per session, plus the separately reported interrupted attempt. Correlate per-turn existing timing events with independently recorded physical customer speech/output on a common calibrated timebase. Record actual speech-end→first audible response, not HTTP completion or `playback-scheduled`. If only mixed digital capture is available, label it accordingly and do not claim physically audible latency. No new capture software/configuration is authorized.

Acceptance targets, **not results**:

- Candidate actual-audible p50 **<=3.0 s and >=20% faster** than matched baseline; worst completed response **<=5.0 s**. Retain every valid slow turn; five turns are a pilot, not a reliable population p95.
- **No audible inter-phrase gap >500 ms**; record natural pauses separately but do not silently exempt them from this stated target.
- Zero mandatory-word/fact/flow violations, stale audio or WAV integrity failures. Stop the test on corruption; no automatic retry. Zero freeze, duplicate session or lost conversation context.
- Preserve recognizable Jennifer voice/accent and acceptable naturalness; use the existing final scorecard (candidate medians >=4/5, no decline against baseline, no critical voice/pronunciation defect). No claimed improvement without actual listening.
- Barge-in stops old output within 300 ms of confirmed interruption onset, replacement completes, and old history/audio never commits. Log raw speech onset and confirmation separately.
- Stop/close releases microphone/playback/streams and returns authenticated session/queue/relay counters to zero within 5 s. Do not infer success from failed authentication.

Report per-turn timing, p50/worst, phrase gaps, interrupted/failed/unrun attempts, measurement uncertainty and review of required spoken words. Passing a test is not deployment approval.

## 6. Deployment safety and rollback

**Status: campaign feature disabled; deployment NO-GO pending actual script/policy.** No existing rollback is needed because production was not changed.

Before a later separately approved patch, use the existing controller/maintenance/proof workflow to back up and hash the then-current approved VoiceStreaming files. Apply only reviewed changes after permission; never use an older pre-VoiceStreaming restore. Disable the candidate flag/adapter for new sessions to recover baseline. End only the test session; restore only touched files from those backups if needed, verify hashes, and obtain explicit approval for any required Gateway restart. Preserve credentials, native voice/model services, scripts/database and all evidence. No maintenance change or service termination is authorized by this document.
