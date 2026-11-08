# Generic agent intelligence — proposed tests and release gates

Plan only; no live inference or new benchmark ran. Previous passing tests remain evidence for current VoiceStreaming, not proof of this unimplemented architecture. Use unrelated synthetic agent names/domains, then actual authorized configurations only after review. No fixed Jennifer script/ID in runtime code.

| Area | Required test and expected outcome |
|---|---|
| Unrelated scripts | Service-support and product-onboarding agents use different identities, topics, objectives and verified profiles without code changes; no cross-agent reply/history/fact leakage |
| Normal workflow | Authorized creation/assignment/edit uses existing application flow; no export files; role/tenant/approval checks unchanged |
| Session snapshot | Edit script while conversation A is active: A retains its pinned version; new B receives the new version; old policy is never applied to new text; security revocation cancels separately |
| General knowledge | Relevant question absent from assigned script receives an appropriate general explanation; no invented company price/availability/guarantee |
| Missing/conflicting facts | Unknown offer or stale/conflicting document leads to concise clarification/limitation, not a number or fabricated source |
| Follow-up and objections | Remember answered customer questions; ask the relevant next task step rather than restarting a Q&A list; ambiguous answers remain pending |
| Task state | Unconfirmed model extraction cannot mark a booking/payment/action complete; cancelled generation cannot commit task state; conversation retains validated prior state |
| Tools | Only configured capabilities eligible; wrong actor/tenant/args/consent denied; success speech requires matching receipt; timeout/error does not become success |
| Identity | Each agent uses configured role/name; no false human claim; direct AI/human question answered truthfully; disclosures emitted at required points, not repeated mechanically; interrupted disclosure remains pending |
| Mandatory literals | Exact source text/order/required-before-speech rules survive arbitrary model paraphrases, missing references, duplicate references and malformed output; unauthorized unit emits no audio |
| Open generation | Ordinary optional explanations are not constrained to whole-reply IDs; record boundaries can cross arbitrary token chunks without duplicated/missing spoken words |
| Injection | Customer/documents cannot change rules, facts' trust, identity, source scope, tool permissions or approval; a model's self-labeled safe `speech` unit is not automatically trusted |
| Knowledge isolation | Tenant, agent, version, provenance/freshness filters; documents remain untrusted instructions; retrieval unavailable yields honest limitation |
| Protocol bounds | Partial JSON/escaped text, bad unit types/IDs, oversized units, invalid terminal state, raw control markers and final/rendered text mismatch rejected; no raw JSON read aloud |
| Barge-in/cancellation | Interrupt STT, unit selection, mandatory rendering, native TTS and playback; accepted native work drains, queued/stale output cleared, no partial task/history commit |
| First phrase | First complete eligible unit reaches unchanged phrase stream before later response completion; no speculative claims or filler to reduce timing |
| Baseline fallback | Global flag OFF or unsupported policy uses original baseline before turn starts, identical messages/options/call count; candidate failure cannot silently switch mid-spoken turn |
| Regression | Existing auth/local-only, voice verification, PCM limits, streaming order, native drain, bounded queue, recording, cleanup and adapter-disabled calling tests remain green |
| Audible latency | Only a separately approved physical matched recording can pass median <=3 s, >=20% improvement and <=5 s worst completed response; first PCM/model timings are separate |

Additional explicit limits: no finite adversarial test set proves semantic truthfulness or universal injection immunity. Exact literal protection can be deterministic; general explanations still require task-appropriate evaluation. Do not claim guaranteed company-claim filtering from regexes or trusted model type labels. If a script's safety/semantic constraints are not enforceable to its approved standard with the proposed one-call stream, candidate mode stays disabled for that script.

Before a runtime patch: resolve unit framing/model support, instruction-vs-literal policy representation, authoritative approval persistence, disclosure-delivery evidence, tool receipt semantics and active-session security revocation. Measure added resolver/complete-unit latency; no assumed free overhead. No full-reply catalog, second LLM, vector database or telephony infrastructure is a prerequisite for the first generic prototype.

Existing native 30-reply audio is retained for listening; do not synthesize it again as a substitute for the new architecture tests. New native/model/browser work, feature enablement, deployment or restart requires separate approval. Rollback baseline is the current working VoiceStreaming release.
