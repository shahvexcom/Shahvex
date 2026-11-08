# Website backend to physical Windows AI server: E2E rehearsal

Update: the operator reports physical-local E2E passed with ready/authenticated/cleanup true and 330240 returned bytes. For the missing website export and backend private-network deployment steps, use [backend-private-connection.md](backend-private-connection.md). Actual backend tunnel verification is still pending.

This is a backend integration rehearsal, not a browser/phone test. It reads an agent configuration JSON representing the website's authorized agent settings and calls the same trusted backend client intended for the application. It does not query or alter the database, expose a new website endpoint, or exercise website login/RBAC. UI and production features remain unchanged. Physical execution requires the operator's machines and credentials; local development tests use fixtures.

## 1. Physical Windows 11 PC

Copy the reviewed `gateway` folder to `C:\Shahvex-AI\integration-gateway`. Keep the existing engine services and voice scripts unchanged. Use the existing virtual environment and cached Whisper model; no pip install is needed.

In PowerShell, create private process variables (PowerShell 7 supports `GetBytes`; Windows PowerShell 5.1 can use the following compatible helper):

```powershell
function New-BridgeSecret {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes); [Convert]::ToBase64String($bytes) } finally { $rng.Dispose() }
}
$env:SHAHVEX_GATEWAY_TOKEN = New-BridgeSecret
$env:SHAHVEX_WHISPER_TOKEN = New-BridgeSecret
$bridgeDir = 'C:\Shahvex-AI\integration-gateway'
$contract = Get-Content -LiteralPath "$bridgeDir\physical-engine.example.json" -Raw | ConvertFrom-Json
$contract.stt.token = $env:SHAHVEX_WHISPER_TOKEN
$contract | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$bridgeDir\.env.engine-contract.json" -Encoding ASCII
$env:SHAHVEX_ENGINE_CONTRACT = "$bridgeDir\.env.engine-contract.json"
$env:SHAHVEX_MAX_SESSIONS = '1'
```

The contract contains a secret: restrict its NTFS access to the engine service identity and administrators using your existing secret/file policy. Do not commit it. Securely provision the **gateway token only** to the backend's secret store. Never print either token or send them in chat. Tokens must remain identical for this rehearsal; regenerating them requires updating both ends and restarting services.

Start the separate Whisper wrapper and gateway from this same shell so both child processes inherit their environment:

```powershell
$whisperJob = Start-Job -ArgumentList $bridgeDir,$env:SHAHVEX_WHISPER_TOKEN -ScriptBlock {
  param($dir,$secret)
  $env:SHAHVEX_WHISPER_TOKEN = $secret
  & 'C:\Shahvex-AI\.venv\Scripts\python.exe' "$dir\whisper_bridge.py"
}
node "$bridgeDir\server.cjs"
```

The foreground gateway stops with Ctrl+C. Afterwards stop the wrapper with `Stop-Job $whisperJob; Remove-Job $whisperJob`. For ongoing operation use an approved service manager instead of jobs. If Whisper reports missing cache, set `SHAHVEX_WHISPER_MODEL_PATH` inside the job to the actual existing model directory; do not download another model. Full Python sources are [whisper_bridge.py](../gateway/whisper_bridge.py) and [prepare_audio.py](../gateway/prepare_audio.py).

Keep the existing Ollama/Chatterbox startup unchanged. Verify listeners in a second terminal:

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 11434,8765,8787,8788 } | Select-Object LocalAddress,LocalPort
Invoke-RestMethod http://127.0.0.1:8765/health
```

Expected addresses are loopback, never `0.0.0.0` or `::`. The TTS health JSON schema still needs confirmation: gateway readiness currently requires `ready:true`; an actual successful round trip is recorded separately from this health flag. Test the existing voice before attesting `existing-chatterbox-default`; no voice selection parameters are added to Chatterbox requests.

## 2. Backend host: SSH administrator setup

An administrator must provision a dedicated SSH key/account on the website backend host. Do not use passwords, disable host-key checking, or open model ports. Restrict the account to remote forwarding on `127.0.0.1:18787`, with `GatewayPorts no`, no shell/TTY/agent/X11 access. For an OpenSSH server, the administrator can use the following account-specific sshd configuration, adapted to the installed OS/version:

```text
Match User shahvex-bridge
    AllowTcpForwarding remote
    GatewayPorts no
    PermitListen 127.0.0.1:18787
    PermitTTY no
    AllowAgentForwarding no
    X11Forwarding no
    MaxSessions 0
