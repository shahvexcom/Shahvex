# AI-only adapter deployment

Website, authentication, database and saved configuration stay on Vercel. One Windows Node adapter on loopback 8774 imports only the existing tester/config/audio/stream modules. It does not start Next.js or connect to the database. Existing engines remain in Ubuntu/WSL on 11434, 8766 and 8767.

## Current topology

Vercel -> Cloudflare Access/Tunnel -> Windows Node 127.0.0.1:8774 -> WSL engines.

The original gateway on 8768 remains unchanged. The initially staged Python proxy/8775 split was removed after a real HTTP test found WSL could not reach the Windows tester through loopback. One Node adapter resolves that boundary without opening a network-facing port or installing dependencies.

## Local operation

Run deployment/Start-PcAiAdapter.ps1 -Action Start or -Action Status from PowerShell. Start provisions a random key once in .data/pc-ai/.env.pc-ai with Windows ACLs for the current user, SYSTEM and Administrators. That directory is Git-ignored. Never print the key or paste it into chat. The launcher reuses the key, checks for an authenticated existing instance and starts a hidden Node process with protected logs. It does not restart engines or tunnel services. Automatic startup/recovery registration is pending.

Use one process; no clustering or replicas. Existing Node/TypeScript dependencies are required. SHAHVEX_PC_AI_URL stays empty on the PC to prevent recursion. Capacity defaults to one session; idle expiry is 30 minutes. Restart loses active sessions.

## Cloudflare routing required (not applied)

Add these path-specific routes on ai.shahvex.com BEFORE the existing catch-all:

| Path regex | Service |
| --- | --- |
| /engine/.* | http://127.0.0.1:8774 |
| /tester/.* | http://127.0.0.1:8774 |
| existing catch-all | existing http://127.0.0.1:8768 |

Cloudflare Access Service Auth must cover the new paths. Preserve all old routes and Access protection. Do not tunnel raw model ports.

## Vercel activation required (not applied)

After authenticated external route verification, set server-side variables in the existing project:

- SHAHVEX_PC_AI_URL=https://ai.shahvex.com
- SHAHVEX_PC_AI_SECRET: same key as protected PC configuration
- SHAHVEX_CF_CLIENT_ID: Access service token ID
- SHAHVEX_CF_CLIENT_SECRET: Access service token secret

Deploy reviewed code; preserve DB/auth/encryption secrets. The project must support the route's maxDuration=300. Admin authenticates and validates saved agent/config/voice on Vercel; only inference and session memory move to the PC. The PC authenticates the service key and session owner. User cookies and arbitrary credentials are never forwarded.

## Validation and remaining work

### TTS interruption recovery

Repeated live interruptions exposed an installed CosyVoice synchronous generator holding `threading.RLock` across PCM yields. Starlette drives synchronous iterators through a thread pool; cancellation/thread changes can leave that ownership unresolved. `deployment/cosyvoice_safe_api.py` wraps only `/stream` with `tts_stream_worker.py`: a dedicated thread owns and exhausts each inference iterator, even after HTTP disconnect, discarding stale output through a bounded queue. Original source, voice references and model weights are preserved. The wrapper keeps the existing lifespan/health/voices/synthesize routes.

The installed startup also attempted auxiliary normalization downloads. The wrapper restricts that tokenizer lookup to local cache; missing resources use the original frontend's existing fallback. No replacement model is provisioned. `Apply-CosyVoiceWrapper.py` verifies the exact PID/module/8767 before replacing it and saves the original command (without environment) for rollback in the protected local directory. Rollback uses that script with the current wrapper PID and `--rollback`. Automatic startup must use the wrapper rather than the old direct module.

Recovery validation: `python tests/tts_stream_worker_test.py` passed 30 cancelled lock-owning streams and a subsequent full synthesis. `SHAHVEX_LIVE_PC_SOAK=1 node tests/pc-ai-interruption-soak.cjs` passed a 192-second real-engine session: 16 turns, 11 cancellations after actual PCM and 5 completed replies; each interrupt acknowledged cleanup and subsequent turns were admitted without BUSY stalls. Authenticated Cloudflare engine health remained 200 and the tester route remained reachable. This is not a physical browser/microphone soak; user browser retest remains required.

Authenticated external verification on 2026-11-10: Cloudflare engine health returned HTTP 200; the tester stop route reached the new adapter and correctly rejected a nonexistent session. The production Next.js build passed. The user configured the two path routes ahead of the original 8768 catch-all and provisioned PC URL/key variables in Vercel. Vercel deployment/browser acceptance are still pending.

Passed: TypeScript and targeted security/regression checks (17 passed, 3 skipped); separate real tester PCM check; full real HTTP adapter chain for voice inventory, anonymous denial, preview WAV, resampled WAV STT, Ollama, streamed PCM, follow-up and interrupt/stop endpoints. Automated tests cover in-flight cancellation, ownership, capacity and duplicate turns. HTTP input was synthesized speech, not a physical microphone. Cloudflare and audible browser playback are not verified.

Pending: Cloudflare routing/Access, Vercel deployment, Admin/BPO browser microphone/playback/recording, demo lease integration, telephone media, automatic startup/recovery and external acceptance. Shared engine transport covers BPO voice discovery/preview but does not certify all BPO testing/calling.

Rollback: unset SHAHVEX_PC_AI_URL and redeploy restores localhost behavior, which requires local engines and is not a working Vercel AI connection. Preserve original 8768 and all models throughout rollout.
