# Endpoint timing and recorded-conversation review: physical evidence pending

## Measurements actually available

No audio attachment or synchronized Gateway/browser timeline was available to this run. The reported60.5s recording and gaps6.5s/5.5s/11.1s/8s are operator observations, not re-measured here. No user/Jennifer segments or transcripts can be attributed from gap durations alone. Supply the actual local recording path plus timing export before assigning those gaps to processing. The only prior physical stage sample is Chatterbox3.643s for73 characters; it may belong to a different turn/run.

| Stage | Physical before | Physical after |
|---|---|---|
| VAD endpoint | Not measured; previous configuration200ms | Not measured; proposed400ms default |
| STT | Not measured | Pending |
| LLM first token/complete | Not measured | Pending |
| TTS synthesis | Supplied3.643s/73 chars, prior turn | Pending |
| Output scheduling / acoustic playback | Not measured | Pending |
| User acoustic speech-end → Jennifer acoustic onset | Not measured | Pending |

No gap is asserted to equal inference time. No latency target achieved. The known prior TTS sample alone exceeds2s; endpoint tuning cannot eliminate that native synthesis cost. LLM streams NDJSON but current Gateway awaits its complete answer; TTS plays bounded sequential WAV segments. Speculative GPU overlap/weight changes are not introduced before correlated physical measurements. Shorter-segment first audio and native streaming are different mechanisms; the existing API is whole-WAV per request.

## Implemented

Gateway endpoint default400ms, configurable with `SHAHVEX_ENDPOINT_SILENCE_MS` (300–1000ms in20ms steps). Every voiced frame resets the silence counter. A300ms intra-sentence pause stays in the same utterance at400ms; after400ms silence one turn submits immediately. Energy VAD cannot know if a grammatical sentence is incomplete. Test400ms first,500ms for clipped natural pauses,300ms only after measurements. Longer than threshold pauses may split an unfinished sentence and later speech can cancel the prior generation. No semantic endpoint claim.

Speech-start/end events now carry the same turnId used by STT/LLM/TTS timing events, with PCM stream sample offsets and actual configured silence frames counted. Browser preserves a bounded2000-event development metadata array and output-device timestamp estimates. No raw audio/text/tokens logged. Missing stage times remain null in the report rather than fabricated.

Previously implemented continuity fixes are retained: empty-STT skip; recoverable utterance errors retain mic/session; bounded worker queue; cancelled generations excluded from history; scoped tokens; idempotent stop; no model/script/voice/UI changes in this update. Self-playback suppression depends on requested browser echo cancellation and headphones, not foolproof source separation. Arbitrarily ignoring all input during playback would break required barge-in, so that unsafe shortcut is not enabled. Physical self-echo behavior remains to verify.

## Capture a synchronized new physical test

Apply the reviewed package below manually first. Leave the existing physical Gateway token/contract unchanged. In its original terminal, set `$env:SHAHVEX_ENDPOINT_SILENCE_MS='400'`, then restart only Gateway with `node C:\Shahvex-AI\integration-gateway\server.cjs`. Keep its existing console visible for Gateway JSON logs, capture output using your existing trusted terminal save/export facility. Do not dump process environment or private contract. Next.js changes use its existing local opt-in/URL/token and loopback dev startup; no AI service/network exposure change.

In the authenticated local browser, open Jennifer's existing modal with the assigned/selected script and headphones. Start the conversation, opt into recording and speak10 sequential questions with pauses. Include identity/social questions, script questions, one natural300ms pause, one interrupted reply and follow-ups. Do not change inference settings between before/after runs. Stop Recording, download the mixed two-way recording; verify you can hear both parties and preserve its filename. Stop conversation and require eventual activeSessions0 and queue active/pending0. No actual10-turn physical test was performed here.

Before closing/restarting the conversation, export browser metadata in Chrome/Edge DevTools Console:

```javascript
copy(JSON.stringify(window.__SHAHVEX_VOICE_TIMINGS__ || [], null, 2))
```

Save clipboard contents to `C:\TestAudio\jennifer-timings.json` using a local editor. The bounded buffer resets per conversation. Its recording-start marker anchors metadata to the downloaded recording start with browser clock precision, not sample-accurate external acoustic calibration. Then on the website checkout:

```powershell
Set-Location P:\shahvex
node gateway/timing-report.cjs C:\TestAudio\jennifer-timings.json
```

