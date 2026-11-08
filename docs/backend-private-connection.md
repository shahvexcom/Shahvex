# Website backend private connection: deployment rehearsal

**Current hosting:** UI is live on Vercel; backend and AI gateway run on Windows locally. If backend and gateway are on the same physical machine, use `SHAHVEX_GATEWAY_URL=http://127.0.0.1:8787` directly, without SSH. Follow [local-backend-connection.md](local-backend-connection.md). The remote SSH instructions below apply only to a future persistent remote backend. Railway is not deployed; its separate migration plan is [railway-private-migration.md](railway-private-migration.md). Vercel cannot use this Windows machine's localhost.

Physical-PC local E2E was reported successful by the operator: authenticated, ready, cleanup true and 330240 response-audio bytes. This does not verify backend-to-PC networking. The new read-only controller export is the only website route added; no existing UI, schema, agent workflow or calling behavior changes.

## Backend prerequisites (administrator)

The website must have a persistent backend host accepting the approved SSH connection. A serverless function cannot reach another host's loopback: if deployed that way, stop and select a private persistent bridge/backend topology first. Obtain the actual backend hostname, restricted SSH identity and verified host fingerprint; they cannot be inferred from this repository.

Use the dedicated account restrictions in [website-physical-e2e.md](website-physical-e2e.md), including `GatewayPorts no`, remote forwarding only on 127.0.0.1:18787 and no interactive sessions. Provision the physical gateway's existing token privately into backend environment `SHAHVEX_GATEWAY_TOKEN`. Do not regenerate the working physical token or expose it in browser JavaScript. Deploy the reviewed code through your existing deployment process; no deployment was executed by this task.

## Physical PC: separate PowerShell tunnel terminal

Leave the already working gateway, Whisper, Ollama and Chatterbox processes unchanged. After verifying the SSH host fingerprint and installing the dedicated private key through your administrator:

```powershell
ssh -N -T -i "$env:USERPROFILE\.ssh\shahvex_bridge" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:18787:127.0.0.1:8787 shahvex-bridge@YOUR_BACKEND_HOST
```

Replace only the hostname/key path with approved values. This forwards gateway 8787 only, never 11434, 8765 or 8788. Keep this terminal open; Ctrl+C terminates the tunnel. No firewall exposure or public gateway listener is required.

## Website controller browser: export one existing agent

Sign in to the existing controller normally. In the same browser, visit:

```text
https://YOUR_WEBSITE/api/admin/agents/gateway-export?agentId=YOUR_AGENT_ID
```

The existing agent ID can be taken from the controller's existing agents API response/network inspector. The route accepts only the existing controller admin cookie, selects an approved non-BPO agent and its latest assigned script, and downloads a JSON configuration. It includes no lead records, passwords, credentials or gateway tokens. BPO and ordinary agent sessions are rejected; this first controller rehearsal does not add a new BPO workflow. Unapproved agents/missing scripts fail closed.

The exported campaign ID `website-rehearsal:<agentId>` is a rehearsal correlation label, not a persisted campaign assignment. The voice ID maps only to the already tested physical default; existing UI gender/accent fields do not change the voice. No agent/model configurations are written by export. Treat the script-containing download as private data.

Securely copy the downloaded JSON to `.env.agent-e2e.json` in the backend repository. Do not commit it. Never copy browser cookies into shell commands or transfer gateway credentials through the browser.

## Website backend host: PowerShell rehearsal terminal

Use Node 20.19+ and the backend checkout. The token below must already be supplied by the backend secret store/process environment. Do not print it.

```powershell
$env:SHAHVEX_GATEWAY_URL = 'http://127.0.0.1:18787'
if ([string]::IsNullOrWhiteSpace($env:SHAHVEX_GATEWAY_TOKEN)) { throw 'Provision the existing gateway token privately first' }
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq 18787 } | Select-Object LocalAddress,LocalPort
Invoke-RestMethod "$env:SHAHVEX_GATEWAY_URL/health" -Headers @{ Authorization = "Bearer $env:SHAHVEX_GATEWAY_TOKEN" }
node gateway/isolation-check.cjs .env.agent-e2e.json
node gateway/e2e.cjs .env.agent-e2e.json C:\TestAudio\question.pcm C:\TestAudio\backend-reply.pcm
node gateway/e2e.cjs .env.agent-e2e.json C:\TestAudio\question.pcm C:\TestAudio\unused-cancel.pcm --cancel
```

Run sequentially; stop if any command fails. Port 18787 must bind only loopback. Use the previously tested prerecorded mono PCM16 LE 16kHz input, <=9 seconds and aligned to 640-byte frames. Output filenames must not already exist. The CLI uses only process environment, not automatic `.env` loading. Linux backend operators can run the same Node commands using POSIX paths and secret-injected environment; `Get-NetTCPConnection` is Windows-only.

Expected: health ready true; isolation reports stale-token rejection, service-token scoping and cleanup; audio run reports passed/authenticated/cleanup true with nonzero bytes; cancellation reports cancelled/cleanup true. Response sizes vary with generated speech. The runner has a 120s deadline and 30s idle timeout; disconnects abort transport and finally close the session. Tunnel loss may prevent immediate cleanup; gateway idle expiry remains the fallback and the command fails instead of reporting success. Native engine/GPU inference may finish after transport cancellation.

The trusted backend client and CLI reuse the existing scoped-session and PCM/NDJSON protocols. No browser streaming proxy or new privileged synthesis endpoint was added. Local mock tests cover role rejection/export, session isolation, cleanup, output streaming, barge-in cancellation and deadlines; actual backend SSH connectivity and returned real audio still require these deployment commands.

## Development verification

```powershell
node --test tests/*.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

No real calls, media transport guesses or additional provider integration are introduced. VICIdial remains gated on engineer-confirmed Asterisk media details. One-session rehearsal does not establish concurrency capacity.
