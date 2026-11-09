# Private shared agent testing

## Verified deployment inventory — 2026-11-09

`curl.exe -I -L https://www.shahvex.com` returned HTTP 200, `Server: Vercel`,
`X-Powered-By: Next.js`, and `X-Vercel-Id`. The existing live website is on Vercel.
The external web browsing tool could not open the website; the HTTPS header check
succeeded through the network-enabled executor. This verifies the existing home
page only. No updated public demo URL has been deployed or externally tested.

The checkout's configured site URL is localhost. No Vercel project linkage,
cloudflared executable, tunnel credentials, or working physical AI listeners were
found in this workspace. The GitHub connector returned 404 for this checkout's
commit status. No DNS records, live secrets, services or production database
records were changed by implementation. Database/schema work below remains to be
verified against the deployment database.

## Architecture

Keep the current Vercel project, domain, Admin panel, Test Agent button, and Next.js
design. The new page is `/test/agent/[token]`; link controls are in each existing agent row?s action menu in
Admin > Agents. This reuses `AgentTestPanel`, `BrowserSpeechCapture`, PCM player,
the mixed microphone/playback recorder, and the existing streamed turn handler.
Public mode does not render configuration editing or call extraction/preview APIs.

The public browser uses only its current HTTPS website origin. Vercel forwards
`/api/demo/agent/[token]` to a persistent production copy of this same Next app
on the physical AI machine, through Cloudflare Access + Tunnel. Only that copy
calls its loopback Ollama/STT/TTS services. Do not tunnel those service ports.
This keeps existing conversation memory and cancellation on one persistent Node
process instead of spreading them across Vercel invocations. The demo bridge does
not change the existing Admin Agent Tester's service routing.

Both copies use the same production PostgreSQL database. Additive tables initialize
on first demo/admin-link access: `agent_demo_links`, `agent_demo_sessions`, and
`agent_demo_rate`. The existing app schema initializes first. The deployment DB
identity needs CREATE TABLE/INDEX rights, or a DBA must preapply the DDL in
`lib/agent-demo.ts`. Review existing application's schema initialization before
first use against a new DB. No Prisma migration is required by this pg-based app.

Tokens are 32 cryptographically random bytes (256 bits); only SHA-256 hashes are
stored. Copy the generated link before leaving the panel. Reloading never reveals
the original token; regenerate if the operator loses it. Links require an existing
`admin_agent_owners` entry with `verified=TRUE`, the creating ADMIN owner, and a
regular agent. Legacy agents without verified ownership cannot be shared until
ownership is independently verified and recorded through the existing ownership
administration process. Do not bulk-assign legacy agents to the current admin.

## Deploy the physical backend first

1. Obtain the existing physical machine's deployment method and Cloudflare zone
   access. Confirm its saved voices and services match the EXISTING Admin Agent
   Tester contract: Ollama 11434 (`/api/chat`), transcription 8766 (`/transcribe`),
   and CosyVoice 8767 (`/voices`, `/health`, `/synthesize`, `/stream`). Older gateway
   installations using Whisper 8788/Chatterbox 8765 are a different contract; do
   not expose them or silently substitute a voice/model. This must be reconciled
   on the real machine before a client GO.
2. Deploy this checkout to the existing production app directory on that machine.
   Use the same production DATABASE_URL/DIRECT_URL, stable AUTH_SECRET and
   CREDENTIAL_ENCRYPTION_KEY, and the applicable existing voice-registry secrets.
   Provision a new random 32+ byte `SHAHVEX_DEMO_BRIDGE_SECRET` through the secret
   store, and put the identical value in Vercel later. Do not print it or commit it.
3. On the physical copy UNSET `SHAHVEX_DEMO_BACKEND_URL`,
   `SHAHVEX_CF_ACCESS_CLIENT_ID`, `SHAHVEX_CF_ACCESS_CLIENT_SECRET`, and `VERCEL`.
   Set `SHAHVEX_DEMO_MAX_CONCURRENT=1`. Keep all model listeners on loopback.
4. From the app directory run:

   ```powershell
   npm ci
   npm run build
   npm run start -- --hostname 127.0.0.1 --port 3000
   ```

   Configure that exact start command in the existing Windows service manager
   with automatic restart, service-account environment and working directory.
   Use one Node process, one persistent backend replica, no cluster load balancing.
   Check port 3000 first and schedule a cutover if the existing production instance
   already owns it. Do not terminate an active session or publish `next dev`.
