# Final controlled rotation with persistent Windows credentials

Operator interface: `deployment/Manage-ShahvexLocal.ps1`. It invokes the existing hash-pinned Timing Capture installer; Prepare copies both reviewed scripts into the protected per-user service directory. Neither action has been executed by the agent. Validation to date is static PowerShell syntax and repository tests, not service/reboot verification.

## Credential and identity model

Prepare generates one new random32-byte Gateway token and exports a SecureString using Windows CurrentUser DPAPI to `%LOCALAPPDATA%\Shahvex\LocalServices\gateway-token.dpapi.xml`. The directory gets a protected DACL: current user's SID, SYSTEM and Administrators only, inherited by new files. No Everyone/Users grant, no plaintext secret file, browser response, command argument or Git file. DPAPI also ties decryption to the Windows user/profile on this machine; copying the XML to another PC/user will not provision a working credential. Administrators and processes already running as that user remain in the trust boundary. Do not use transcription/debug environment dumps while provisioning.

Both service launchers decrypt this same file into their child process environment. A new token is generated **only by Prepare**, which refuses to overwrite an existing credential. Deploy, Recover, reboot and rollback reuse it. Private engine contract and its distinct Whisper token are read in place, never changed. Backend auth/database/encryption settings must already be persistent in the existing `.env`/local configuration; process-only settings from the old inaccessible shell cannot be recovered by this tool. Preserve/reprovision any such settings from your existing trusted secret source before restart. No DB/auth values are reset or extracted.

Gateway explicitly starts in C:\Shahvex-AI\integration-gateway with its absolute server.cjs, the existing .env.engine-contract.json, endpoint400ms and a unique metadata-only log in the protected directory. Backend explicitly starts in P:\shahvex through its existing Next dev binary, loopback3000, same token/URL, local flag and startup maintenance ON. Launch arguments contain script/action names, never the token. Models/voices/scripts remain unchanged.

## Procedure — run with Windows PowerShell5.1 as the intended service user

### 1. Prepare persistent credential and trusted launchers; no stops

```powershell
Set-Location P:\shahvex
powershell.exe -NoProfile -File deployment\Manage-ShahvexLocal.ps1 -Action Prepare
```

Review code, then type `PREPARE SHAHVEX COORDINATED ROTATION`. This stores the new credential/launchers only. It does not replace the still-running Gateway token, start services or register tasks. Keep existing backup `C:\Shahvex-AI\integration-gateway\backup-before-timing-20261102-200114`. Do not delete the DPAPI credential on any later failure.

### 2. Fresh authenticated idle proof through still-working Next

With current browser maintenance enabled, stop conversations normally and keep all direct Gateway/CLI testers out. Browser DevTools:

```javascript
const p=await fetch('/api/admin/local-voice?gatewayHealth=1').then(r=>r.json());
if(!p.authenticated || !p.ready || !p.maintenance || p.activeSessions ||
   p.queue.active || p.queue.pending || p.activeRelays || p.startingRelays)
  throw Error('Not authenticated and drained');
copy(JSON.stringify(p,null,2));
```

Save it as C:\Users\UC\Documents\Shahvex-idle-health.json using a local editor. Stop **only Next.js** through Ctrl+C in its known foreground terminal. The controller deliberately refuses to kill an unknown backend listener. If Next is also inaccessible, stop here and establish a separately approved exact backend shutdown plan; do not kill all Node processes. This procedure depends on the existing accessible Next terminal.

### 3. Deploy within60 seconds of refreshed proof

In maintenance PowerShell (use the CURRENT verified Gateway listener PID, not an assumed historical value):

```powershell
$serviceScript=Join-Path $env:LOCALAPPDATA 'Shahvex\LocalServices\Manage-ShahvexLocal.ps1'
$gatewayListener=@(Get-NetTCPConnection -State Listen -LocalPort 8787)
if($gatewayListener.Count -ne 1){throw 'Unexpected Gateway listener'}
powershell.exe -NoProfile -File $serviceScript -Action Deploy -ExpectedGatewayPid $gatewayListener[0].OwningProcess
```

Script validates ZIP, six replacement paths, seven payload hashes, four backups and originals; requires authenticated ready/drained maintenance proof no older than60s, stricter than installer's5min. It requires no backend listener on3000; rechecks Gateway's node/server.cjs identity and creation time. Then it prompts `ROTATE GATEWAY <actualPID> AND NEXT`. Only typing that exact phrase authorizes PID-specific drained maintenance termination. It never stops parent PowerShell, Job7, Whisper, Ollama or Chatterbox. If proof expires, **no termination occurs**; resume the original Next process with its original working credential, refresh proof and retry. Do not falsify timestamps.

The installation copies only six Gateway files. If copy/installer fails after shutdown, the script attempts verified restoration of the four backup originals, then starts that old Gateway code with the **new persistent token** and starts Next with the same token and maintenance ON. It reports the patch failure even if recovery succeeds. If rollback verification fails, it does not launch unverified code. Keep maintenance enabled and preserve the backup.

On successful install, the new Gateway is started and checked with the new credential for authenticated ready+idle health before Next is launched. Timeout/auth/readiness failure stops the workflow with an error; no successful completion is claimed. Follow recovery below; do not regenerate the credential.

### 4. Prove Next and Gateway share the credential

Sign into local controller normally (existing auth config retained), then:

```javascript
await fetch('/api/admin/local-voice?gatewayHealth=1').then(async r=>({http:r.status,...await r.json()}))
```

