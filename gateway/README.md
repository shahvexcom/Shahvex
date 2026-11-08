# Shahvex AI local gateway

**Updated physical-engine contract:** see [physical bridge deployment](../docs/physical-engine-bridge.md) and `physical-engine.example.json`. The confirmed setup now supports streaming Ollama NDJSON and Chatterbox mono PCM16 WAV at its header sample rate, plus a separate Python Whisper wrapper. The generic raw-PCM fixture contract below remains available for simulation. Engine inference and the SSH tunnel have not been tested against the physical server.

This process runs independently from the website and existing physical-server engine. It does not configure or load Whisper, Ollama, Chatterbox, GPU settings, or the existing barge-in implementation. It has no phone provider client. VICIdial stays behind `lib/telephony/adapter.ts`; no real calls are made by this gateway.

## Verified locally

Authenticated loopback HTTP, scoped per-call tokens, isolated bounded histories, dynamic agent name/script/campaign/verified voice, session limits and five-minute idle expiry, PCM framing, energy VAD, streamed PCM output, cancellation during synthesis/playback, generation-tagged audio, transfer allowlists, service health and stage timings. Synthetic integration tests start disposable HTTP STT/Ollama/TTS fixtures on random loopback ports, send streaming audio, interrupt the first reply, and verify stale audio/history does not leak into the next turn. Fixture voices are not installed-model claims. The test does not play through a speaker or measure real model inference latency.

The current local machine had no listeners detected at engine ports 11434/8765 and no physical-engine source in this workspace. Live inference is **not verified**. Supply the actual engine location, endpoint schemas/auth, audio formats and tested voice IDs before connecting it. No 100-call support is claimed; admission defaults to one session and one inference worker.

## Exact PowerShell verification commands

From `P:\shahvex`, using the existing dependencies (no installs/build scripts):

```powershell
node --test tests/gateway*.test.cjs
node --test tests/*.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

To run only the full local bidirectional streaming simulation:

```powershell
node --test --test-name-pattern="local simulated bidirectional" tests/gateway-integration.test.cjs
```

To run the standalone gateway, generate a process-scoped secret without printing it:

```powershell
$env:SHAHVEX_GATEWAY_TOKEN = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:SHAHVEX_GATEWAY_PORT = '8787'
$env:SHAHVEX_MAX_SESSIONS = '1'
node gateway/server.cjs
```

Use a second terminal with the **same token provisioned privately** (never put it in a URL). Alternatively start the server in a PowerShell job that inherits an explicitly supplied token, then query from the originating shell. `/health` requires the service token:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health -Headers @{ Authorization = "Bearer $env:SHAHVEX_GATEWAY_TOKEN" }
```

`live:true` means the gateway responds. `ready:false` is expected until the engine contracts, verified voice inventory and health checks are configured. `telephonyReady:false` and `activeCallCapacityVerified:false` remain explicit. The service checks Ollama `/api/tags` for `shahvex-natural` (or its `:latest` tag) and configured bridge health URLs for JSON `{ "ready": true }`. Reachability is not a performance or voice-quality test.

## Local engine contracts