5. In Cloudflare Zero Trust create a self-hosted Access application covering
   **all paths** of `demo-engine.shahvex.com`. Add only a Service Auth policy
   selecting a dedicated service token. No Bypass/Everyone policy. Save its client
   ID and client secret directly to Vercel secrets. The bridge also requires the
   independent `SHAHVEX_DEMO_BRIDGE_SECRET` at the application layer.
6. Install/use the organization's supported cloudflared version. With authorized
   Cloudflare access, create a named tunnel (or reuse the approved existing one):

   ```powershell
   cloudflared tunnel login
   cloudflared tunnel create shahvex-demo
   cloudflared tunnel route dns shahvex-demo demo-engine.shahvex.com
   ```

   This creates a proxied CNAME `demo-engine.shahvex.com` to
   `<TUNNEL_UUID>.cfargotunnel.com`. Keep `www.shahvex.com` and apex DNS pointing
   at their current Vercel deployment. No public raw-service A records or inbound
   port-forwarding rules are needed.
7. Adapt `deployment/agent-demo-tunnel.example.yml` with the returned UUID and
   the private credential file path. Store it in the existing cloudflared service's
   configuration location. Validate before applying:

   ```powershell
   cloudflared tunnel --config C:/ProgramData/Shahvex/cloudflared/config.yml ingress validate
   cloudflared tunnel --config C:/ProgramData/Shahvex/cloudflared/config.yml run shahvex-demo
   ```

   Have the existing service manager run this on boot. Its only accepted ingress
   path is the demo API; every other path, including admin and auth APIs, returns
   404. The website itself remains on Vercel. Preserve Access protection across
   tunnel reconnects; restrict credential-file access to the service identity.

## Update the existing Vercel project

In its Production environment configure (all server-side):

```text
NEXT_PUBLIC_SITE_URL=https://www.shahvex.com
SHAHVEX_DEMO_BACKEND_URL=https://demo-engine.shahvex.com
SHAHVEX_DEMO_BRIDGE_SECRET=<same secret as physical backend>
SHAHVEX_CF_ACCESS_CLIENT_ID=<Cloudflare service token client ID>
SHAHVEX_CF_ACCESS_CLIENT_SECRET=<Cloudflare service token secret>
```

Keep the existing DB and other service secrets. Deploy the reviewed commit through
the existing project's Git integration or its authorized `vercel --prod` workflow;
do not create a new Vercel project. Confirm the project permits the route's
`maxDuration=300` (enable Fluid compute where required). Test in staging first with
the appropriate DB, origin, Access policy and backend; never mix customer histories.

The bridge has a 240-second deadline and streams NDJSON/PCM without buffering the
response. The physical request is bounded to 110 seconds and each microphone upload
to 2,000,000 bytes. Recordings remain browser-local and bypass function uploads.
These stay below Vercel's documented 4.5 MB request limit. Long PCM output uses
streaming, so confirm streaming is enabled and no intermediary buffers responses.
Cloudflare's time-to-first-response limits also apply; initial voice warmup/script
extraction must complete within the physical deadline. A timeout is an error,
never a synthetic successful conversation.

