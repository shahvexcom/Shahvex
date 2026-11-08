# Ollama cold/warm benchmark — review only

No inference authorized or executed during preparation. Production Agent Intelligence stays OFF. No service, model, maintenance, environment or keep-alive change is required.

## Current decision: NO-GO on the previously measured memory budget

Use a hard total-GPU-used ceiling of **7,164 MiB**, retaining **1,024 MiB** of the reported 8,188 MiB. This is a conservative test reserve, not a proven bound on Chatterbox synthesis peaks. Chatterbox stays resident but must not synthesize during this benchmark.

The previous run rose from 4,587 to 7,808 MiB: a 3,221 MiB observed increment. Admission requires current baseline + 3,221 + 256 MiB uncertainty reserve <= 7,164 MiB, i.e. baseline <= **3,687 MiB**, sustained for 30 seconds. The audited 4,501 MiB baseline fails. Do not run simply to rediscover this failure. No reduction in desktop usage or other allocation is authorized by this plan. A new read-only snapshot can reassess admission; historical increments are estimates, not guarantees.

Sample global used/free memory at least every 250 ms in a persistent nvidia-smi monitor, not by repeatedly spawning PowerShell. Record actual sample intervals and gaps. Any sample >=7,164 MiB, monitoring failure, unexpected AI activity, CUDA/OOM error or service error cancels the isolated request and ends the benchmark without retries. Cancellation may not immediately release native allocations; observe until settled and issue no additional requests. Do not terminate a service or unload a model for cleanup. Sampling cannot guarantee detection of every sub-sample peak.

## Read-only inspection findings

The deployed `C:\Shahvex-AI\integration-gateway\services.cjs` submits `{model:'shahvex-natural',messages,stream:true}` for the streaming contract. It does not override options or keep_alive. It validates NDJSON, bounds bytes/content, requires done=true and emits first content-delta timing, but discards the terminal duration/count fields. Use a standalone metadata-preserving observer for the benchmark; do not patch this production client.

Ollama's final chat record can expose total_duration, load_duration, prompt_eval_duration/count and eval_duration/count. Durations are nanoseconds; divide by 1e6 for milliseconds. Preserve missing fields as null, not zero. Record prompt_eval_cached_count if returned; absence is not evidence of zero cache hits. Source: https://docs.ollama.com/api/chat

Previously observed model: Qwen3 4B Q4_K_M, num_ctx=4096, num_predict=120. Historical server settings: keep-alive five minutes, one parallel request. Do not assume historical values are current. Before an approved run, use /api/show and /api/ps metadata only to verify identity/options and residency; do not preload it. Default expiry behavior: https://docs.ollama.com/faq

## Exact proposed experiment after separate approval

1. Obtain fresh signed-in authenticated Gateway health, maintenance=true and all session/queue/relay counts zero, plus explicit confirmation that no direct AI tests are running. Do not change maintenance automatically. This endpoint includes downstream health pings, not inference. Establish an authenticated activity observer for the duration; a TCP connection count alone is not proof of idle sessions. If trustworthy ongoing activity observation is unavailable, do not start.
2. Pass the 30-second resource admission gate above. Establish the persistent memory monitor before submitting anything. Record RAM/CPU baseline and GPU utilization. Stop on competing AI activity rather than infer contention from this benchmark's own GPU utilization.
3. Snapshot /api/version, /api/show for shahvex-natural and /api/ps. Preserve model digest, parameters and the exact synthetic request bytes/hash. No credentials, actual campaign script or customer information are needed.
4. Wait for /api/ps to report the target absent naturally. Poll every five seconds for at most ten minutes. If it remains loaded, stop/defer; do not unload it. This defines a **model-residency cold** trial, not a cold disk/OS-cache trial.
5. Send exactly one streamed POST to http://127.0.0.1:11434/api/chat using the payload below. No options, format, think, seed or keep_alive fields. Bound request to 60 seconds, response to 128,000 bytes / 16,000 content characters. Preserve every final telemetry field. Require successful HTTP, valid NDJSON and a terminal done=true; failures are not valid latency samples.
6. Snapshot /api/ps after cold completion. If the same target is resident and all gates remain satisfied, send the **byte-identical** request within two seconds of that verification. This is the warm trial. Do not append history or alter the prompt. If the model expired or a gate fails, stop; do not relabel/retry the trial.
7. Snapshot /api/ps after warm completion. End the first approved stage after this single pair. A further two pairs (six total planned requests) require the approval to cover all three pairs and require natural expiry between pairs. Never generate a keep-warm request. Do not wait for natural expiry by issuing chat calls.
8. Save request hash, synthetic responses, terminal telemetry, monotonic client timing and VRAM samples separately per trial. Leave the model to its unchanged normal residency policy. Leave maintenance unchanged. No production rollback action is required; stop only the isolated observer/harness.

Payload (identical for every trial):

```json
{"model":"shahvex-natural","messages":[{"role":"system","content":"You are a synthetic support assistant. Explain general concepts clearly in two concise sentences. Do not claim company policies, prices or completed actions."},{"role":"user","content":"How can someone narrow a library catalog search when the first search returns too many results?"}],"stream":true}
```

## Measurements and interpretation

Use monotonic request-start timestamps for headers, first content delta, first content containing a letter/digit, first complete phrase using the unchanged production PhraseStream, terminal done record and body EOF. Call the letter/digit metric first lexical content, not semantic quality; inspect its text afterward to judge meaningfulness. Do not count hidden thinking, JSON framing or whitespace as meaningful content. Record any thinking separately without changing its setting. First phrase readiness is distinct from first token and from audible output.

For each trial report: cold/warm label; pre/post residency and expiration; first lexical and phrase-ready milliseconds; completion milliseconds; load/prompt/eval/total server milliseconds; token counts; actual sampled peak VRAM and minimum free VRAM; monitoring gaps; errors. Compute generation rate as eval_count / (eval_duration/1e9) when valid. Client wall time and server total differ; do not assume their residual is exclusively network time or that stage durations add exactly to wall time.

Compare paired cold minus warm first-content and completion times, alongside load_duration differences. A large cold load_duration with small warm load_duration supports a loading contribution. Lower warm prompt_eval_duration may reflect prompt/KV cache reuse, so the full paired improvement cannot be attributed exclusively to model loading. Fixed temperature remains stochastic: response token counts can differ despite identical input, so compare eval rate and counts before interpreting total-time differences. Never change generation settings to force determinism.

One pair is a diagnostic sample, not a stable median or p95. With three approved pairs report paired values/range and descriptive medians; do not claim population p95. This is synthetic Ollama-only evidence, not Jennifer's real prompt distribution, full pipeline latency or browser audible latency. It cannot prove a two-second audible response or diagnose every existing pause.

## Approval boundary

This document authorizes nothing operational. Next action is approval of the resource ceiling and a separate quiet-window benchmark **only after admission becomes feasible**. Any proposal to change residency, GPU placement, model settings or service configuration requires a separate review. Current VoiceStreaming and all existing backups remain untouched.