Report fields use correlated turnIDs and gateway relative monotonic times; do not subtract absolute browser/PC clocks. `endpointArrivalToPlaybackScheduledMs` begins when browser receives endpoint event, so excludes input batching/uplink and is not total acoustic response delay. Browser logs include output-device estimate from `AudioContext.getOutputTimestamp`; it is not proof that speakers emitted sound. Use the recording waveform plus listener-confirmed speaker attribution to measure actual user speech-end and AI onset. Current mixed recording alone cannot automatically identify overlapping speakers; ambiguous spans must remain unassigned. No transcript invention or automatic diarization is performed.

## Reviewed package, backup and rollback

`dist/Shahvex-Endpoint-Timing-Review-v1.zip` includes five Gateway files (`core.cjs`, `audio-stream.cjs`, `services.cjs`, `text-chunks.cjs`, `server.cjs`), manifest, review and the separate optional Chatterbox disconnect-handler replacement. It incorporates earlier reviewed continuity changes. Apply **only this cumulative bundle**, not multiple older bundles sequentially. ZIP hash accompanies delivery; originals must match manifest hashes or stop for re-review.

Physical staging PowerShell (replace delivered hash):

```powershell
$ErrorActionPreference='Stop'
$zip=Join-Path $env:USERPROFILE 'Downloads\Shahvex-Endpoint-Timing-Review-v1.zip'
if((Get-FileHash -LiteralPath $zip).Hash -ne 'EXPECTED_ZIP_SHA256'){throw 'ZIP checksum mismatch'}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$stage=Join-Path $env:TEMP "shahvex-endpoint-$stamp"
Expand-Archive -LiteralPath $zip -DestinationPath $stage
$manifest=Get-Content "$stage\SHA256SUMS.json" -Raw | ConvertFrom-Json
$allowed=@('gateway/core.cjs','gateway/audio-stream.cjs','gateway/services.cjs','gateway/text-chunks.cjs','gateway/server.cjs','optional-chatterbox/chatterbox_voice_server.py')
if($manifest.Count -ne 6){throw 'Unexpected manifest'}
foreach($entry in $manifest){if($entry.path -notin $allowed){throw 'Unexpected path'};if((Get-FileHash (Join-Path $stage $entry.path)).Hash -ne $entry.sha256){throw 'File checksum mismatch'}}
```

Review staged code. Stop only Node Gateway using Ctrl+C in its original terminal. In staging shell:

```powershell
$target='C:\Shahvex-AI\integration-gateway'
$backup=Join-Path $target "backup-endpoint-$stamp"
$entries=@($manifest | Where-Object {$_.path -like 'gateway/*'})
foreach($entry in $entries){
  $name=Split-Path $entry.path -Leaf;$dest=Join-Path $target $name
  if($entry.originalSHA256){if((Get-FileHash $dest).Hash -ne $entry.originalSHA256){throw "Original changed: $name"}}
  elseif(Test-Path $dest){throw "Unexpected existing new-file target: $name"}
  node --check (Join-Path $stage $entry.path);if($LASTEXITCODE -ne 0){throw 'Syntax check failed'}
}
New-Item -ItemType Directory -Path $backup | Out-Null
foreach($entry in $entries){if($entry.originalSHA256){Copy-Item (Join-Path $target (Split-Path $entry.path -Leaf)) $backup}}
foreach($entry in $entries){$dest=Join-Path $target (Split-Path $entry.path -Leaf);Copy-Item (Join-Path $stage $entry.path) $dest -Force;if((Get-FileHash $dest).Hash -ne $entry.sha256){throw 'Installed checksum mismatch'}}
```

Restart Gateway in its original credential-bearing terminal with400ms setting. Optional Chatterbox HTTP-handler patch is unchanged; review/apply separately using `docs/multiturn-physical-review.md` procedure and this manifest, stopping only that service if approved. No Whisper/model changes. If originals differ, do not force-copy.

Rollback: stop Gateway only; in staging shell run:

```powershell
foreach($entry in $entries){if($entry.originalSHA256){$name=Split-Path $entry.path -Leaf;Copy-Item (Join-Path $backup $name) (Join-Path $target $name) -Force}}
```

Then remove the new process override with `Remove-Item Env:SHAHVEX_ENDPOINT_SILENCE_MS -ErrorAction SilentlyContinue` and restart original Gateway. A new unused helper may remain inert; private contract/secrets and all model files stay untouched. Package generation/development tests do not deploy physical changes. Real calls, VICIdial and public endpoints stay disabled.
