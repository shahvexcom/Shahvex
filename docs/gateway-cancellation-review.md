# Cancellation patch review

## Findings

Before editing, read-only SHA256 comparison confirmed deployed `C:\Shahvex-AI\integration-gateway` core.cjs, audio-stream.cjs, e2e.cjs, server.cjs and services.cjs matched the repository. No physical files or running services were modified.

Continuous voiced PCM frames do not cause per-frame interrupts: VAD starts only when `speaking` is false; ten silent 20ms frames end a segment. Real pauses can therefore split a recording into multiple segments and cancel older queued/in-flight turns. The old code also unconditionally logged/incremented interrupts at initial speech, every turn submission, disconnect and session deletion, even with no active inference. Repeated interrupt logs alone did not prove engine failure.

Confirmed classification defect: audio-stream recognized only exact `Cancelled` or `AbortError`. Backend rejection after a real session abort could carry another error type and be reported as `turn-error`. Core now classifies by its own abort signal, generation and session identity before normalizing to AbortError. Unaborted timeout/network/model errors remain failures. Errors have stage-only diagnostics without caller text/tokens. The observed physical failure's exact stage was not captured by the old logs, so its full cause is not proven. In particular, a real Whisper 429 while a prior native transcription finishes must not be disguised as cancellation.

## Changes

- core.cjs: active-controller-only, idempotent interrupt; distinct turn generations; clear completed controller; normalized confirmed aborts; stage/error-name logging.
- audio-stream.cjs: stage-bearing genuine turn-error; no stale turn-end after generation changes. Existing audio generation checks and clear protocol retained.
- e2e.cjs: ignore further buffered events only after intentional first-audio disconnect; report pre-cancellation failures with their stage. Expected VAD cancellation events do not become failures. A failure before audio still fails the test.

No VAD thresholds, queue limits, authentication, sessions, engine clients, installed models, agent settings, database or UI changed. Cancellation does not preempt native Whisper/GPU work. Playback clients still must honor generation-tagged clear events. This patch does not combine multiple pause-separated utterances into a single transcription.

## Operator deployment (physical PC only, gateway restart required)

Review the three replacement files in `dist/Shahvex-Gateway-Cancellation-Patch-v1.zip` before applying. It contains only core.cjs, audio-stream.cjs and e2e.cjs, plus their hash manifest. Do not re-extract a full deployment ZIP or replace private engine contracts. Copy this patch ZIP to physical-PC Downloads.

First stop ONLY the Node gateway in its existing terminal with Ctrl+C; leave all engine/model processes running. Wait for active inference/queue work to drain before testing. In a separate physical PowerShell terminal:

```powershell
$target = 'C:\Shahvex-AI\integration-gateway'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = Join-Path $env:TEMP "shahvex-cancel-patch-$stamp"
$backup = Join-Path $target "backup-cancellation-$stamp"
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\Shahvex-Gateway-Cancellation-Patch-v1.zip" -DestinationPath $stage
$entries = Get-Content -LiteralPath "$stage\SHA256SUMS.json" -Raw | ConvertFrom-Json
foreach ($entry in $entries) {
  if ($entry.path -notin @('core.cjs','audio-stream.cjs','e2e.cjs')) { throw 'Unexpected patch path' }
  if ((Get-FileHash -LiteralPath (Join-Path $stage $entry.path)).Hash -ne $entry.sha256) { throw 'Checksum mismatch' }
}
New-Item -ItemType Directory -Path $backup -ErrorAction Stop | Out-Null
foreach ($name in @('core.cjs','audio-stream.cjs','e2e.cjs')) {
  Copy-Item -LiteralPath (Join-Path $target $name) -Destination $backup -ErrorAction Stop
}
foreach ($name in @('core.cjs','audio-stream.cjs','e2e.cjs')) {
  Copy-Item -LiteralPath (Join-Path $stage $name) -Destination (Join-Path $target $name) -ErrorAction Stop
}
```

Restart in the original gateway terminal so its existing token and contract environment remain available:

```powershell
node C:\Shahvex-AI\integration-gateway\server.cjs
```

Also use the repository's updated e2e.cjs when testing from the website checkout. In the existing rehearsal shell (existing URL/token, Jennifer's private export and known-good PCM; substitute actual paths):

```powershell
$env:SHAHVEX_GATEWAY_URL = 'http://127.0.0.1:8787'
node gateway/e2e.cjs .env.agent-e2e.json C:\TestAudio\question.pcm C:\TestAudio\jennifer-patch-normal.pcm
node gateway/e2e.cjs .env.agent-e2e.json C:\TestAudio\question.pcm C:\TestAudio\unused-cancel.pcm --cancel
node gateway/isolation-check.cjs .env.agent-e2e.json
Invoke-RestMethod "$env:SHAHVEX_GATEWAY_URL/health" -Headers @{ Authorization = "Bearer $env:SHAHVEX_GATEWAY_TOKEN" }
```

Run sequentially and stop on error. Normal output filename must be new. Require normal passed/authenticated/cleanup true with audio; cancel passed/cancelled/cleanup true; isolation true; eventual activeSessions=0 and queue active/pending=0. Preserve sanitized stage/error-name logs if `turn-error` persists; never send tokens, transcripts or audio. A timeout/worker-busy genuine error requires separate diagnosis, not treating the failed run as success.

Rollback: stop only gateway again, copy these three files from `$backup` to `$target`, then restart from the original terminal. Keep private contract, tokens and engine files unchanged. Physical cancellation remains unverified until the operator runs this test successfully. VICIdial and real calls remain disabled in this rehearsal.
