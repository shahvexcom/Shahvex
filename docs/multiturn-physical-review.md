# Multi-turn reliability review — physical verification required

## Evidence

The operator measured **Chatterbox synthesis 3.643s for 73 characters**. This is the only supplied real per-stage duration. Whisper duration, Ollama token timing, network delay, acoustic playback onset and GPU contention remain unmeasured. A 1–2s response cannot be promised while this measured TTS request alone takes 3.643s. No model/options/speaking-rate change is made.

Read-only physical source inspection confirmed:

- Deployed core.cjs/audio-stream.cjs/services.cjs differ from current instrumented repository; Whisper wrapper matches. Editing the repository does not update that running service.
- Chatterbox catches broken pipe/reset only around body write, not ConnectionAbortedError/WinError10053 or header flush. Its outer exception handler sends 500 after a failed 200 response. The optional patch guards the entire write, includes aborted connections and prevents a second status line. It does not alter inference, GPU warmup, voice reference, synthesis arguments or model weights.
- Chatterbox accepts text length 1–350. Unbounded full model replies could be rejected. Gateway now splits replies at <=300 characters in original word order and synthesizes sequentially, playing each completed WAV segment without waiting for subsequent segments. This is bounded whole-segment buffering, **not native streaming synthesis or LLM/TTS overlap**.
- Browser previously called stop() on every turn-error. A failed STT utterance consequently destroyed microphone/SSE/session; subsequent speech could not recover. Browser now displays that error and keeps the conversation alive for a fresh utterance. This does not suppress or retry an uncertain accepted STT request.
- Native Whisper cannot be preempted by HTTP abort; its admission lock may return429 on the next utterance. Explicit429 admission rejection now retries up to26 attempts with200ms cancellable waits (max5s wait, plus request time); no timeout/uncertain submission retries. The physical STT HTTP status is still needed to establish whether busy admission actually caused the reported failure.
- WinError10053 is consistent with the Gateway aborting an obsolete TTS generation, not proof of a failed model. It does not by itself explain a later STT error. Client abort may finish model computation server-side.
- VAD/frame upload stays active during playback, with ordered100ms uploads of 20ms/640-byte16kHz mono PCM16 frames. Per-generation cancellation does not close Gateway session; stream end/transport disconnect does. Echo cancellation/noise suppression requested from browser are not guaranteed acoustic isolation. Use headphones; a speaker-echo signal still can trigger genuine-looking VAD and cancel TTS. Do not disable barge-in globally to hide this.
- Stop was already made idempotent after admin/local checks; no additional stop bypass was added. History commits completed noncancelled turns only and is bounded to20 messages. No automatic introduction is injected on every turn; the assigned script remains intact.

## Timing collection

Use current repository stage telemetry described in `docs/live-voice-performance-review.md`: speech-end, queue, STT start/complete, LLM first token/complete, TTS start/first PCM and browser first scheduled playback, correlated by turnId/generation. `first-playback-scheduled` is not an acoustic measurement. Keep the browser console and Gateway terminal output for five consented synthetic turns, no secrets/audio/transcripts. Record p50/p95 only after enough samples; keep cold and warm runs separate. Targets remain unverified.

## Package and review

`dist/Shahvex-Multiturn-Review-v1.zip` contains gateway/{core.cjs,audio-stream.cjs,services.cjs,text-chunks.cjs}, optional-chatterbox/chatterbox_voice_server.py, SHA256SUMS.json and this review. The manifest records exact reviewed deployed original hashes and replacement hashes. ZIP hash is supplied alongside delivery. No private contracts/tokens/models are included. The optional full Python replacement is based on the inspected physical source, with only its HTTP send/finish methods changed.

### Physical PowerShell: stage and verify without deployment

Copy ZIP to Downloads. Replace EXPECTED_ZIP_SHA256 with the delivered value:

```powershell
$ErrorActionPreference='Stop'
$zip=Join-Path $env:USERPROFILE 'Downloads\Shahvex-Multiturn-Review-v1.zip'
if((Get-FileHash -LiteralPath $zip).Hash -ne 'EXPECTED_ZIP_SHA256'){throw 'ZIP hash mismatch'}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$stage=Join-Path $env:TEMP "shahvex-multiturn-$stamp"
Expand-Archive -LiteralPath $zip -DestinationPath $stage
$manifest=Get-Content -LiteralPath "$stage\SHA256SUMS.json" -Raw | ConvertFrom-Json
$allowed=@('gateway/core.cjs','gateway/audio-stream.cjs','gateway/services.cjs','gateway/text-chunks.cjs','optional-chatterbox/chatterbox_voice_server.py')
if($manifest.Count -ne 5){throw 'Unexpected manifest'}
foreach($entry in $manifest){
  if($entry.path -notin $allowed){throw 'Unexpected path'}
  if((Get-FileHash -LiteralPath (Join-Path $stage $entry.path)).Hash -ne $entry.sha256){throw 'File checksum mismatch'}
}
```

