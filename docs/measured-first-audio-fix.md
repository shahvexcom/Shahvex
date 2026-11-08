# Measured first-audio fix — no physical services changed

## Actual evidence located

Latest downloaded recording: `C:\Users\UC\Downloads\Jenifer-2026-11-02T16-50-59-694Z.webm`, decoded read-only:102.06s, stereo48kHz. Matching browser events were recovered from `.next/dev/logs/next-development.log`, relay732719d2-3bc6-4808-935a-4577fe9e8c2f. Browser recording-start→stop spans102.0807s, matching decoded duration within21ms. No transcript was invented or required.

Newest protected Gateway JSONL `gateway-2271ac6d2e8f4b578df70df102b54b71.jsonl` reports0 bytes and is locked for reading. It cannot supply stage samples; its emptiness is not proof the running Gateway had no events. The same Gateway timing events reached the browser and are present in Next development logs. No deployment/auth redesign is required to use them.

Recovered evidence files: `dist/latest-browser-timings.json`, `dist/latest-turn-performance.json`, `dist/latest-measured-performance.json`. Reproduce from the development log with `node gateway/inspect-performance.cjs`. The extractor reads only known timing messages; reports contain timing identifiers/metadata, not scripts or transcripts.

## Measured baseline (seconds)

| Completed turn | VAD | STT | LLM first token | LLM complete | TTS→first PCM | Endpoint arrival→playback scheduled |
|---|---:|---:|---:|---:|---:|---:|
|1|0.400|0.890|0.557|1.056|7.203|9.151|
|2|0.400|0.859|0.210|0.822|9.591|11.274|
|3|0.400|0.912|0.347|1.459|10.436|12.809|

TTS is79–85% of the measured endpoint-to-first-PCM path. STT starts within1.2ms of turn reservation in these turns; no multi-second queue delay precedes these successful transcriptions. Do not reduce endpoint400ms blindly: it is small compared to7–10s synthesis.

Recording alignment (seconds from recording start):

|Turn|Estimated last mic speech|Waveform quiet interval|Device-output estimate|Recorded quiet end|
|---|---:|---|---:|---:|
|1|4.491|4.46–14.20|14.121|14.20|
|2|26.089|26.06–37.92|37.841|37.92|
|3|48.893|48.82–62.24|62.177|62.24|

Independent input endpoint and output scheduling timestamps align with those waveform boundaries within roughly30–80ms. Thus9.74/11.86/13.42s gaps correspond closely to these turn response waits, rather than arbitrary customer silences. They remain RMS-threshold waveform boundaries, not a calibrated acoustic measurement or diarized transcript. Scheduled30ms buffer/device estimates alone cannot prove physical speaker onset; use the recording for comparison.

The final gap is different: one utterance endpoint occurs at recording77.399s, then new speech interrupts it~0.7s later; a new endpoint occurs80.498s. After5.193s of failed admission retries the browser receives **engine-busy HTTP429** at85.691s. No AI playback follows. Recording ends102.06s. It is incorrect to label that entire22.02s trailing quiet as completed inference. The cancelled native Whisper request can remain alive after HTTP abort; the old Gateway released its worker before the native lock released.

Read-only Ollama `/api/show` reports shahvex-natural uses Qwen3 4.0B Q4_K_M. Actual streaming first-token times0.21–0.56s and complete times0.82–1.46s are not the largest measured bottleneck. The request currently sets streaming from its existing contract and no explicit keep_alive override; no keep-alive/weights/quantization/options were changed. Entire selected script and bounded history remain. Exact prompt-token counts were not logged, so none are invented. Chatterbox source already loads/prepares/warms its verified voice once; no per-request model reload exists in that code.

## Small changes prepared

Only `gateway/text-chunks.cjs` and `gateway/services.cjs` need physical replacement:

