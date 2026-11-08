# One maintenance window: cumulative VoiceStreaming release

Prepared and reviewed only. No physical services stopped or files replaced. Do not use the older partial packages for this release. Follow these steps in one maintenance window, keeping maintenance ON through BOTH component deployments. Each shutdown requires explicit approval.

Files in `P:\shahvex\dist`:

| File | SHA256 |
|---|---|
| Shahvex-Voice-Streaming-Gateway-v1.zip | 549D32A743F41A4868057C1D67D318B5B35817463A4DA7B67DB1A2AD49674237 |
| Shahvex-Voice-Streaming-Chatterbox-v1.zip | 7464ABF178EF52F3CB03E4E7CB2F5DBCCBCB9A696D1D8854129358B98E67549D |
| Shahvex-Voice-Streaming-Release-v1.json | D0E1CF0F458E59C903538C4BC2EF960F2694845FA895A8F94FC7E1427F9D315A |

The existing signed-proof field named zipSHA256 binds the release-manifest hash for VoiceStreaming. That pinned manifest binds BOTH component ZIP hashes. The existing installer verifies the release pin, selected ZIP pin, exact entries, every payload hash and deployed originals. No proof lifetime or access gate is relaxed.

Gateway archive: core.cjs, audio-stream.cjs, services.cjs, telemetry.cjs and new phrase-stream.cjs under gateway/, plus DEPENDENCIES.json, SHA256SUMS.json and REVIEW.md (eight entries). Chatterbox archive: optional-chatterbox/chatterbox_voice_server.py plus the same three metadata/review filenames (four entries). No .env, tokens, model weights or voice reference audio.

The cumulative Gateway includes 160ms onset confirmation, existing 400ms endpoint, native STT/TTS drain, generation checks, bounded phrase streaming and sequential synthesis. The wrapper includes bounded WAV transfer, disconnect/error response protection, no waiting native queue and metadata timing. The model, reference path and generation parameters are unchanged. FirstAudio text-chunks.cjs is verified with hash 4C6B08C47BC643C6A81BC48EB30AD7389722A3D620DDD78E1E7AAB31EBCDD34B, not replaced. Dynamic prompts, history, browser playback and recording remain in the existing application. The local Next restart uses this repository's metadata/report updates; no website layout or database change is included.

Controller extension is only a VoiceStreaming package selection and component handling in the EXISTING installer. Do not run Prepare or rotate credentials. Reuse the same DPAPI source, signed localhost admin proof and independent component rollback.

## 1. Physical PC  PowerShell A: validate and back up before any stop

Use the same signed-in Windows user that owns the existing DPAPI store. Each `ExecutionPolicy Bypass` applies only to the reviewed local script invocation, not the machine policy. No remote script is loaded.

First stop any browser voice conversation using its Stop control. In the signed-in local browser DevTools Console, enable maintenance before backup/deployment:

```javascript
const maintenance = await fetch('/api/admin/local-voice?maintenance=1', {method:'POST'});
console.log(maintenance.status, await maintenance.json());
```

Require HTTP200 and maintenance=true. The controller will additionally require fresh authenticated zero-session/queue/relay proof before termination.

```powershell
Set-Location P:\shahvex
$ErrorActionPreference='Stop'
$store=Join-Path $env:LOCALAPPDATA 'Shahvex\LocalServices'
$ctl=Join-Path $store 'Manage-ShahvexLocal.ps1'
$install=Join-Path $store 'Install-TimingCapture.ps1'
function Checked([scriptblock]$Run) { & $Run; if($LASTEXITCODE -ne 0){throw 'Command failed; STOP'} }
Checked { powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\Install-TimingCapture.ps1 -Mode Validate -Patch VoiceStreaming }
Checked { powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\Install-TimingCapture.ps1 -Mode Validate -Patch VoiceStreaming -Component Chatterbox }
Checked { powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\Manage-ShahvexLocal.ps1 -Action RefreshTools }
```

Expected: both validations PASS; type `UPDATE SHAHVEX DEPLOYMENT TOOLS ONLY` for RefreshTools. After Deploy approval, the controller automatically backs up BOTH components before any stop. Backups are hash-verified at:

- `C:\Shahvex-AI\integration-gateway\backup-before-voice-streaming-v1`  four Gateway originals; phrase-stream.cjs is verified absent.
- `C:\Shahvex-AI\chatterbox-testing\backup-before-voice-streaming-v1`  exactly one Python file.

Unexpected existing backup contents or changed deployed originals cause refusal. Do not overwrite backups or edit expected hashes.

## 2. Gateway  existing controller, signed maintenance proof

In PowerShell A:

```powershell
Checked { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ctl -Action Deploy -Patch VoiceStreaming }
```

Read and type the controller's exact `DEPLOY VoiceStreaming GATEWAY <current PID> AND NEXT` approval only when ready. It checks current listener/process identity, backs up, arms the existing proof, and waits. This is an intentional coordinated Gateway/Next.js restart; Whisper, Ollama and Chatterbox stay running.

