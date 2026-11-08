# Physical Windows engine bridge

For the complete single-agent backend rehearsal, secret setup, SSH restrictions, prerecorded audio conversion and cancellation commands, follow [website-physical-e2e.md](website-physical-e2e.md).

Run the gateway alongside the existing engine on the Windows 11 physical PC. Engine source stays in `C:\Shahvex-AI`; do not edit `handsfree_chatterbox_step83.py` or `chatterbox-testing\chatterbox_voice_server.py`. Copy only the reviewed `gateway` directory to `C:\Shahvex-AI\integration-gateway`. Node 20.19+ is required. No npm packages are needed by this directory.

The gateway talks locally to existing Ollama `/api/chat` using streaming NDJSON and Chatterbox `/synthesize` using **only** `{ "text": "..." }`. It parses mono PCM16 WAV chunks, reads the native rate from the WAV header, and resamples to 16kHz before sending 20ms PCM chunks. Because the service returns WAV, audio is buffered up to a bounded 4MB before conversion; this is not a claim of native streaming Chatterbox synthesis. Cancellation aborts HTTP and rejects stale results; Python/GPU computation already in progress may finish on the server.

Whisper is a separate loopback HTTP wrapper using the existing `faster-whisper` installation/cache, `base.en`, CPU INT8. No model downloads, package installation, or engine script imports occur. If the existing cache is unavailable, configure `SHAHVEX_WHISPER_MODEL_PATH` to the existing model directory. The wrapper has a single admission lock; aborting an HTTP request does not preempt an in-progress native Whisper inference.

## Physical PC setup (operator executed, not run in development)

Generate two distinct random 32+ character secrets using a private secret manager: `SHAHVEX_GATEWAY_TOKEN` and `SHAHVEX_WHISPER_TOKEN`. Provision those process variables privately. Do not paste them into Git or URLs.

In a physical-PC PowerShell terminal:

```powershell
Set-Location C:\Shahvex-AI
.\.venv\Scripts\python.exe .\integration-gateway\whisper_bridge.py
```

Keep existing Ollama and Chatterbox services running with their working configuration. In another terminal, copy `physical-engine.example.json` to an ignored private file, replace its STT token with `SHAHVEX_WHISPER_TOKEN`, and attest the default voice only after actual synthesis/playback. The example default profile represents the existing Chatterbox voice; arbitrary male/accent profiles are not selectable or sent to `/synthesize`.

```powershell
$env:SHAHVEX_ENGINE_CONTRACT = 'C:\Shahvex-AI\integration-gateway\.env.engine-contract.json'
$env:SHAHVEX_MAX_SESSIONS = '1'
node C:\Shahvex-AI\integration-gateway\server.cjs
```

Chatterbox `/health` schema is not yet supplied: the gateway requires `ready:true`, so it reports unready if that field is absent. Confirm the actual response before adapting health validation; do not confuse HTTP 200 with verified inference.

## Authenticated encrypted network path

Keep **all** model and gateway listeners on physical-PC loopback. Use a dedicated restricted SSH identity and approved server to establish a reverse tunnel from the physical PC to the website/backend host:

```powershell
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=yes -R 127.0.0.1:18787:127.0.0.1:8787 shahvex-bridge@APPROVED_BACKEND_HOST
```

This is a deployment template, not executed here. Provision and verify the host key beforehand; use key authentication, a dedicated account, `GatewayPorts no`, remote forwarding restricted to `127.0.0.1:18787`, no shell/agent/X11 forwarding, and firewall rules through the server administrator. Do not expose 11434, 8765, 8788, 8787 or 18787 publicly. SSH encrypts/authenticates the network hop; gateway Bearer authentication and scoped per-call tokens still apply inside the tunnel. No public HTTP listener or self-signed certificate bypass is introduced. Restart the tunnel using the operator's approved service manager. A disconnected tunnel fails calls closed; no fallback provider exists in the gateway.

On the backend host use `gateway/backend-client.cjs` with `http://127.0.0.1:18787` and the service token. Its `create`, `stream` and `close` methods provide scoped sessions and a Node full-duplex request/NDJSON response. The website controller must enforce its existing session role, BPO ownership, approved status and campaign assignment **before** calling this trusted client. Never hand the service token to browser code. Website routes/UI are deliberately not wired to this privileged client yet.

## Asterisk media boundary

The current local simulation negotiates 16kHz mono signed PCM16 LE only. A future confirmed adapter must translate the installed transport (e.g. AudioSocket, ARI external media/RTP, or another engineer-supported interface), parse its framing, handle sequence/loss/jitter and byte order, and maintain a resampler per call. `wav.cjs` supports bounded batch linear conversion from native 8–96kHz WAV to 16kHz; it is not a production anti-aliasing streaming telephony resampler. G.711 mu-law/A-law and RTP are **not enabled**. Do not assume Asterisk `slin16`, RTP L16 or raw little-endian bytes share the same wire order.

Confirm VICIdial/Asterisk versions, actual media transport, codec/rate/endianness, dialplan, API auth, correlation IDs, transfer destinations and test tenant before implementing that adapter. The bridge makes no phone calls and does not use any legacy provider SDK. Existing legacy provider records/source are retained solely for safe migration; removal of operational routes remains a separate migration gate.

## Development verification

```powershell
node --test tests/*.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Mocks verify HTTP auth, isolated sessions, PCM/VAD/barge-in cancellation, streaming Ollama fragments, native-rate WAV conversion and the trusted backend client without physical server access. No physical-server deployment, SSH tunnel, microphone playback, real inference, telephony compatibility or 100-call load capacity has been verified here.
