# Controlled timing deployment — use Next's proven credential, not a failing diagnostic shell

## Actionable findings

The verified ZIP hash is14493EA14F531014B616A7D3DE8030A8B05D8E14FF59C8413E4771BEF87D196B. Its7 payload hashes match. The4 original files in `C:\Shahvex-AI\integration-gateway\backup-before-timing-20261102-200114` match its manifest. Six Gateway files are intended: core.cjs, audio-stream.cjs, services.cjs, text-chunks.cjs, server.cjs, telemetry.cjs. No Whisper or Chatterbox change is required for this deployment. Optional Chatterbox handler replacement remains unapplied.

Gateway reads `SHAHVEX_GATEWAY_TOKEN` once at startup. Next's backend client reads the Next server environment; neither reads the Gateway service token from the private engine contract. That contract's STT token is a **different** credential. Separate PowerShell windows do not share live process-scoped values. Diagnostic401 proves a rejected submitted token, not Next failure, nor idle Gateway. Its exact missing/stale/wrong-token source cannot be determined without the original provisioning history; no secret extraction is attempted.

## 1. Prove Next authentication and disable new browser sessions

Use the already signed-in local controller at127.0.0.1:3000. Updated backend code normally hot reloads; do not restart Next blindly because its existing token may be correct. DevTools Console:

```javascript
await fetch('/api/admin/local-voice?gatewayHealth=1').then(async r => ({http:r.status,...await r.json()}))
```

Require `http:200, authenticated:true, gatewayStatus:200`. This actually authenticates with Next's server-side token. If gatewayStatus401, stop: Next's token also fails and must be reprovisioned privately from the known original Gateway credential, not guessed. `enabled/configured` alone is not authentication. No token is returned.

Disable new browser tests (admin, local origin, development gate still enforced):

```javascript
await fetch('/api/admin/local-voice?maintenance=1',{method:'POST'}).then(r=>r.json())
```

This does not terminate existing conversations. Stop existing conversations normally, stop any CLI rehearsal, and keep all testers out during maintenance. Repeat protected Gateway health until activeSessions0, queue.active0, queue.pending0, activeRelays0, startingRelays0 and maintenance:true. No successful idle claim is allowed from401/502/503. Maintenance blocks this local website's session creation only; do not run direct Gateway CLI sessions during the window.

When drained, save fresh safe evidence from the browser:

```javascript
const proof = await fetch('/api/admin/local-voice?gatewayHealth=1').then(r=>r.json());
if(!proof.authenticated || !proof.maintenance || proof.activeSessions || proof.queue.active || proof.queue.pending || proof.activeRelays || proof.startingRelays) throw Error('Not authenticated and drained');
copy(JSON.stringify(proof,null,2));
```

Paste into `C:\Users\UC\Documents\Shahvex-idle-health.json` with a local editor. The installer requires this fresh evidence (<=5min). It contains no secrets. If there is no working credential, this normal path is blocked; an **explicitly approved** maintenance shutdown/drain plan is needed instead. This task does not approve that fallback automatically.

## 2. Validate existing package/backup, no service changes

Physical maintenance PowerShell:

```powershell
Set-Location P:\shahvex
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deployment\Install-TimingCapture.ps1 -Mode Validate
```

Expected PASS for ZIP/payloads/backup/originals. No services stopped or physical files overwritten. Review the script first. It extracts only to a unique TEMP staging directory.

## 3. Stop Gateway only, install six files

Only after Step1 is authenticated/drained and maintenance remains enabled: use Ctrl+C in the **original foreground Gateway terminal**. This re-identifies the service by its actual command, not stale PID27144. Do not stop jobs or node processes by name. Whisper Job7, Ollama, Chatterbox and Next stay running.

If Gateway is not foreground in that known terminal, do not issue a guessed PID kill. Stop here and identify the service through its actual8787 listener and launch configuration before authorizing any stop.