While it waits, use DevTools Console in the signed-in local controller browser at `http://127.0.0.1:3000`:

```javascript
const proof = await fetch('/api/admin/local-voice?deploymentProof=1', {method:'POST'});
console.log(proof.status, await proof.json());
```

Expected: HTTP200 and `issued:true`. This enables maintenance and writes the fresh signed proof directly; no manual JSON/download/token is used. The controller verifies and consumes it before stopping its verified processes. Freshness remains under 60 seconds, not extended. On failure before stop, do not stop anything manually. On installer failure, the controller attempts verified Gateway rollback and restarts with the same DPAPI source.

Expected controller result: exactly five Gateway files installed with verified hashes, Gateway authenticated/ready, backend launched with maintenance ON. Wait for Next.js readiness, then browser:

```javascript
const health = await fetch('/api/admin/local-voice?gatewayHealth=1');
console.log(health.status, await health.json());
```

Require HTTP200, authenticated=true, ready=true, maintenance=true, activeSessions=0, queue active/pending=0, activeRelays=0 and startingRelays=0. Keep maintenance ON. Do not start Jennifer yet.

## 3. Chatterbox  separate approval and fresh proof

The current Chatterbox was verified to use system Python 3.11, not the documented virtual environment. Capture its current executable and reuse it. Its relative script command is accepted only with a single loopback listener, Python identity and the expected script filename. The process snapshot is rechecked immediately before shutdown. Never use a fixed PID or stop by process name.

PowerShell A, before requesting a new proof:

```powershell
$nativeRoot='C:\Shahvex-AI\chatterbox-testing'
$nativeScript=Join-Path $nativeRoot 'chatterbox_voice_server.py'
$listeners=@(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction Stop)
if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1'){throw 'Unexpected Chatterbox listener'}
$native=Get-CimInstance Win32_Process -Filter "ProcessId = $($listeners[0].OwningProcess)"
if(!$native -or $native.Name -notmatch '^python(w)?\.exe$' -or !$native.ExecutablePath -or $native.CommandLine -notmatch '(?i)(?:^|[\s"/\\])chatterbox_voice_server\.py(?:[\s"]|$)'){throw 'Chatterbox identity not established'}
$python=$native.ExecutablePath
if((Read-Host 'Type DEPLOY CHATTERBOX ONLY to approve this separate restart') -cne 'DEPLOY CHATTERBOX ONLY'){throw 'Not approved'}
Checked { powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $store 'IdleProof.ps1') -Action Arm -ProofPatch VoiceStreaming }
```

Now run the **same browser proof POST from step 2 again**, requiring HTTP200/issued=true. A newly armed nonce is required; the Gateway deployment proof cannot be replayed. Then immediately run the block below (under 60 seconds). If delayed, stop and re-arm/reissue before terminating anything.

```powershell
$again=Get-CimInstance Win32_Process -Filter "ProcessId = $($native.ProcessId)"
$listeners=@(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction Stop)
if(!$again -or $again.CreationDate -ne $native.CreationDate -or $again.ExecutablePath -ne $python -or $again.CommandLine -ne $native.CommandLine -or $listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1' -or $listeners[0].OwningProcess -ne $native.ProcessId){throw 'Chatterbox identity changed; STOP'}
Checked { powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $store 'IdleProof.ps1') -Action Consume -ProofPatch VoiceStreaming }
Stop-Process -Id $native.ProcessId -ErrorAction Stop
Wait-Process -Id $native.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
if(Get-Process -Id $native.ProcessId -ErrorAction SilentlyContinue){throw 'Chatterbox did not exit; do not install'}
try {
  Checked { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $install -Mode Install -Patch VoiceStreaming -Component Chatterbox -MaintenanceConfirmed -IdleHealthFile (Join-Path $env:USERPROFILE 'Documents\Shahvex-idle-health.json') }
} catch {
  Checked { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $install -Mode Rollback -Patch VoiceStreaming -Component Chatterbox -MaintenanceConfirmed }
  throw 'Native install failed; original restored. Keep maintenance ON; start original with the launch block below.'
}
```

Only the specifically approved Chatterbox Python process is stopped. Gateway, Next.js, Whisper (including Job7) and Ollama remain untouched during this separate step. The installer refuses replacement while port8765 still listens and checks the consumed signed proof before replacement. If the proof expires after shutdown, it refuses installation: restore the native backup with Rollback and restart the original, rather than weakening freshness checks.

Start the installed wrapper (or restored original following a rollback) with the captured executable, same working directory and reference path. No new environment settings are supplied. Run this only once and only with port8765 free:

```powershell
if(@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -eq 8765}).Count){throw 'Port8765 occupied; do not start a second TTS process'}
$tag=Get-Date -Format 'yyyyMMdd-HHmmss'
$nativeLog=Join-Path $nativeRoot "voice-streaming-$tag.stdout.log"
$nativeError=Join-Path $nativeRoot "voice-streaming-$tag.stderr.log"
$started=Start-Process -FilePath $python -ArgumentList @('-u',('"'+$nativeScript+'"')) -WorkingDirectory $nativeRoot -WindowStyle Hidden -RedirectStandardOutput $nativeLog -RedirectStandardError $nativeError -PassThru
```

