# Revised isolated Groq completion allowance

Review date: 2026-11-03, Pakistan time. No production configuration changed.

Groq documents max_completion_tokens (preferred to deprecated max_tokens), GPT-OSS low/medium/high reasoning effort, and separate reasoning response fields. reasoning_format is unsupported for GPT-OSS. Keep low reasoning effort and no reasoning_format. Sources: https://console.groq.com/docs/api-reference ; https://console.groq.com/docs/reasoning

Candidate: **256 total completion tokens** for the isolated Groq adapter, up from 120. Prompts, dynamic script text, fixed history, temperature .65 and top_p .9 are unchanged. No context or Ollama option is changed. The adapter defaults to its original 120-token benchmark allowance unless explicitly passed 256; it validates a finite integer bound of 32–512. No output-budget escalation/retry occurs automatically.

Only the previously incomplete `general` case is selected by `dist/run-groq-text-approved.cjs --revised-general-once`. Its messages are the exact existing prepared messages. The unchanged request hash permits verification against the failed row. No other case is submitted by this mode. It requires the same approved key, process-only --use-system-ca, authenticated Gateway idle/readiness, browser maintenance/relay evidence and GPU checks. The Ollama arm is not called.

Success requires valid HTTP/SSE, done marker, nonempty content and finish_reason stop. A length termination, missing done marker, unsupported tool call, malformed stream, timeout or cancellation fails without retry. A failed answer is never recorded as a completed answer. This does not retrospectively retract already-streamed text: a later voice review must preserve the Gateway's existing error propagation, native drain, stale-generation rejection and refusal to commit failed response history. Do not promise that no prefix could have been heard before a late failure.

Telemetry records exact synthetic response, first content/phrase, response completion, queue/generation metrics, sampled GPU memory and numeric reasoning_tokens if supplied. Reasoning character counts are not converted into invented token counts. Missing reasoning-token telemetry remains unavailable. A successful revised case plus four earlier successes is not a five-case matched rerun at identical output settings, nor a browser/audio benchmark.

Offline validation: `node --test tests/provider-benchmark.test.cjs tests/gateway-llm-streaming.test.cjs` — 26 passed. The selected native case remains gated on fresh authenticated quiet-window evidence. Do not launch a live voice or production provider process from this preparation.
