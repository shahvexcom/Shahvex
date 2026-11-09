# PC AI / Vercel rollout inventory

Read-only inventory performed 2026-11-10. Application code and running services were not changed.

## Deployment boundary

Vercel retains the website, authentication, authorization, agent CRUD, database access and saved configuration. The PC runs AI inference, an authenticated AI gateway and temporary conversation state. Do not deploy another full website backend to the PC for this rollout.

## Observed on this PC

- Ollama `http://127.0.0.1:11434/api/tags`: HTTP 200.
- STT `http://127.0.0.1:8766/health`: HTTP 200.
- CosyVoice `http://127.0.0.1:8767/health`: HTTP 200.
- Gateway `http://127.0.0.1:8787/health`: request timed out; readiness not established.
- Windows service `Cloudflared`: Running, Automatic.
- cloudflared and ollama executables were not found on the current shell PATH. This does not establish that they are absent.
- Windows service configuration inspection via CIM was denied. Existing tunnel hostname, executable path and service command have not been established. Never print its command line without redacting tokens.
- Old `deployment/Manage-ShahvexLocal.ps1` targets `P:\shahvex` and `C:\Shahvex-AI`, and starts Next in development mode. Do not execute it as this machine's production installer.

HTTP health proves reachability only, not actual speech recognition, audible synthesis or calling.

## Route findings

- `lib/agent-test.ts` calls loopback services directly. Admin tester uses in-process sessions; forwarding raw model requests alone will not make that session model reliable on Vercel.
- Script extraction uses Ollama through that same helper.
- BPO voice preview also uses the helper and enforces the approved BPO session.
- Admin local voice management uses CosyVoice and STT, plus the hosted voice registry/database. Preserve these authorization and database operations on Vercel.
- The demo bridge currently expects a persistent copy of the Next app on the PC. That is a different topology and must be adapted for the AI-only gateway.
- Existing `gateway/backend-client.cjs` accepts local URLs and uses Node HTTP streaming; it cannot simply be pointed at an HTTPS Cloudflare hostname.
- The older local voice relay contains process-local state and explicit hosted-environment restrictions. Do not remove those guards as a shortcut.
- Admin/BPO call routes contain Telnyx integration. `lib/telephony/adapter.ts` is a VICIdial interface, not evidence of an implemented media connection. Identify the actual call/media path before changing it or claiming local AI handles calls.

## Implementation sequence

Latest topology supersedes the staged Python/8775 split below: one Windows Node adapter on 8774 now handles allowlisted engine operations and persistent tester sessions. Real HTTP verification exposed WSL-to-Windows loopback failure in the split topology; unused Python adapter/test were removed. The Node HTTP chain passed real voice inventory, preview WAV, STT, Ollama, PCM, follow-up and stop checks. The protected hidden launcher is `deployment/Start-PcAiAdapter.ps1`. Current deployment instructions are in `docs/pc-ai-adapter-deployment.md`. Tunnel/Vercel activation and automatic startup remain pending.

Follow-up implementation: `gateway/tester-service.cjs` reuses the existing TypeScript tester as a standalone AI-only process with owner-isolated persistent sessions and bounded capacity. Admin start/turn/interrupt/stop now opt into this service when the PC transport is configured. The Python adapter forwards only these closed tester actions to loopback 8775. See `docs/pc-ai-adapter-deployment.md` for the exact staged topology and remaining gates. Current checks: 17 pass / 3 skipped in the targeted suite; the opt-in real Node tester/Ollama/CosyVoice PCM check also passed separately; Python adapter checks and TypeScript passed. No production environment, tunnel route, running engine or startup task was changed.

First staged implementation: `deployment/pc_ai_adapter.py` provides authenticated, allowlisted, streaming AI-only operations on a proposed unused port 8774. `lib/pc-ai-engine.ts` adds opt-in HTTPS/Access transport; `engine()` retains loopback by default. No environment values, tunnel destinations or running services were changed. This is NOT the complete deployment: persistent session orchestration, admission, full adapter integration tests and end-to-end cancellation must be implemented before enabling the flag in Vercel. The adapter has only a Python syntax check so far; transport security and existing Admin/BPO regression tests passed (9 passed, 2 live tests skipped), and TypeScript checking passed. Keep existing 8768 routes intact when adding any future tunnel routing; do not redirect the whole hostname to 8774.

1. Establish current AI launch commands, working directories, Windows identities and existing tunnel hostname/configuration without restarting anything.
2. Implement an AI-only gateway compatible with the current Ollama/STT/CosyVoice contract. Allowlist operations, authenticate every request, bound inputs, preserve cancellation/streaming, isolate sessions and enforce capacity.
3. Keep ownership checks and registry/database operations on Vercel. Add server-side HTTPS gateway transport with Cloudflare Access credentials and separate application authentication. Preserve the default localhost flow.
4. Route voice inventory/preview and extraction, then session start/turn/interrupt/stop to the gateway. Keep persistent conversation state on the PC; never depend on a particular Vercel function instance.
5. Verify local regression tests and real speech/audio first; then verify Admin and BPO flows on the deployed HTTPS origin.
6. Identify and implement the actual telephone audio integration separately; validate with an explicitly authorized real call.
7. Install automatic startup/restart using the confirmed engine environments and existing tunnel service. Do not register competing launchers or restart active sessions.

## Remaining inputs

### Follow-up inventory

User reports Cloudflare tunnel Healthy and routed to port 8768. Read-only checks confirm 8768 runs `gateway.services.shahvex_gateway:app`, with ready health, dynamic agents, voice selection, streaming and memory. Its OpenAPI exposes health, session get/delete, conversation and conversation/stream. Port 8773 instead runs `gateway.services.phrase_gateway_step90:app`, reports experiment `accuracy-first-stream`, and exposes conversation/phrases. It is not a drop-in tunnel target for 8768. Preserve the current tunnel destination. Neither schema exposes independent voice inventory/preview or the original tester extraction/start/interrupt contract. The original Admin tester still directly orchestrates ports 8766/8767/11434; a running 8773 experiment does not establish that the UI uses it.

User confirmed the intended tunnel hostname is `ai.shahvex.com` and AI runs in Ubuntu on this PC. Elevated read-only inspection identified WSL distribution `Ubuntu-24.04`, user `nazeer_ahmed`, and `/home/nazeer_ahmed/shahvex-ai`. Ubuntu has loopback listeners on 8766 (STT), 8767 (TTS), and 11434 (Ollama). Ollama is a running system service. STT/TTS were not listed among running system services; inspect their actual launch configuration before installing startup units. A Windows HTTPS probe of the hostname failed to connect; external tunnel reachability and Access policy remain unverified.

Existing Cloudflare tunnel hostname/configuration and account access; existing Vercel project access; actual engine launch locations/commands; confirmed active calling provider and media contract. Supply credentials only through protected local configuration or provider dashboards.
