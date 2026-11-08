# Temporary Groq voice comparison — review only

No listener, audio request, backend restart or deployment was performed. The production provider remains Ollama; Agent Intelligence remains OFF. Review code has no hardcoded agent or script. Existing authorized agent export/session config supplies current assigned script, name, voice ID and history.

## Evidence and remaining content limitation

The single revised case (2026-11-03 18:35 Pakistan time) completed with the same prompt hash as the failed case: first phrase 872.32 ms; completion 3132.47 ms; server queue 339.48 ms; peak sampled GPU 4691 MiB. Groq reported 135 completion tokens, including 11 reasoning tokens, exceeding the old 120-token allowance. New bound is 256; finish stop and done marker confirmed. This proves completion for this one case, not all cases at 256, long campaign compliance or five consecutive live turns.

The response mixed shopping catalog examples (brand, price, best-seller) into the library scenario. It did not invent a company fee, but it was longer and less focused than desired. This is a content-review limitation, not a transport failure. Do not silently rewrite the benchmark prompt or claim voice readiness. Before a client demonstration, review the actual assigned script's constraints and all generated responses. Existing exact-word guarantees are only as strong as the baseline; this experiment adds no new deterministic campaign policy.

## Minimal integration

`groq-voice-review.cjs` is a separate default-OFF local entry point. It replaces only services.llm, uses the tested streaming adapter at 256 total tokens/low reasoning, and forwards content deltas immediately. Existing core PhraseStream, STT, sequential TTS, voice settings, cancellation, generation checks, audio protocol and history remain byte-identical copies of the running physical baseline. No Generic Agent Intelligence files are included or enabled. Incomplete responses fail and do not commit history; a safe prefix may already have streamed before a later failure. No automatic mid-turn provider fallback is attempted.

Review Gateway binds only 127.0.0.1:8789 with one session. Original Gateway 8787 stays available. The wrapper refuses hosted/production environments and stops its own listener on sampled GPU usage >=7164 MiB or monitor failure. One-second sampling is not a reservation or a guarantee against short spikes. Native TTS may drain after cancellation; no Chatterbox process is terminated.

The release contains only ten JavaScript runtime files, two PowerShell launchers, manifest and this guide. No key, .env, private engine contract, model, reference audio or database is included. The eight baseline code files were copied read-only from the physical Gateway and have manifest hashes. The review starts against the existing private contract without modifying it. Health remains the existing baseline dependency check and does not independently prove Groq cloud availability.

## Proposed deployment sequence — execute only after separate approval

1. In the signed-in controller, confirm authenticated ready/maintenance and zero sessions/queues/active/starting relays; confirm no competing direct tests. Do not change maintenance under this preparation. Wait for natural Ollama expiry. Admission: used GPU <=6908 MiB, hard stop >=7164 MiB. Do not run baseline Ollama inference under its NO-GO gate.
2. **Physical Windows PowerShell:** verify the published ZIP SHA256, then extract into a new folder; refuse an existing target. Original Gateway files are not replaced, so its current folder is the untouched rollback baseline.

```powershell
$zip='P:\shahvex\dist\Groq-Voice-Review-v1.zip'
Get-FileHash -LiteralPath $zip -Algorithm SHA256
$review='C:\Shahvex-AI\groq-voice-review-v1'
if(Test-Path -LiteralPath $review){throw 'Target already exists; stop'}
Expand-Archive -LiteralPath $zip -DestinationPath $review
```

3. **Physical Windows PowerShell, dedicated review terminal:** the launcher verifies every runtime hash/syntax and authenticated original Gateway health before starting anything. Both approval switches are declarations of an already-approved window, not substitutes for approval. Set EngineContract explicitly if your existing private file is elsewhere. Do not copy or print its contents.

```powershell
& "$review\Start-Review.ps1" -ReleaseRoot $review -PrivateKeyFile 'P:\shahvex\.env' `
  -EngineContract 'C:\Shahvex-AI\integration-gateway\.env.engine-contract.json' `
  -ApprovedVoiceReviewWindow -ConfirmedBrowserMaintenance
```

Expected: review-listening on loopback 8789; original 8787 remains running. If any prerequisite fails, stop without relaunching or altering services. The existing DPAPI token is loaded into the child process; the key is read from the existing private file inside Node. No secret appears in arguments or logs. --use-system-ca affects only the isolated Node child and retains TLS verification.

4. **Website backend original terminal:** after separate backend-restart approval, Ctrl+C only the original Next.js foreground process. If its original terminal is unavailable, stop here; these launchers do not kill any process. Do not use StopManaged, Deploy or a broad Node stop.

5. **Website backend PowerShell:** start the same verified next dev script with a process-only review target. This requires port 3000 already free. It starts with maintenance ON and restores the parent environment on exit; it never edits .env or the controller.

```powershell
& "$review\Start-Backend.ps1" -Repository 'P:\shahvex' -UseGroqReview -ApprovedBackendRestart
```

6. **Signed-in browser, same 127.0.0.1:3000 origin:** verify the target's authenticated health using the existing endpoint. This only checks health; it does not release maintenance or start audio.

```javascript
await fetch('/api/admin/local-voice?gatewayHealth=1', {
  credentials:'same-origin', cache:'no-store'
}).then(async r => ({status:r.status,...await r.json()}))
```

Require status200/authenticated/ready=true, maintenance=true, all activity counts zero. Stop on any other result. Maintenance release, Start Conversation and live audio require the separate approved voice-test window; they are not authorized by package preparation. No new endpoint or UI is introduced.

## Later five-turn acceptance test

Use the assigned script selection in the existing voice modal, not a hardcoded/custom replacement. Obtain recording consent and use existing two-sided recording/download controls and timing export. Ask five relevant questions with one interruption, then stop and confirm sessions/queues/relays drain. Preserve all recordings and timing logs under unique filenames. Stop at the first integrity/API error; do not retry automatically.

Report each answered turn's speech-end to recording-confirmed audible onset, STT, first Groq phrase, first validated TTS PCM, full completion, audible gaps, peak VRAM and script/voice listening review. Scheduled audio is not actual audible onset. Report incomplete/cancelled turns separately, never as zero latency. Targets: median <=3s and >=20% lower than historical5.62s, completed maximum<=5s, gaps<=500ms, no stale audio, mandatory-word or WAV-integrity failures. Historical context is not a matched A/B; local baseline remains blocked until its memory gate is safe.

## Immediate rollback after an approved review launch

Stop the review-target Next.js only with Ctrl+C in its terminal. Return backend to the original Gateway using the same launcher **without** -UseGroqReview:

```powershell
& "$review\Start-Backend.ps1" -Repository 'P:\shahvex' -ApprovedBackendRestart
```

It targets 8787 with the unchanged DPAPI token and maintenance ON. In the review Gateway terminal, Ctrl+C stops only the isolated8789 listener; no original Gateway restart is needed. Verify original backend health and drained sessions through the browser before any separately approved maintenance release. Do not delete review files/logs or regenerate tokens. If rollback fails, leave maintenance ON and stop testing.