```

Validate with `sshd -t` and retain existing sessions before applying the configuration through the server's normal service process. Verify server host-key fingerprints out of band. No SSH server changes are performed by this repository. If the backend is serverless or cannot accept SSH, use a dedicated private bridge host reachable by the backend; this loopback-only client cannot directly target another machine.

## 3. Physical PC: establish encrypted tunnel

Once the host key is verified and the dedicated key provisioned:

```powershell
ssh -N -T -i "$env:USERPROFILE\.ssh\shahvex_bridge" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:18787:127.0.0.1:8787 shahvex-bridge@YOUR_BACKEND_HOST
```

Replace `YOUR_BACKEND_HOST` with the approved address. Only the authenticated gateway is forwarded. Ollama 11434, Chatterbox 8765 and Whisper 8788 remain physical-PC loopback services. Backend port 18787 also stays loopback; SSH authenticates/encrypts the network hop and gateway/session tokens authorize requests. Keep the tunnel running during the test. No tunnel has been established from this development environment.

## 4. Website backend: prerecorded single-agent test

On the backend, provision `SHAHVEX_GATEWAY_TOKEN` privately from the same secret used by the physical gateway. Run from the website repository with Node 20.19+:

```powershell
$env:SHAHVEX_GATEWAY_URL = 'http://127.0.0.1:18787'
Invoke-RestMethod "$env:SHAHVEX_GATEWAY_URL/health" -Headers @{ Authorization = "Bearer $env:SHAHVEX_GATEWAY_TOKEN" }
Copy-Item gateway\agent-e2e.example.json .env.agent-e2e.json
```

Use an approved short spoken recording, mono PCM16 WAV at 16000Hz, at most nine seconds. Convert on either Windows machine with Python (if the backend has no Python, convert on the physical PC and securely copy only the PCM file):

```powershell
python gateway\prepare_audio.py C:\TestAudio\question.wav C:\TestAudio\question.pcm
node gateway\e2e.cjs .env.agent-e2e.json C:\TestAudio\question.pcm C:\TestAudio\reply.pcm
node gateway\e2e.cjs .env.agent-e2e.json C:\TestAudio\question.pcm C:\TestAudio\cancel-unused.pcm --cancel
```

On the physical PC, use `C:\Shahvex-AI\.venv\Scripts\python.exe` instead of `python`. The output path must not already exist; audio is caller-sensitive and is written only for the normal test. Edit the private JSON to match the selected authorized website agent's display name, script and campaign and the single tested default voice ID. No customer leads or real calls are used.

Expected normal report: `passed:true`, `authenticated:true`, `cleanup:true`, nonzero `bytes`. Cancellation report: `cancelled:true`, `cleanup:true`; no output file is written. The runner verifies unauthenticated health is rejected, authenticates the service token, creates one isolated session, submits PCM, receives Whisper → Ollama → Chatterbox output, deletes the session in `finally`, and verifies the expired session token is rejected. It fails on turn errors, absent output or a 120-second absolute deadline (plus a 30-second socket idle timeout). A cleanup failure makes the command fail rather than claiming success. Gateway idle expiry provides a fallback if the tunnel disappears during cleanup.

Returned `reply.pcm` is mono PCM16 LE at 16kHz; audition using a trusted local player configured for that format. Cancellation verifies transport termination/cleanup, not GPU kernel preemption. Existing streaming tests additionally verify VAD barge-in discards stale generations/history. Look at gateway NDJSON stage logs for queue/STT/LLM/TTS latency; logs omit tokens, script and audio. `engineHealthReady` may be false if the supplied Chatterbox health response differs from its unconfirmed schema; do not edit health to blindly accept HTTP 200.

## 5. Development verification (no physical server)

```powershell
node --test tests/*.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Mocks test the runner, bad authentication, scoped sessions, cleanup, cancellation and stalled-stream deadlines. Physical inference, encrypted tunnel connectivity and audible voice quality must still be verified by the operator using steps above. No UI/database writes, real calls, VICIdial activation or capacity claims are part of this test.