Require HTTP200, authenticated:true, ready:true, maintenance:true and all session/queue/relay counts0. The script's Gateway check does not substitute for this actual Next check. Release maintenance only after success:

```javascript
await fetch('/api/admin/local-voice?maintenance=0',{method:'POST'}).then(r=>r.json())
```

## Persistent restart after windows close / reboot

Launchers are separate child processes, not PowerShell jobs. Closing the invoking maintenance window does not intentionally stop them. The token remains on disk encrypted. For actual restart management register exactly one mode after successful authentication. Tasks execute the protected launcher copy, not a token-bearing command line.

**Sign-in mode** (no stored Windows account password):

```powershell
powershell.exe -NoProfile -File $serviceScript -Action RegisterLogon
```

**Before-sign-in boot mode** (requires administrator-approved Task Scheduler rights and your same account's real Windows password, not a Hello PIN):

```powershell
powershell.exe -NoProfile -File $serviceScript -Action RegisterBoot
```

Both require `REGISTER SHAHVEX PERSISTENT TASKS`. Boot mode prompts Windows credential UI; Task Scheduler stores the Windows logon credential in its protected store. Gateway token stays DPAPI-protected. Do not use S4U or SYSTEM with this CurrentUser token. Account must be allowed batch logon; policy may require administrator provisioning. No automatic privilege/logon-right changes are made. Two tasks (`Shahvex-RunGateway`, `Shahvex-RunBackend`) are created without starting duplicate instances; existing task names cause refusal, not overwrite. Configured retry is3 retries at1-minute intervals after failure, not unlimited restart.

Reboot prerequisites: P: must be a stable local volume visible to that account at startup, **not an interactive mapped network drive**; Node/Python and existing environment paths must be available; existing AI services must independently start normally. This controller never starts/modifies those AI services. If dependencies are not available, health/test will fail safely. Sign-in tasks do not promise pre-sign-in availability. Boot tasks cannot promise recovery until actually tested on Windows with account/policy/dependency readiness. All backend restarts begin in maintenance; require protected health before release.

Verify tasks read-only with `Get-ScheduledTask -TaskName Shahvex-RunGateway,Shahvex-RunBackend | Select-Object TaskName,State`. A task registered after manually launched services will manage subsequent triggers; it does not attach supervision to pre-existing processes. Do not start tasks while ports are occupied. At next approved sign-in/reboot, verify health plus same DPAPI credential/auth and maintenance before declaring persistence verified.

## Recovery and rollback — never Prepare again

For healthy but hidden services launched by this controller, there is an exact stop action: refresh authenticated maintained/idle proof through Next, then run `powershell.exe -NoProfile -File $serviceScript -Action StopManaged`. It requires `STOP MANAGED GATEWAY AND NEXT`, validates both loopback listeners against protected wrapper PID/start-time records and their direct Node children, rechecks authenticated idle Gateway, then stops only those children. It refuses unrelated/reused PIDs. No parent PowerShell, AI worker or process-name-wide kill is used. If a failed Gateway cannot authenticate, StopManaged refuses; use an explicitly approved exact process recovery plan, not an unauthenticated idle claim. Do not use this action on unmanaged originals.

StopManaged also disables only the two named Shahvex tasks if present, preventing retry races during recovery. After recovery and successful protected health, explicitly re-enable those same tasks with `Enable-ScheduledTask -TaskName Shahvex-RunGateway` and `Enable-ScheduledTask -TaskName Shahvex-RunBackend`; do not start duplicates while listeners are occupied.

Recover can stop a still-listening **managed Gateway** after explicit recovery approval if it can authenticate with the persistent token and confirm empty sessions/queue, even if model readiness is false. It validates saved wrapper identity/child creation time before that PID-specific stop. It refuses unmanaged or unauthenticated listeners. The backend port must already be stopped. If authentication itself is broken, do not infer drain: retain maintenance and use a separate explicitly approved shutdown plan.

If Gateway startup fails after install, keep maintenance enabled. Before Recover, ports8787 and3000 must be stopped through known service controls. For already registered tasks, use their exact task names through Task Scheduler; for a manually launched Gateway that is stuck/running, obtain fresh authenticated idle evidence and approve only its exact listener PID termination as in the earlier controlled plan. The controller refuses automatic kills during recovery. If hidden backend launch needs stopping and no registered task owns it, establish an exact PID-specific Next shutdown plan rather than killing by name. Do not touch Job7.

```powershell
powershell.exe -NoProfile -File $serviceScript -Action Recover
```

Type `RESTORE SHAHVEX CODE WITH SAME TOKEN`. Verified four originals restore; unused new helpers remain inert. Both services relaunch from the same DPAPI secret and existing contract. No old-token recovery is required and **no new token is generated**. Repeat protected Next health; leave maintenance ON if any check fails. Registering scheduled tasks and reboot verification are separate explicit operations, not silently performed by deploy.

## Physical conversation acceptance

Only after successful protected health, use Jennifer's existing script/voice with headphones. Opt into two-sided recording; ask5 questions including an interruption and context follow-up. Save recording and browser `window.__SHAHVEX_VOICE_TIMINGS__` metadata before another session resets it. Gateway JSONL logs are in the protected LocalServices folder. Compare VAD/STT/LLM/TTS timing and acoustic recording; no latency improvement is claimed from startup/auth success. No real calls or public AI endpoints.