Do not clear or replace existing environment/model/voice settings. Wait for `VOICE SERVICE READY` in `$nativeLog`; startup may take time. Verify from PowerShell A:

```powershell
Get-Content -LiteralPath $nativeLog -Tail 12
Invoke-RestMethod http://127.0.0.1:8765/health -TimeoutSec 5
```

Require ready=true, model=chatterbox-turbo and the existing RTX4060. Repeat browser Gateway health from step2 and require authenticated, ready and drained with maintenance=true. Failure means keep maintenance ON and use native rollback. Do not benchmark until both health checks pass.

## 4. Release maintenance and record five physical turns

In the signed-in local browser:

```javascript
const release = await fetch('/api/admin/local-voice?maintenance=0', {method:'POST'});
console.log(release.status, await release.json());
```

Require HTTP200 and maintenance=false. The existing proof lock can refuse release until its 180-second lock expires; if so wait for that window and retry. Never remove the lock. Select the existing approved Jennifer, keep the assigned script (or explicitly selected dynamic test script), use headphones, consent to local mixed recording, and start one conversation.

Ask five real questions in the same session, including one short yes/no follow-up, one natural pause and one deliberate interruption. Check script-following, history and full later sentences. Stop and download the two-sided recording. Do not count intentionally cancelled or empty turns as successful latency samples; obtain five answered questions. Verify no stale audio, no STT429, no lost follow-up and cleanup/queue/relay zeros after Stop.

From repository PowerShell after the recording:

```powershell
node gateway/inspect-performance.cjs
Get-Content -LiteralPath $nativeLog | Select-String 'tts-wav-ready|tts-transfer-complete|tts-busy|tts-error|tts-transfer-disconnected'
```

Retain the controller's newest Gateway metadata JSONL at `%LOCALAPPDATA%\Shahvex\LocalServices\gateway-*.jsonl`, the browser timing events in `.next/dev/logs/next-development.log`, the native stdout/stderr logs and the downloaded recording. Gateway/native IDs differ: correlate ordered segment requests by UTC/timing, character counts and request order, not by guessing text. Native log events include request ID and `atUnixMs` (UTC epoch milliseconds), but no transcript. This UTC field is the only additional wrapper change during packaging; model/voice/generation arguments remain unchanged. Isolate this single-session test; exact segment-to-turn binding can remain ambiguous if another localhost client calls TTS. Do not invent a direct cross-service ID match.

Report all five measured rows: endpoint, STT, complete LLM, TTS first PCM, browser scheduled/device-estimated playback and recording-confirmed audible onset, plus inter-segment gaps and full-reply completion/cancellation. Compare against prior **4.36-9.54s endpoint-to-scheduled-playback**, using the same metric. Also report speech-end-to-audible separately (includes endpoint silence); never call scheduled playback exact audible onset. Target <=2s when achievable, not a promised result. Identify the largest measured stage if missed.

## Rollback  independent components

**Native rollback:** enable maintenance with the protected browser `POST ...?maintenance=1`, verify no sessions/queue/relays, and repeat step3's approval, fresh proof and exact-process stop against the current native listener. Replace Install in that block with:

```powershell
Checked { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $install -Mode Rollback -Patch VoiceStreaming -Component Chatterbox -MaintenanceConfirmed }
```

Then use the same captured-Python launch block and health checks. Rollback restores the verified original wrapper hash; no voice, model, environment file or token changes occur. If native startup is already failed and port8765 is free, maintenance remains ON: the rollback installer may run directly without a ready-engine proof, restoring a stopped service. Never use a failed health request as proof that a running service is idle.

**Gateway rollback:** first make Chatterbox healthy (restore it first if necessary). Use the existing managed-stop/proof workflow, then Recover, selecting this package so it restores these specific originals:

```powershell
Checked { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ctl -Action StopManaged -Patch VoiceStreaming }
# While waiting: issue the browser deploymentProof POST as in step2.
Checked { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ctl -Action Recover -Patch VoiceStreaming }
```

Read/type the existing stop and recovery approval phrases. Managed stop targets verified Gateway/Next.js only, never native AI services, and disables their registered tasks to prevent restart races. Recover restores the four verified Gateway originals and removes the new helper only after checking its installed hash and restarts using unchanged DPAPI credentials. It does not re-enable disabled tasks: leave them disabled for this local verification and review their re-enablement separately. Keep maintenance ON until authenticated health and the original working configuration are verified. Unexpected live listeners or unverified process identity mean stop and review; never kill by name or overwrite files anyway.

## Prepared validation

Both physical-original validations passed without modifying services. 57 Node +4 Python functional tests passed. Deployment fixture tests verified separate backups/rollback hashes, tamper rejection, exact paths, ZIP pinning and PowerShell syntax. Listener regression passed. Signed-proof fixture tests passed all four package/release bindings, expiry, forgery and replay checks with disposable DPAPI keys, not the service credential. Physical post-install microphone timing is still pending.