Ollama uses [the official `/api/chat` API](https://docs.ollama.com/api/chat) with model `shahvex-natural`, isolated `messages`, and `stream:false`. Only TTS audio streams in this version; LLM tokens and STT partial hypotheses do not stream. No model options are overwritten.

Whisper and Chatterbox have deployment-specific wrappers. Do not guess their paths. The gateway supports the following **bridge contract**, tested with local fixtures. Use it only if your existing wrapper implements it, or add a separate bridge without modifying your working engine:

```json
{
  "ollamaUrl": "http://127.0.0.1:11434",
  "stt": {
    "protocol": "pcm16-json-text",
    "url": "http://127.0.0.1:YOUR_STT_PORT/CONFIRMED_PATH",
    "healthUrl": "http://127.0.0.1:YOUR_STT_PORT/CONFIRMED_HEALTH_PATH"
  },
  "tts": {
    "protocol": "json-pcm16",
    "url": "http://127.0.0.1:8765/CONFIRMED_PATH",
    "healthUrl": "http://127.0.0.1:8765/CONFIRMED_HEALTH_PATH",
    "sampleRate": 16000
  },
  "voices": [{ "id": "ACTUALLY_TESTED_VOICE_ID", "verified": true }]
}
```

This illustrative JSON is not runnable until placeholders are replaced. STT receives POST raw signed PCM16 LE mono 16kHz with `Content-Type: audio/pcm;rate=16000;channels=1`, responds JSON `{ "text": "..." }`. TTS receives POST JSON `{ "text": "...", "voice": "..." }`, returns a streaming `audio/pcm` body at its configured 8/16kHz rate. WAV/compressed audio is rejected, not silently interpreted as PCM. Each bridge may specify a private `token` field for Bearer authentication. Endpoints must be loopback HTTP, redirects are rejected, responses bounded, and requests timeout/abort. For a remote physical server, run the gateway alongside it or use an approved loopback tunnel; model ports must not be exposed publicly.

Copy the safe example to an ignored local file such as `.env.engine-contract.json`, configure it after confirming the protocols, and set `$env:SHAHVEX_ENGINE_CONTRACT` to that absolute file path before launching. `.env` files are not automatically loaded by this standalone process. A verified voice entry is an operator attestation after a real synthesis/playback test, not a discovery mechanism.

## Per-call protocol

The gateway token is for a trusted server-side caller, never a browser. POST `/sessions` with Bearer service token and JSON containing `agentName`, `script`, `campaignId`, `voiceId`, and `direction` (`inbound`/`outbound`). Returns `id`, random `sessionToken`, expiry and audio format. The token is returned only on creation and omitted from logs. The trusted website integration must enforce its existing roles, BPO ownership and campaign assignment before creating sessions; this local endpoint does not replace website RBAC and is not wired into the UI.

POST `/sessions/{id}/stream` with that call's Bearer token and exact `Content-Type: audio/pcm;rate=16000;channels=1`. Upload raw PCM incrementally; input is assembled into 640-byte (20ms) frames. Responses arrive concurrently as newline-delimited JSON:

- `speech-start`, `clear` (with generation) and `cancelled` mark interruption.
- `audio` contains `generation`, `sampleRate:16000`, and base64 `pcm`.
- `turn-end` marks completed synthesis; `turn-error` reports a failed stage without exposing caller content.

The receiving playback client **must discard queued older generations on `clear`**. Already transmitted audio cannot be retracted by HTTP cancellation. A client that does not honor `clear` cannot provide correct audible barge-in. The server permits one attached stream per session, bounds unfinished turns and output backpressure, and aborts on disconnect. DELETE `/sessions/{id}` with its scoped token closes it. Cross-call tokens and service tokens on scoped routes are rejected.

The simulation VAD uses RMS energy >=500 and 10 silent frames to finalize speech; utterances are limited to under ten seconds. It is a deterministic local test VAD, not a replacement for your engine's tuned detector. PCM conversion supports only negotiated 8/16kHz mono; 16-to-8kHz uses pair averaging, 8-to-16kHz repeats samples. Production telephony resampling/codecs remain gated on the actual media contract.

Logs are NDJSON with timestamps, session IDs, stage timings, output byte counts and lifecycle categories. No token, audio, script or transcript is logged. Histories are memory-only, limited to 20 turns and destroyed on close/expiry; recordings/report persistence is not implemented here. Queues are process-local and hold a worker until cancellation is acknowledged, preserving the concurrency limit even if a backend is slow to abort.

## Remaining gates

Confirm live STT/TTS contracts and voice inventory, test actual audio playback and existing engine cancellation, implement website role-authorized session creation, and provide VICIdial version/media/control credentials. Durable call event/result storage, regulated campaign approval/enforcement, production VAD, resampling, crash recovery and distributed GPU scheduling remain separate production work. Script prompts and configuration validation do not constitute a compliance certification.

See [security review](../docs/security-review.md) and [migration plan](../docs/telephony-migration.md). Legacy provider source/database fields are retained for safe data migration, but the new gateway imports none of it. Existing website calling routes have not been certified or connected to this gateway.