References: [Vercel limits](https://vercel.com/docs/functions/limitations),
[Vercel streaming](https://vercel.com/docs/functions/streaming-functions),
[Cloudflare tunnel configuration](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/),
[Cloudflare service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

## Security and operating limits

- Default expiry 24 hours, configurable 1–168 hours; default 10 session starts,
  configurable 1–1000. Starts consume allowance even when a voice service fails.
- Database transaction/advisory lock admits at most the configured global demo
  concurrency (default 1). Session lifetime is fixed at 15 minutes or link expiry,
  whichever is sooner. A crashed backend loses memory and requires a fresh session;
  its lease can occupy capacity until expiry. Do not clear leases for running calls.
- 120 requests/minute per valid link, 90/minute per active session. This is shared
  across app instances. Configure edge IP rate limiting for the page/API to handle
  invalid-token floods before they reach DB. Tokens must be treated as bearer
  credentials; anyone with the link may use its limited allowance.
- Revoke/regenerate ends database leases immediately. Physical watchdog checks
  every 2 seconds and aborts inference; browser checks every 5 seconds and stops
  capture/playback. Already delivered audio cannot be recalled. Revoked or expired
  links are refused on each subsequent request.
- No admin cookie is issued for demos. Backend forwarding excludes user cookies,
  caller authorization and caller-provided service credentials. Configuration comes
  exclusively from the assigned agent and latest saved script assignment.
- Consent checkbox is required before microphone capture and before allocation;
  consent timestamp/version are recorded. Audio is sent to STT for the conversation;
  the mixed two-sided downloadable recording remains in browser memory. Transcript
  memory is per session on the persistent backend, not shared between customers.
- Keep URL paths out of analytics, support screenshots and proxy access logs: they
  contain bearer tokens. Page/API responses are no-store/noindex/no-referrer.
- Schedule retention cleanup for ended/expired session audit rows and revoked links
  under the existing data-retention policy. No conversation/audio is stored in these
  tables. Rate rows contain hashes; prune obsolete rows as part of that policy.
- Avoid concurrent admin/other voice tests during the initial single-demo rollout;
  this demo admission limit does not replace other existing AI workloads' admission.

If deliberately moving the entire existing website to self-hosting later, serve
this same production Next build through its existing authenticated website tunnel,
leave all four demo bridge variables unset, keep admin authentication enabled,
and point the actual website hostname to that tunnel only after an approved cutover.
That is an alternative deployment, not a change made here.

## Required external acceptance — pending

Use another device on cellular or another independent network and the actual
`https://www.shahvex.com/test/agent/<generated token>` URL. A successful home-page
header check is not this acceptance test.

1. In authenticated Admin > Agents, generate a link for a verified-owned agent.
   Confirm status, expiry, usage and active-session count, then copy the URL.
2. Open it without any admin cookie. Verify only the assigned name/avatar and
   conversation controls; configuration editing and admin access are unavailable.
3. Confirm Start is disabled until consent. Allow microphone; check saved voice,
   script, goals, accent, style and AI/customer-first behavior by listening to a
   real conversation. No customer messages should appear without actual speech.
4. Ask a follow-up and verify memory. Confirm the introduction occurs once.
   Observe Listening/Thinking/Speaking against actual capture/playback.
5. Interrupt audible playback. Confirm stale audio stops and the next real speech
   is transcribed once. Measure behavior on the production network.
6. End Session. Confirm microphone indicator stops, active count drains, recording
   finalizes and Download Recording contains both voices and the interruption.
7. Try an invalid token, expired link, exhausted link, revoked link and a session
   handle with another agent's token. Confirm failure and no leaked configuration.
   Revoke during playback and confirm watchdog/poll cleanup.
8. Try concurrent starts beyond the configured capacity. Confirm 429 and no extra
   inference. Check actual PostgreSQL constraints/transactions under concurrency.
9. Check Network: browser requests remain same-origin HTTPS; no localhost, raw model
   ports, tunnel service credentials, saved scripts or private knowledge payloads.
10. Confirm `/controler` still redirects anonymous visitors to login, the old Test
    Agent button remains, and tunnel requests outside the demo path are rejected.

Record device/browser, network, time, result and actual downloaded recording for
each acceptance case. Do not call this deployed/client-ready until these pass.

## Local validation and changed files

- Production `npm run build` passes, including TypeScript and both new route types.
- Targeted tests: 28 total, 26 pass, 2 live-AI tests skipped. New demo tests use
  mocked services/database, not a claim of live PostgreSQL or physical AI acceptance.
- Full `npm test`: 201 total, 193 pass, 7 skipped, 1 failure. The failure is the
  pre-existing quarantined-file evidence hash mismatch in
  `tests/gateway-integration.test.cjs`. `backups/security/postcss.quarantined.txt`
  hashes to `BAE2B99C…` both in HEAD and in the workspace; the recorded manifest
  expects `9DB661CE…`. Evidence files were not changed to make the test pass.
- Production-server HTTP smoke checks passed: invalid demo page/API return 404,
  both admin APIs return 401 without authentication, `/controler` redirects to
  `/controler/login`, and demo responses contain no-referrer/noindex headers.
- `git diff --check` passes. The temporary local production server was stopped.

Changed/new implementation files:

```text
.env.example
next.config.ts
lib/agent-demo.ts
lib/agent-test.ts
lib/agent-test-session.ts
app/api/admin/agent-demo-links/route.ts
app/api/admin/agent-test/route.ts
app/api/demo/agent/[token]/route.ts
app/test/agent/[token]/page.tsx
app/components/agent-demo-links.tsx
app/components/agent-demo-links.css
app/components/agent-test-panel.tsx
app/components/admin-control-center.tsx
tests/agent-demo.test.cjs
tests/agent-test.test.cjs
tests/agent-test-input.test.cjs
deployment/agent-demo-tunnel.example.yml
docs/private-agent-test-links.md
```

Deployment blockers: authenticated access to the existing Vercel project,
physical machine and Cloudflare zone/tunnel; provisioned server-side secrets;
confirmed physical voice-service contract and verified agent ownership; real DB
integration verification; external browser/microphone/audio/recording acceptance.
