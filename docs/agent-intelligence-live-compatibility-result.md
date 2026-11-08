# Controlled Ollama compatibility result — 2026-11-03

Stopped safely after **one actual inference**, before a second model invocation. No retries. Raw evidence: `dist/Agent-Intelligence-Compatibility-2026-11-03T10-56-29-272Z/` (results, resource checks and initial loaded-model metadata).

Fresh authenticated maintenance/idle values were supplied by the operator in the signed-in browser. They were not independently fetched by the harness. Additional conservative TCP monitoring observed zero established Gateway connections throughout. TCP counts do not replace authenticated session/relay counts. No Chatterbox/Whisper requests, service restart, maintenance change, production edit or credential access occurred.

The initially loaded-model list was empty. GPU memory observations were 4,587 → 4,861 → 7,376 → 7,808 MiB of 8,188 MiB. The last observation exceeded the isolated runner's 7,600 MiB safety ceiling, so the second pre-request guard refused inference. This demonstrates low remaining headroom, not proof of production contention or a model defect. The harness did not unload the model or change its configuration.

| Observation | Actual result |
|---|---|
| Agent / scenario | Synthetic garden assistant / location question |
| Ollama output | `{"kind":"fact","id":"guide"}` |
| First token from model invocation | 3,901.59 ms |
| LLM-stage start to completed rendered reply | 4,771.70 ms, includes pre-request guard |
| First phrase ready from LLM-stage start | 4,771.64 ms |
| Protocol / required text | Valid final JSONL record without trailing newline; exact disclosure and fact preserved |
| History | One user/assistant pair committed |
| Protocol parsing failures | 0 of 1 actual inference |
| Baseline / second agent / follow-ups | Not executed; resource gate stopped the run |

The original saved first-meaningful-text field is null because the diagnostic observer checked only newline-terminated records, while the production parser correctly accepted the EOF record. The isolated observer has been corrected and regression-tested without another live request. Do not replace that null with a fabricated measurement. Its first meaningful unit was accepted at EOF; the 4,771.70 ms stage completion is the available upper-bound observation, including guard overhead. Exact model-only completion was not separately instrumented in this run.

The saved `calls:2` counts evaluation attempts including one failed preflight, **not two native requests**. Only the row with `modelStarted:true` invoked Ollama.

No baseline comparison, multi-turn live compatibility verdict, median/p95, conversational-quality claim or audible improvement is justified by this sample. Mocked regression coverage remains distinct from native validation. Production VoiceStreaming is unchanged and the intelligence feature was not enabled there.

Recommendation: keep OFF. Do not repeat inference under this resource condition. A further approved quiet window needs an agreed resource budget before continuing matched candidate/baseline conversations. Do not unload production models or alter GPU placement as part of this test. Rollback is stopping the isolated harness (already exited); no production restoration is needed. Existing VoiceStreaming remains the baseline.
