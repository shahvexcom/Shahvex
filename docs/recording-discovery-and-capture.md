# Recording found; safe timing capture and physical review

## Read-only findings, 2026-11-02

Found `C:\Users\UC\Downloads\Jenifer-2026-11-02T14-15-44-972Z.webm`, 978071 bytes. Decoded read-only using the existing engine virtual environment's PyAV (no model loads/downloads): duration60.54s, source2 channels at48000Hz. This closely matches the described recording. No files in physical integration or Downloads were changed.

RMS analysis at16kHz mono,20ms windows, threshold500, minimum quiet interval500ms:

| Quiet interval | Duration |
|---|---:|
| 0.00–6.52s | 6.52s |
| 9.20–14.68s | 5.48s |
| 18.54–20.26s | 1.72s |
| 22.72–33.94s | 11.22s |
| 38.04–38.74s | 0.70s |
| 40.40–41.02s | 0.62s |
| 43.68–44.22s | 0.54s |
| 45.64–46.86s | 1.22s |
| 51.92–60.54s | 8.62s |

Threshold-dependent waveform quiet is not proof of speech endpoint, human identity or processing time. Leading/trailing quiet may be recording start/stop padding. Stereo does not establish separately recorded speakers. No transcript or user/Jennifer attribution was inferred. The shorter physical integration files are E2E input/AI responses rather than the60s conversation. No saved conversation timing JSONL/log was found in project/integration/Downloads; an unrelated earlier Chatterbox import-debug log exists elsewhere. Existing Gateway stdout/browser console may still have unsaved output; it cannot be reconstructed after loss.

Deployed Gateway core/audio-stream/services/server hashes differ from repository and lack the newest correlation instrumentation; deployed AudioStream still defaults to200ms silence. The reviewed patches are not automatically live. Prior supplied native TTS measurement3.643s for73 chars remains the only attributable physical stage duration. STT/LLM/output timings and acoustic before/after response latency are unknown.

## Locate existing downloads yourself (physical PC PowerShell)

```powershell
Get-ChildItem -LiteralPath "$env:USERPROFILE\Downloads" -File |
  Where-Object {$_.Extension -in '.webm','.wav','.m4a','.mp3'} |
  Sort-Object LastWriteTime -Descending |
  Select-Object FullName,Length,LastWriteTime
```

Chrome/Edge `Ctrl+J` → find the Jennifer/Jenifer recording → Show in folder. If browser Downloads location is customized, check `chrome://settings/downloads` or `edge://settings/downloads`. If never downloaded, the old blob is only in that still-open modal; download before closing. Closing/reloading destroys browser-memory recordings by design. A blob URL is not a recoverable filesystem path.

Read-only local analysis command (no transcription/model inference):

```powershell
Set-Location P:\shahvex
& 'C:\Shahvex-AI\.venv\Scripts\python.exe' -B gateway/analyze_recording.py "$env:USERPROFILE\Downloads\Jenifer-2026-11-02T14-15-44-972Z.webm"
```

## Diagnostic changes in this review

Existing endpoint/correlation changes and ten-turn regression remain. New optional `SHAHVEX_TIMING_LOG` captures metadata to a **new** JSONL file alongside normal console logging. Fixed-field allowlist excludes audio, scripts, transcripts, headers and credentials; only known scalar diagnostic fields are persisted. The exclusive-create flag refuses overwriting an existing file. File access follows the user's existing private directory policy on Windows. File logging is disabled unless explicitly configured. No log path or secret is sent to the browser.

No inference/model/voice/UI change in this update. Physical microphone operation and latency still require operator verification. No global audio mute during playback is introduced because it would disable barge-in; use headphones with existing browser AEC and test for self-echo. Energy VAD400ms is configurable300–1000ms and cannot determine incomplete sentence semantics.

## New cumulative reviewed package (manual deployment only)

Use `dist/Shahvex-Timing-Capture-Review-v1.zip`, not multiple older packages. It contains gateway/core.cjs, audio-stream.cjs, services.cjs, text-chunks.cjs, server.cjs, telemetry.cjs, separate optional Chatterbox handler patch, manifest and this review. Original/replacement SHA256 hashes are in the manifest; ZIP hash accompanies delivery. Physical originals must match before copy. No private configs/models included.

Physical PC staging terminal, no services stopped yet:

```powershell
$ErrorActionPreference='Stop'
$zip=Join-Path $env:USERPROFILE 'Downloads\Shahvex-Timing-Capture-Review-v1.zip'
if((Get-FileHash -LiteralPath $zip).Hash -ne 'EXPECTED_DELIVERED_ZIP_SHA256'){throw 'ZIP checksum mismatch'}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$stage=Join-Path $env:TEMP "shahvex-capture-$stamp"
Expand-Archive -LiteralPath $zip -DestinationPath $stage
$manifest=Get-Content "$stage\SHA256SUMS.json" -Raw | ConvertFrom-Json
$allowed=@('gateway/core.cjs','gateway/audio-stream.cjs','gateway/services.cjs','gateway/text-chunks.cjs','gateway/server.cjs','gateway/telemetry.cjs','optional-chatterbox/chatterbox_voice_server.py')
if($manifest.Count -ne 7){throw 'Unexpected manifest'}
foreach($entry in $manifest){if($entry.path -notin $allowed){throw 'Unexpected path'};if((Get-FileHash (Join-Path $stage $entry.path)).Hash -ne $entry.sha256){throw 'Replacement hash mismatch'}}
```

Review staged files. Only when ready, Ctrl+C **Gateway only** in its original credential-bearing terminal. Keep Whisper/Ollama/Chatterbox/Next running. Staging terminal:

```powershell
$target='C:\Shahvex-AI\integration-gateway'
$backup=Join-Path $target "backup-capture-$stamp"
$entries=@($manifest | Where-Object {$_.path -like 'gateway/*'})
foreach($entry in $entries){
  $name=Split-Path $entry.path -Leaf;$dest=Join-Path $target $name
  if($entry.originalSHA256){if((Get-FileHash $dest).Hash -ne $entry.originalSHA256){throw "Original changed: $name"}}
  elseif(Test-Path $dest){throw "Unexpected existing helper: $name"}
  node --check (Join-Path $stage $entry.path);if($LASTEXITCODE -ne 0){throw 'Syntax check failed'}
}
New-Item -ItemType Directory -Path $backup | Out-Null
foreach($entry in $entries){if($entry.originalSHA256){Copy-Item (Join-Path $target (Split-Path $entry.path -Leaf)) $backup}}
foreach($entry in $entries){$dest=Join-Path $target (Split-Path $entry.path -Leaf);Copy-Item (Join-Path $stage $entry.path) $dest -Force;if((Get-FileHash $dest).Hash -ne $entry.sha256){throw 'Installed hash mismatch'}}
```

In the **original Gateway terminal**, preserve existing token and contract variables. For a new timed run:

```powershell
$captureDir=Join-Path $env:USERPROFILE 'Documents\Shahvex-Diagnostics'
New-Item -ItemType Directory -Force -Path $captureDir | Out-Null
$env:SHAHVEX_TIMING_LOG=Join-Path $captureDir ('gateway-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.jsonl')
$env:SHAHVEX_ENDPOINT_SILENCE_MS='400'
node C:\Shahvex-AI\integration-gateway\server.cjs
```

Do not set or print a new token, and do not change the private contract. Existing log path must be new on each restart. Optional Chatterbox handler patch remains separate: follow its review/backup/restart steps in `docs/multiturn-physical-review.md` only if explicitly applying it. No Whisper changes needed.

Rollback: stop only Gateway, copy original files from `$backup` back to `$target` using `$entries` where originalSHA256 exists, remove `Env:SHAHVEX_TIMING_LOG` and `Env:SHAHVEX_ENDPOINT_SILENCE_MS`, restart Gateway with original environment. New unused helper files can remain inert. No private contract or model restore needed.

## New recording + matching browser timeline

Restart only Next.js if its updated code needs it, preserving local flag/URL/token and original DB/auth settings. Open the local controller, use headphones and Jennifer's actual assigned/explicit test script. Start a new conversation; consent and Start Recording. Ask10 sequential synthetic questions, with a natural short pause, a mid-reply interruption and context follow-ups. Do not change hardware/models/settings between before/after tests. Stop Recording and download; keep its full path. Stop conversation. Require eventual Gateway activeSessions0/queue active0/pending0.

Before starting another conversation/reloading, Chrome/Edge DevTools Console:

```javascript
copy(JSON.stringify(window.__SHAHVEX_VOICE_TIMINGS__ || [], null, 2))
```

Save clipboard to a new `browser-timings.json` in the diagnostics directory using a local editor. This array contains bounded scalar timing data, not customer text/audio/tokens. Physical Gateway log path is the value already assigned above; browser metadata's recording-start marker anchors recording time to browser monotonic time. Then:

```powershell
Set-Location P:\shahvex
node gateway/timing-report.cjs "$env:USERPROFILE\Documents\Shahvex-Diagnostics\browser-timings.json"
```

Record/report null fields as unmeasured. Last speech sample offsets/VAD delay align the Gateway timeline, but input upload delay, audio-device output latency and actual acoustic onset must be assessed with the recording and confirmed speaker identities. No automatic diarization/transcript attribution is performed. Export before another conversation resets the buffer. Preserve logs locally; do not share tokens/private contract.

Only after those physical observations can STT vs LLM vs TTS vs playback be ranked and actual before/after values reported. A successful ten-turn unit test does not meet this acceptance criterion. Public endpoints, Vercel/Railway activation and real VICIdial calls remain out of scope.