1. TTS starts with the first meaningful complete sentence up to120 characters, or a bounded clause/word boundary for a long first sentence; subsequent chunks retain existing300-character cap. Previously the first WAV could contain several sentences up to300 characters and no audio reached the browser until all those samples were synthesized. All reply text stays in original order; no filler, dropped disclosure, voice-ID change, inference option change or speed/quality reduction. Each completed WAV plays before later segments finish synthesis. This is not native token/audio streaming; the LLM still completes first, deliberately avoiding speculative4GB-model/TTS GPU overlap on8GB VRAM.
2. Accepted native STT requests are drained with the existing60s timeout even after generation cancellation. The cancelled response is discarded before any LLM/history update, but the Gateway worker remains reserved until native completion, preventing its own next turn from racing Whisper's busy lock. New speech clears browser playback immediately; old TTS/LLM cancellation remains unchanged. Genuine timeouts/other callers can still produce failures; errors stay visible/recoverable.

Long/STT-stalled requests may hold a worker longer after cancellation; that reflects native non-preemption instead of hiding it behind overlapping requests. No unlimited workers/retries added. Sentence splitting may increase request overhead and create between-sentence pauses or prosody differences; physical audition is mandatory. A single short sentence may see no improvement. No estimated timing is presented as measured improvement.

## Review/approval and rollback

No physical service was patched/restarted. `dist/Shahvex-First-Audio-Review-v1.zip` contains only two replacements, manifest of current physical originals/new hashes, and this review. Verify the delivered ZIP hash and manifest, back up exactly services.cjs and text-chunks.cjs, and use your existing authenticated maintenance/drain/explicit shutdown controls. No new token or deployment infrastructure is needed. Do not apply old cumulative bundles over these replacements.

After approved Gateway-only stop, in a physical maintenance PowerShell, with `$stage` pointing to the verified extracted package:

```powershell
$target='C:\Shahvex-AI\integration-gateway'
$entries=Get-Content (Join-Path $stage 'SHA256SUMS.json') -Raw | ConvertFrom-Json
if($entries.Count -ne 2){throw 'Expected exactly two replacements'}
foreach($e in $entries){if($e.path -notin @('services.cjs','text-chunks.cjs')){throw 'Unexpected path'};if((Get-FileHash (Join-Path $target $e.path)).Hash -ne $e.originalSHA256){throw 'Deployed original changed'};if((Get-FileHash (Join-Path $stage $e.path)).Hash -ne $e.sha256){throw 'Replacement hash mismatch'};node --check (Join-Path $stage $e.path);if($LASTEXITCODE -ne 0){throw 'Syntax check failed'}}
$backup=Join-Path $target ('backup-first-audio-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup | Out-Null
foreach($e in $entries){Copy-Item (Join-Path $target $e.path) $backup -ErrorAction Stop}
foreach($e in $entries){Copy-Item (Join-Path $stage $e.path) (Join-Path $target $e.path) -Force;if((Get-FileHash (Join-Path $target $e.path)).Hash -ne $e.sha256){throw 'Installed hash mismatch'}}
```

Restart Gateway through your current trusted launcher with the **existing** token/contract; leave Whisper/Ollama/Chatterbox/Next unchanged. If audition/regression fails, approved Gateway-only stop, then `foreach($e in $entries){Copy-Item (Join-Path $backup $e.path) (Join-Path $target $e.path) -Force}`; verify each original hash and restart the same launcher. No credential rotation or model restart needed.

## Physical before/after acceptance

Repeat5 questions and one interruption with Jennifer's same script, voice, headphones, machine/settings; enable consented mixed recording. Export browser timing array and keep Next's development log. Require continuous mic, no stale audio, retained follow-up context, downloadable sound from both sides, and zero sessions/queue after Stop. Compare first-sentence lengths, TTFA and inter-sentence gaps—not only first audible latency. Report TTS time separately from0.4s endpoint, STT and LLM. Collect at least5 successful turns, excluding explicitly cancelled turns rather than inventing durations for them.

**After-patch physical measurements are pending.** Existing automated tests verify chunk order/early first PCM, native-STT draining,10-turn context, interruption, recording and auth. They do not prove1–2s or<3s performance on this PC. The measured TTS compute cost may still require later native streaming/hardware/inference work, subject to approved voice-quality tests. Public endpoints, real calls and model changes remain disabled.
