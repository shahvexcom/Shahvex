# FirstAudio: use the existing controller, no token or infrastructure rebuild

Read-only verification passed for ZIP16EB3A564B2A3028DBFCB1D70696D95DE08F5D609835F6383A231483D3C57BAD, both replacements and current physical originals. Exactly2 physical files: services.cjs and text-chunks.cjs. Existing TimingCapture backups/package remain untouched.

The existing controller/installer/proof helper now accept a FirstAudio profile. No new launcher, credential, service or authentication mechanism. Signed proof binds approval to the selected patch and its pinned SHA256, preventing TimingCapture proof reuse for FirstAudio. After explicit approval, before shutdown, the installer copies/verifies current originals into `C:\Shahvex-AI\integration-gateway\backup-before-first-audio-v1`. An existing conflicting backup refuses overwrite. Installation/automatic failure rollback operate only on this pair; same DPAPI token/contract and local-only gates remain.

## Short procedure (operator approval required)

Keep Next and AI services running; no active CLI tests. In physical PowerShell:

```powershell
Set-Location P:\shahvex
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deployment\Manage-ShahvexLocal.ps1 -Action RefreshTools
$controller=Join-Path $env:LOCALAPPDATA 'Shahvex\LocalServices\Manage-ShahvexLocal.ps1'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $controller -Action Deploy -Patch FirstAudio
```

Approve tool-copy update, then the controller's explicit `DEPLOY FirstAudio GATEWAY <actualPID> AND NEXT` prompt. No Prepare, token rotation or repeated manual PID checks. After backup/preflight, controller waits. In signed-in local browser console:

```javascript
await fetch('/api/admin/local-voice?deploymentProof=1',{method:'POST'})
  .then(async r=>({http:r.status,...await r.json()}))
```

Require HTTP200/issued:true. Endpoint enables maintenance and checks authenticated ready/zero counts; if busy it refuses proof and stops no services. Controller validates/consumes proof, stops only verified Gateway/Next Node children under your approval, installs2 files, verifies post-install hashes and restarts via existing DPAPI launchers. Whisper/Ollama/Chatterbox are not stopped or modified. TTS requests remain sequential and audio order/cancellation are unchanged. STT drains accepted native work before its queue slot releases; stale results never enter LLM/history. Stop/recovery and local-only guards remain.

After backend returns:

```javascript
await fetch('/api/admin/local-voice?gatewayHealth=1').then(async r=>({http:r.status,...await r.json()}))
```

Require authenticated:true, ready:true, maintenance:true and zero counts. Then release maintenance through the existing endpoint. Do not claim installation success from the earlier validation alone.

## Measure5 real turns

Same Jennifer script/voice, headphones and hardware. Consent → record → ask5 questions, including an interruption and contextual follow-up. Stop recording/download, then Stop Conversation and export the browser timings before another run resets them. Preserve comparison baseline `dist/latest-measured-performance.json`; baseline endpoint-arrival→scheduled-playback was9.151/11.274/12.809s, with TTS7.203/9.591/10.436s. Actual acoustic onset remains separately aligned to downloaded recording, not an HTTP result.

From the repository, inspect the new recorded session using existing development logs:

```powershell
node gateway/inspect-performance.cjs
```

Compare STT, LLM first token/complete, TTS first PCM and scheduling. Look for both first-response improvement **and** unwanted gaps between separately synthesized sentences. Small single-sentence replies may see no change; extra segments may cost more total GPU time. A physical voice-quality audition is mandatory. Do not change model/rate/temperature to chase the target without fresh measured evidence.

## Rollback

Installer failure automatically attempts restore of the selected2-file backup, preserving DPAPI token and maintenance. If physical audition is unacceptable, use existing approved maintenance/drain and managed-stop controls (no process-name kills), then:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $controller -Action Recover -Patch FirstAudio
```

Recover refuses an occupied backend/unverified Gateway, restores/verifies this pair only, and restarts same-token services in maintenance. Do not rerun Prepare or use default TimingCapture rollback for this patch. The detailed managed-stop prerequisites remain in `docs/persistent-windows-rotation.md`.

For controller-managed instances, obtain that stop through `powershell.exe -NoProfile -ExecutionPolicy Bypass -File $controller -Action StopManaged -Patch FirstAudio`. It validates saved wrapper identities, asks explicit approval and waits for the same browser proof POST before stopping its two verified Node children. After it completes, run Recover above. No manual proof download or stale-file reuse.

Prepared/tested, not physically applied by the agent. No measured after-patch result exists yet. If latency stays high, choose the next change from the new per-turn TTS/STT/LLM measurements; do not equate a cancelled/error turn with a slow completed response.
