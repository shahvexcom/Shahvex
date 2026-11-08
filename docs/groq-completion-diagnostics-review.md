# Isolated Groq completion diagnostics

Reviewed the failed 2026-11-03 Groq run (UTC directory suffix 13-16-21, corresponding to 18:16 Pakistan time). It retained 10,586.0941 ms wall time, no content, and safe resource observations, but no completion HTTP status, network exception, body-byte count or finish reason. Its underlying failure cannot be reconstructed.

Confirmed defect: the isolated adapter caught every non-HTTP exception and discarded its cause; orchestration then collapsed that error again. Corrections in `gateway/provider-benchmark.cjs` preserve a bounded `providerDiagnostic` object with:

- HTTP status and time to response headers.
- Allowlisted Groq error code, without error-message/body logging.
- Allowlisted network/TLS code, including nested/aggregate causes.
- Phase: before-headers, headers, stream-body, parsing or completion-validation.
- Client deadline expiration versus caller cancellation versus transport timeout.
- Received bytes, content/reasoning character counts, done marker and sanitized finish reason.

Reasoning text is not forwarded to phrase playback or stored in diagnostics. Synthetic final text remains in benchmark results by design; no live customer data is used. No headers or keys are logged. Error bodies are bounded to 16 KiB and parsed only for allowlisted codes. Successful SSE remains bounded to 128 KiB/16,000 content characters.

No ten-second application timeout exists here: it remains 60,000 ms. Read-only activity HTTP calls have 900 ms limits and the observer a one-second limit; their failures have distinct monitoring errors and are not evidence of LLM timeout. A separate transport connection timeout could explain approximately ten seconds, but old evidence is insufficient. No timeout was increased and no TLS verification was weakened.

Groq documents GPT-OSS reasoning under a separate reasoning field; reasoning_format is unsupported for this model. The existing low reasoning effort is supported. No reasoning_format is sent. The 120-token completion bound is unchanged for a matched diagnostic; reasoning can consume that budget. A reasoning-only response ending in length is a failed/incomplete answer, not a successful response with zero latency. The parser now retains that evidence. Source: https://console.groq.com/docs/reasoning

Offline fixtures cover nested connect timeout before headers, HTTP 429 safe-code extraction, reasoning-only events, length exhaustion, malformed SSE, body reset, explicit client deadline, cancellation, usage-only chunks and single-case selection. No live request was made to establish these tests.

The review runner supports `--single-diagnostic`, selecting only the existing synthetic fact case and Groq provider. It loads the private local key, uses process-only --use-system-ca, checks authenticated Gateway idle/readiness and the unchanged GPU gates, submits at most one completion, saves diagnostics and exits. There are no retries or fallback requests. Production providers and services are not imported or changed.

Maintenance and relay state must be freshly supplied from the signed-in browser; direct Gateway health exposes neither. Do not relabel an old browser attestation as a new observation. The operator supplied fresh ready/maintenance/zero-activity confirmation, after which exactly one approved diagnostic ran. Direct authenticated Gateway health and GPU checks continued throughout; browser-only fields remained operator-attested.

## Single physical diagnostic result

Evidence: `dist/Groq-Text-2026-11-03T13-21-45-246Z/results.json` (18:21 Pakistan time). HTTP 200; valid SSE; finish_reason=stop; done marker present; client 60-second deadline did not expire. The unchanged synthetic fact prompt received a relevant factual reply. No retries or additional cases ran.

- Response headers: 3,191.59 ms.
- First content delta: 3,306.59 ms; first lexical content: 3,307.36 ms.
- First complete phrase: 3,371.44 ms; response complete: 3,371.44 ms.
- Server queue_time: 1,745.10 ms; prompt_time: 10.04 ms; completion_time: 51.53 ms.
- Server usage: 142 prompt tokens, 33 completion tokens. Completion throughput approximately 640 tokens/sec includes provider-counted completion tokens, potentially reasoning, not spoken words.
- Seven GPU samples: 4,806–4,840 MiB; all independently checked Gateway observations authenticated/ready with sessions/queue zero.
- Reasoning was counted only (63 characters) and never forwarded to phrase output or logged as content.

This establishes model access and compatibility for one request. Queueing is a measured contributor to this sample, while the remaining client/header wait cannot be uniquely attributed to network, TLS, Norton inspection or other server overhead. The earlier 10.586-second failure remains unclassified because its original evidence discarded the relevant fields. The successful run used the same completion parameters; do not claim a provider fault was fixed or a timeout increased. These are text-only timings, not actual audible latency.

20 offline regression tests passed. No further inference is authorized by this single-diagnostic result; the full benchmark remains unexecuted. Production services, credentials, maintenance and VoiceStreaming are unchanged.

Rollback: stop only the isolated diagnostic process if needed; leave its files/results for review. No production restore, credential rotation, maintenance change or service restart is necessary.
