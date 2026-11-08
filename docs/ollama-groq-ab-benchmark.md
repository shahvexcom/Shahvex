# Isolated Ollama / Groq review benchmark

Preparation only. No provider or native audio requests were executed. Nothing imports this module into production; Agent Intelligence stays OFF. No dependencies were installed.

## Providers and comparison limits

`gateway/provider-benchmark.cjs` exports `adapter`, `cases`, seeded `plan`, `gate` and `run`. It starts no server, reads no production credentials and changes no environment or service. Native STT/TTS and browser testing are intentionally absent.

A: existing `shahvex-natural`, Qwen3 4B Q4_K_M, using the unchanged production request shape `{model,messages,stream:true}`. The model's context/generation settings and default keep-alive remain authoritative.

B: `llama-3.1-8b-instant`, listed in Groq's supported-model documentation during review. Uses the official HTTPS streaming Chat Completions endpoint, with SSE, temperature 0.65, top_p 0.9 and max_completion_tokens 120. Groq is a different model/tokenizer and hardware/provider; local top_k/repeat_penalty are not silently mapped to unsupported options. This measures a provider-plus-model alternative, not identical-model hardware speed. No claim about provider quantization equivalence is made. Model/account availability must be checked through approved metadata access before inference; no silent replacement if unavailable.

Sources: https://console.groq.com/docs/model/llama-3.1-8b-instant ; https://console.groq.com/docs/text-chat ; https://console.groq.com/docs/api-reference

Five synthetic cases cover verified facts, relevant general knowledge, a follow-up with identical fixed history, hesitation/objection and missing business information with exact required wording. No Jennifer script or customer data is exported. Cases are immutable matched inputs, not provider-specific rewritten histories. The seed-20261103 plan contains ten sequential calls in reproducible randomized order. Quality is reviewed separately from latency. Optional permission in these synthetic cases does not authorize any actual campaign.

## Key setup — private local benchmark PowerShell only

Do not paste a key into chat, command arguments, source, `.env.example` or browser tools. This optional setup is not authorization to execute inference:

```powershell
$groqSecret = Read-Host 'Groq benchmark API key' -AsSecureString
$groqPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($groqSecret)
try {
    $env:GROQ_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($groqPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($groqPointer)
    $groqSecret.Dispose()
}
# After the separately approved benchmark, clear this terminal's value:
# Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
```

The environment value is plaintext within the benchmark process and inherited children; do not use a shared terminal or enable verbose HTTP tracing. `adapter('groq',{key:process.env.GROQ_API_KEY})` sends it only as an Authorization header to the fixed Groq TLS endpoint. Redirects are refused. Error bodies and underlying exception messages are not logged. There is no production/frontend key configuration. Prefer this transient method over creating another persistent credential file. Current `.gitignore` already excludes `.env*` and `dist/`.

## Approval gates

1. **Phase 1 — preparation:** source/official-document review and mocked fixtures only, now complete. No authenticated Groq model-list request was sent. Native model/account availability is still unverified.
2. **Phase 2 — text only:** needs separate explicit approval and fresh authenticated ready/maintenance/zero-activity evidence. Supply a trusted observer to `run({approved:true, providers:{ollama:adapter('ollama'),groq:adapter('groq',{key:process.env.GROQ_API_KEY})}, snapshot})`. `snapshot` must provide authenticated/ready/maintenance, zero sessions/queue/relays, confirmed no competing direct tests, observation age, GPU used memory and Ollama residency. Record GPU utilization, timestamp and source with each snapshot. Gate fields alone do not authenticate a fabricated object; the observer must obtain real authorized evidence. An existing signed-in operator health result can establish the initial gate, but unattended continuous activity observation is not implemented here. Do not call `run` with a constant all-clear object. No live CLI is exposed until this observer is reviewed and available.
3. **Phase 3 — audio/contention:** separate approval for sequential native synthesis with unchanged Jennifer voice/settings and existing WAV integrity checks. Do not infer improved Chatterbox performance from Phase 2. Deliberate simultaneous Ollama/Chatterbox GPU work is not authorized by the text phase; any representative overlap requires its own reviewed resource budget. Stop on the first corrupt WAV; no retry. Compare matched first-phrase text/lengths to distinguish lighter wording from lower contention.
4. **Phase 4 — browser:** requires separate controlled deployment approval, backups and rollback review. Five matched turns per arm, same approved script/history/reset conditions, real microphone, two-sided recording, speech-end to actual audible onset, gaps, barge-in/cancellation, required wording and listening scores. No production provider route or deployment patch is included here.

