# Isolated compatibility evaluation

Status: offline regression complete; live Ollama evaluation blocked pending fresh authenticated production activity confirmation. No production flag, service or data changed. No Chatterbox request made.

## Executed checks

`node --test tests/intelligence-compatibility.test.cjs tests/gateway-agent-intelligence.test.cjs`

28 passed, zero failures. These are simulated/model-mocked tests, not assessments of actual model adherence, naturalness or speed. A matched harness run covers two unrelated synthetic agents (garden guidance and library search), five turns each, baseline and candidate: 20 sequential mocked model requests. Separate histories advance through 2/4/6/8/10 messages. Coverage includes out-of-script relevant concepts, follow-ups, clarification, objections and missing business information. Existing regression cases cover mandatory literals, verified fact references, task state, script snapshot updates, ownership, cancellation at STT/LLM/TTS/playback, and explicit recovery on a later turn.

Resource snapshot during preparation: RTX 4060 8,188 MiB total / 4,729 MiB used, 6% GPU utilization; 18,624 MiB available RAM and 7.37% CPU utilization. This is a point-in-time observation, not proof of production inactivity or reserved capacity.

## Live gate and bounded evaluation

`gateway/intelligence-compatibility.cjs` exports `evaluate({llm,beforeRequest,live,limit})`, `assertIdle(status)` and synthetic `scenarios()`. It starts no listener, loads no credentials and never invokes native STT/TTS. Its injected LLM can use the existing `createServices({ollamaStreaming:true}).llm`; no service health method should be called by this harness because it would also ping Chatterbox. Do not enable the production feature flag to run this evaluation.

Before a live run, obtain a fresh signed-in administrator activity result: authenticated=true, ready=true, activeSessions=0, queue.active/pending=0, activeRelays/startingRelays=0, and confirmation of no competing direct AI tests. Maintenance is observed only; the harness must not change it. The existing browser gatewayHealth endpoint itself pings downstream health endpoints; this evaluation does not call it. If that health ping is outside the authorized scope, request an operator-provided result rather than making it implicitly.

`beforeRequest` is mandatory and must obtain a trustworthy current activity/resource check before each native request. `assertIdle` validates the supplied fields but does **not** authenticate their origin or freshness. Do not feed a fabricated or stale object to it. A single operator attestation is insufficient for unattended monitoring. Until an authenticated observer is available, keep native execution blocked. If a production conversation starts during inference, the observer must interrupt/abort the isolated request and stop the run. The current harness has no autonomous access to the signed-in browser and does not claim this observer exists.

Maximum model calls: 20, sequential, no regeneration/retry. The production service client already bounds each HTTP request to 60 seconds. Abort at the first protocol/safety/model failure and retain raw synthetic output and the error. No automatic baseline fallback during a candidate turn. Run a smaller smoke subset first if warranted; do not repeatedly submit a failing protocol.

## Metrics and review

Rows contain synthetic customer text, raw model output, rendered reply, errors, committed history length, first-token time, first-meaningful-text time, first phrase ready and response completion. Save only synthetic data in a local review directory. No audio is generated: the 640-byte PCM buffers are placeholders for lifecycle tests.

First-token timing begins at actual model invocation, excluding the preflight guard. Candidate meaningful text means the first accepted complete JSONL speech/general/fact/question unit; baseline uses the first sentence boundary after at least 20 characters. These are different protocol readiness measures, not identical quality metrics. Compare the saved text for relevance/completeness. First phrase-ready and completion are measured from Gateway LLM-stage start and include the safety-check delay; report that distinction rather than subtracting unknown overhead. Server-inserted mandatory text may precede model text and is not evidence of faster contextual reasoning. Never interpret any of these as audible latency.

Required live report: successes and failures by variant/agent, first-token/meaningful-text/completion median and worst values (successful turns only, with failure count alongside), missing/invented facts, required wording, repetition, follow-up continuity and qualitative relevance. A model that emits plain text or fences instead of JSONL fails compatibility even if its answer reads well.

## Limits and rollout

No actual Ollama protocol adherence or conversation quality result exists yet. Deterministic literals preserve configured exact text, but optional free speech still has lexical rather than semantic fact verification; spelling out a false claim may evade the guard. This is a blocker to broad autonomous business-claim use. Prefix audio cannot be recalled if a later unit fails, and interrupted responses may not reach a required suffix. Complex conditional script obligations remain unsupported and locked.

Recommend OFF until the native model passes the synthetic compatibility review, mandatory/fact restrictions receive adversarial review, and an approved isolated physical browser test passes. Do not deploy from this document. Keep the existing VoiceStreaming production release as baseline. Rollback for this evaluation is simply to stop its isolated process and retain its results; production files, feature flag, credentials and services are untouched. Any later deployment needs its own approved backup/restore procedure.