In maintenance PowerShell, within5min of the health evidence:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File P:\shahvex\deployment\Install-TimingCapture.ps1 -Mode Install -MaintenanceConfirmed -IdleHealthFile C:\Users\UC\Documents\Shahvex-idle-health.json
```

Installer refuses a still-listening Gateway, changed originals/backups, wrong ZIP/hash/paths, stale/unauthenticated/busy health evidence, or JavaScript syntax failure. It copies exactly6 Gateway files and verifies every installed hash. It never installs optional TTS or starts/stops services. On failure, do not resume tests; rollback below.

## 4. Restart in original credential-bearing Gateway terminal

Do not copy the known-failing diagnostic-shell token. Do not generate new credentials. Reuse the original Gateway terminal's startup environment and existing private contract. If the original environment was lost or edited, privately reprovision the known original service token before starting; do not claim synchronization from a variable simply being present.

```powershell
if([string]::IsNullOrWhiteSpace($env:SHAHVEX_GATEWAY_TOKEN)){throw 'Original Gateway credential missing; stop'}
if(!(Test-Path -LiteralPath $env:SHAHVEX_ENGINE_CONTRACT)){throw 'Original private contract missing; stop'}
$captureDir=Join-Path $env:USERPROFILE 'Documents\Shahvex-Diagnostics'
New-Item -ItemType Directory -Force -Path $captureDir | Out-Null
$env:SHAHVEX_TIMING_LOG=Join-Path $captureDir ('gateway-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.jsonl')
$env:SHAHVEX_ENDPOINT_SILENCE_MS='400'
node C:\Shahvex-AI\integration-gateway\server.cjs
```

Back in browser, repeat protected Gateway health. Require authenticated:true, ready:true and empty sessions/queue. This proves **restarted Gateway and existing Next token agree**. If401, keep maintenance enabled; do not rotate Next or overwrite the private contract blindly. Resolve the known credential source or rollback. The service must retain its same token across restart; only a successful authenticated request proves that.

Release browser maintenance only after successful health:

```javascript
await fetch('/api/admin/local-voice?maintenance=0',{method:'POST'}).then(r=>r.json())
```

## 5. Five spoken turns and evidence

Use headphones. Jennifer's actual assigned/custom test script must be visible; no permanent assignment change. Start Conversation, obtain participant consent, Start Recording. Ask five synthetic questions: identity, follow-up, script question, interrupt the fourth reply, follow up referring to prior context. Watch real mic/speaker meters. Recovering must report genuine utterance errors and allow a new utterance, not silently discard processing. Stop Recording; download the two-sided mixed audio. Stop Conversation twice; health should settle at0 sessions/queue/relays. Do not start another session before exporting metadata:

```javascript
copy(JSON.stringify(window.__SHAHVEX_VOICE_TIMINGS__ || [],null,2))
```

Save to `C:\Users\UC\Documents\Shahvex-Diagnostics\browser-timings.json`, then:

```powershell
node P:\shahvex\gateway\timing-report.cjs C:\Users\UC\Documents\Shahvex-Diagnostics\browser-timings.json
```

Match recording-start and turnIDs across files. Scheduled/output-device estimates are not actual acoustic onset; use the downloaded two-way recording with confirmed speaker labels for speech-end→audible-response. Native TTS3.643s/73chars is the only previous supplied stage sample. New before/after latency, five spoken turns and actual sound are **not yet physically verified**. Automated ten-turn and recovery tests are simulated.

## Rollback on failure

Keep maintenance enabled, stop Gateway only in its foreground terminal. Maintenance PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File P:\shahvex\deployment\Install-TimingCapture.ps1 -Mode Rollback -MaintenanceConfirmed
```

This restores/verifies exactly4 backed-up originals;2 new helpers may remain unused. In original Gateway terminal:

```powershell
Remove-Item Env:SHAHVEX_TIMING_LOG -ErrorAction SilentlyContinue
Remove-Item Env:SHAHVEX_ENDPOINT_SILENCE_MS -ErrorAction SilentlyContinue
node C:\Shahvex-AI\integration-gateway\server.cjs
```

Verify authenticated protected health before releasing maintenance. No token/model/voice/DB/Whisper changes are part of rollback. No public endpoint or telephony activation.