Inspect the staged source/diffs. Apply Gateway and optional TTS as separate operations below; never extract ZIP over engine root.

### Apply Gateway only

Stop only Node Gateway with Ctrl+C in its original terminal. Keep original terminal/token/contract environment. Leave Whisper/Ollama/Chatterbox/Next running. In staging PowerShell:

```powershell
$target='C:\Shahvex-AI\integration-gateway'
$backup=Join-Path $target "backup-multiturn-$stamp"
$entries=@($manifest | Where-Object {$_.path -like 'gateway/*'})
foreach($entry in $entries){
  $name=Split-Path $entry.path -Leaf
  $dest=Join-Path $target $name
  if($entry.originalSHA256){if((Get-FileHash $dest).Hash -ne $entry.originalSHA256){throw "Original changed: $name"}}
  elseif(Test-Path $dest){throw "New-file destination exists: $name"}
  node --check (Join-Path $stage $entry.path)
  if($LASTEXITCODE -ne 0){throw 'JavaScript syntax failed'}
}
New-Item -ItemType Directory -Path $backup | Out-Null
foreach($entry in $entries){$name=Split-Path $entry.path -Leaf;if($entry.originalSHA256){Copy-Item -LiteralPath (Join-Path $target $name) -Destination $backup}}
foreach($entry in $entries){Copy-Item -LiteralPath (Join-Path $stage $entry.path) -Destination (Join-Path $target (Split-Path $entry.path -Leaf)) -Force}
```

Original Gateway terminal: `node C:\Shahvex-AI\integration-gateway\server.cjs`. Restart only Next if browser/relay changes are not hot reloaded, using existing URL/token/local opt-in environment and `npm run dev -- --hostname 127.0.0.1 --port 3000`. No new token required.

### Optional Chatterbox HTTP error-handler patch

Only after reviewing staged Python and during an idle period, stop **only Chatterbox** in its original terminal. Preserve its original Python executable/environment and original startup command. In staging shell:

```powershell
$tts='C:\Shahvex-AI\chatterbox-testing\chatterbox_voice_server.py'
$ttsEntry=$manifest | Where-Object {$_.path -eq 'optional-chatterbox/chatterbox_voice_server.py'}
if((Get-FileHash $tts).Hash -ne $ttsEntry.originalSHA256){throw 'Chatterbox source changed; review again'}
$ttsBackup="$tts.backup-$stamp"
Copy-Item -LiteralPath $tts -Destination $ttsBackup -ErrorAction Stop
Copy-Item -LiteralPath "$stage\optional-chatterbox\chatterbox_voice_server.py" -Destination $tts -Force
if((Get-FileHash $tts).Hash -ne $ttsEntry.sha256){throw 'TTS installed hash mismatch'}
```

Restart Chatterbox using its **original command**, normally `C:\Shahvex-AI\chatterbox-testing\.venv\Scripts\python.exe C:\Shahvex-AI\chatterbox-testing\chatterbox_voice_server.py`. It performs its existing model warmup; no package upgrades or voice changes. Do not stop Whisper/Ollama. This optional patch only handles disconnected HTTP writes; it does not reduce synthesis compute time.

### Rollback

Stop Gateway only, restore originals from backup:

```powershell
foreach($entry in $entries){if($entry.originalSHA256){$name=Split-Path $entry.path -Leaf;Copy-Item -LiteralPath (Join-Path $backup $name) -Destination (Join-Path $target $name) -Force}}
```

Restart Gateway in original terminal. Newly added text-chunks.cjs may remain inert; no original file is removed. If optional TTS patch was applied: stop only Chatterbox, `Copy-Item -LiteralPath $ttsBackup -Destination $tts -Force`, restart using its original command. Keep backup paths. Never restore/change private contract, reference WAV, .env or models.

## Verification and outstanding evidence

Automated five-turn HTTP-stream test covers introduction, follow-up, script question, turn4 interruption and turn5 recovery. Assertions require continuous one-session transport, context from first3 replies, no committed cancelled turn4 response, no stale fourth-generation audio after clear, no STT errors, and cleanup. Separate existing tests cover isolation, auth, deadlines, frame encoding and late microphone permission cleanup.

Physical operator must repeat those five spoken turns with headphones, retain correlated stage timings, confirm microphone indicator stays active after each reply, test recovery after a surfaced utterance failure, Stop twice and ensure activeSessions/queue active/pending=0. No successful acoustic/multi-turn/latency outcome is claimed by automated tests. If STT fails, capture its new code/httpStatus/turnId (without secrets) before making further changes. No private/public network, UI redesign, script/database changes or real calls are part of this patch.