For every phase, leave maintenance as found; if it is not already suitable, stop and ask the operator. No automatic maintenance change.

## Resource and activity gates

- Existing ceiling: **7,164 MiB used** out of 8,188 MiB. Abort at or above the ceiling; reserve is conservative, not a guarantee of every native synthesis peak.
- Local cold-load admission remains **<=3,687 MiB**, covering the observed 3,221 MiB increase plus 256 MiB uncertainty. The latest 4,724 MiB baseline is blocked. No local request may bypass this gate merely to obtain a comparison.
- Cloud admission requires observed GPU-used +256 MiB <=7,164 MiB and no resident Ollama model. This avoids confusing retained local-model allocations with cloud GPU usage. Wait only for natural expiry; do not unload or alter keep-alive. A randomized arm that cannot meet its gate is marked blocked and ends the run rather than secretly reordered or retried. A cloud-only subset requires explicit approval and must not be reported as a complete A/B.
- `run` checks before every request and monitors during it (250ms nominal, observer timeout one second, status age <=3 seconds). Monitoring failure, activity, API/parse failure or memory pressure aborts the isolated request and stops the run. Record real sampling cadence; sampling is not a hard reservation and cannot detect all short spikes. Client cancellation does not prove immediate native inference termination: do not submit another request afterward.
- Ollama observations should distinguish cold/warm residency. Once an Ollama request naturally retains its model, the next Groq arm may be blocked. Do not force expiry to preserve the randomized schedule.

## Metrics and result schema

Each row saves case ID, provider, request hash, status (`complete`, `blocked`, `failed`), sanitized reason, first content-delta time, first lexical-content time, first production-PhraseStream readiness, total wall time, sampled peak GPU usage, timestamped snapshots, synthetic reply and terminal telemetry. Local terminal fields retain load/prompt/eval durations and token counts when present; absent fields remain absent. First lexical content is not automatically semantically meaningful: review the actual first phrase for relevance before including it in that metric. Existing PhraseStream is reused without changing its 40-character clause threshold or sentence rules.

Suggested output: `dist/Ollama-Groq-AB-v1/results.json`, `resource-samples.jsonl`, `review.csv`. Save only synthetic text; never headers or keys. Use matched case hashes, report blocked/failed denominators alongside successful-case median/worst first-phrase and completion times. With five cases, p95 is descriptive, not a reliable population estimate. Never treat missing/failed results as fast zeroes.

Review required-word accuracy, factual accuracy, unsupported commitments, missing-info handling, follow-up relevance and concise naturalness. The exact-word boolean is a simple check, not semantic compliance proof. Reject an arm with content regressions even if faster. Cloud network delay/rate limits and model differences are confounders; token rates are not directly comparable across tokenizers. No actual audible latency, PCM time, phrase gaps or voice naturalness can be reported from this text harness.

## Offline validation and rollback

`node --test tests/provider-benchmark.test.cjs`

Fixtures cover split UTF8/CRLF SSE, NDJSON terminal telemetry, matched inputs/order, fixed endpoints/key confinement, HTTP errors, missing completion, malformed/oversize output, cancellation, memory/activity gates, no retries and sequential calls. These tests make no live requests.

Rollback now: stop only the isolated benchmark if running, clear its process-scoped Groq key, preserve results and let Ollama follow its existing expiry policy. Production needs no restoration because it is untouched. Any future deployed provider change must use an independently approved backup/restore procedure; existing VoiceStreaming remains baseline.

Recommended next step: review this preparation and authorize a Phase 2 scope only after the trusted activity observer is available. Local A remains NO-GO at the measured memory baseline. Do not execute a live benchmark merely because a key is configured.
