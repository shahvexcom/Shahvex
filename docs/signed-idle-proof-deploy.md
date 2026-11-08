# Signed single-use idle proof — replacement for manual JSON freshness workflow

Do **not** rerun Prepare or regenerate the Gateway token. Existing DPAPI credential, verified backup, package hash and recovery launchers remain. This change updates deployment tools and adds an independent DPAPI-protected proof-signing key only after explicit deployment approval. Nothing is deployed by repository edits.

## Why expiration kept recurring

The old workflow started a60s timer before manual clipboard/save steps, process checks, script validation and approval. It trusted file modification time and unsigned JSON. The new workflow validates the package and identities and obtains explicit shutdown approval **before** arming a deployment request. Next stays running. The signed-in local admin then enables maintenance and requests live authenticated Gateway health. If all counts/readiness checks pass, Next writes the proof itself; the waiting controller consumes it immediately, stops only the verified Next/Gateway processes, installs and restarts with existing DPAPI credentials. No download, clipboard or manual timestamp step.

## Authenticity and replay controls

- Existing local-only/development/not-Vercel/not-Railway, exact-origin and controller-auth checks precede proof issuance. Request body/timestamps/counts are ignored; authenticated Gateway health and live relay counts come from the server.
- Maintenance is enabled before health sampling. A deployment lock prevents browser maintenance release for up to3 minutes while proof is armed; a restarted backend still starts in maintenance. Nonzero starting/active relay or Gateway session/queue count refuses issuance and leaves maintenance enabled. Direct Gateway CLI testers must also be stopped; website maintenance does not revoke external service credentials.
- The server's Windows helper supplies issuedAt/expiresAt,60s lifetime, owner SID, exact target, package SHA256, audience and per-approval nonce. HMAC-SHA256 signs the exact encoded payload. Signing key is CurrentUser-DPAPI protected under the existing restricted LocalServices directory; it is distinct from Gateway/Whisper tokens.
- The proof is written atomically by the server to `C:\Users\UC\Documents\Shahvex-idle-health.json` for userUC (fixed USERPROFILE Documents path). ACL restricts current identity/SYSTEM/Administrators. No private token/transcript/audio is in the proof. No client-controlled output path.
- The verifier uses server-issued signed time, rejects clock rollback/future timestamps, age>=60s and altered audience/counts/signature. File last-write time has **no authority**. Manually editing JSON or touching file time cannot refresh it.
- Atomic pending→consumed transition occurs immediately before approved process shutdown; consumed→installed transition occurs in the installer immediately before copy. Each transition is single-use. Changing nonce, copying an older proof, replaying a consumed proof or issuing multiple proofs for one approval fails. A fresh explicit Deploy approval creates a new nonce if an attempt expires; no services stop on expiry.
- Trust boundary: the logged-in OS account and administrators controlling the code/DPAPI store remain trusted. This is not protection against malicious arbitrary code already executing as that same Windows identity. No secrets are extracted from service process memory.

## Short executable sequence

**1. Existing local controller stays running. Update protected tool copies without touching credentials/services:**

```powershell
Set-Location P:\shahvex
powershell.exe -NoProfile -File deployment\Manage-ShahvexLocal.ps1 -Action RefreshTools
```

Approve `UPDATE SHAHVEX DEPLOYMENT TOOLS ONLY`. This copies the new controller, installer and proof helper to the existing restricted store. It does not run Prepare, generate a Gateway token, register tasks or restart anything. Next's repository route should hot reload; do not shut it down manually.

**2. Run Deploy and approve first:**

```powershell
$controller=Join-Path $env:LOCALAPPDATA 'Shahvex\LocalServices\Manage-ShahvexLocal.ps1'
powershell.exe -NoProfile -File $controller -Action Deploy
```

The controller validates existing ZIP/backups, discovers actual loopback listener PIDs and validates Node script identities. It prompts `ROTATE GATEWAY <verifiedPID> AND NEXT`. After exact explicit approval, it arms the unique request and waits up to180s. It does not stop either service before a valid proof arrives. This removes the need for repeated manual PID/token checks. Unknown identities or changed listeners cause refusal.

**3. While the controller says it is waiting, signed-in browser DevTools Console:**

```javascript
await fetch('/api/admin/local-voice?deploymentProof=1', {method:'POST'})
  .then(async r => ({http:r.status,...await r.json()}))
```

Expected HTTP200 and issued:true with server-issued time/path. The operation enables maintenance even if it was previously false. On409, maintenance stays enabled: stop current conversations normally, then retry after drain while the controller is still waiting. On503, inspect the safe error; no proof/shutdown success should be assumed. Do not paste JSON into files. Do not start direct Gateway CLI tests during deployment.

After issuance the approved controller automatically checks signature/freshness/nonce and unchanged process identities; consumes proof; stops only the verified Next Node child and Gateway Node; installs six Gateway files; verifies hashes; authenticates restarted Gateway with existing persisted DPAPI token; starts Next in maintenance. It never touches Job7, Whisper, Ollama, Chatterbox, database, models or private engine contract. Optional Chatterbox replacement remains excluded.

**4. After backend returns, sign in normally if needed and verify:**

```javascript
await fetch('/api/admin/local-voice?gatewayHealth=1')
  .then(async r=>({http:r.status,...await r.json()}))
```

Require authenticated:true, ready:true, maintenance:true and zero counts. Then release:

```javascript
await fetch('/api/admin/local-voice?maintenance=0',{method:'POST'}).then(r=>r.json())
```

If a browser issue occurred before shutdown, the old Next may retain the3-minute proof lock; wait for its expiry before release. New Next instances reset the lock but start maintenance ON. No automatic release occurs.

## Failure and rollback

Signature/expiry/nonce/identity failure before consumption stops nothing. A changed backend that restarts itself after its verified child is stopped prevents Gateway termination; abort and obtain a new approval rather than reusing proof. If installation fails after Gateway termination, the existing controller attempts verified restoration of four originals and relaunches both using the **same stored DPAPI token**, maintaining the existing recovery behavior. If restoration verification fails, unverified code is not started. Never run Prepare during recovery.

For later explicit recovery use the established `-Action Recover` procedure after managed services are stopped under approved maintenance; original backups and token remain. The installer no longer accepts unsigned/manual JSON, including old five-minute files. Older protected tool copies must be refreshed before deploying. Original timing ZIP SHA256 remains14493EA14F531014B616A7D3DE8030A8B05D8E14FF59C8413E4771BEF87D196B; no repackaging is needed for this workflow change.

## Acceptance and tests

Regression tests cover actual CurrentUser-DPAPI/HMAC fixture issuance, forged JSON rejection, replay and installer-receipt reuse rejection, nonce binding and correctly signed expiry, plus API role/local/environment checks and nonzero/failed Gateway health. Fixtures use a separate workspace directory, not real credentials/services. TypeScript/PowerShell syntax checks do not prove deployment or microphone behavior.

After successful install/release, Jennifer: five spoken questions with one interruption, actual assigned/custom session script, consented local two-way recording, preview/download, matching browser timing export and Gateway JSONL. Stop twice; verify eventual sessions/queue/relays0. Physical response latency and audible continuity are not claimed until that run succeeds. No public endpoints or real telephony.
