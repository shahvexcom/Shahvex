# Original agent-flow recovery — 2026-11-10 (Asia/Karachi)

## Finding and smallest recovery

The Control Center's global **Test Agent** at repository HEAD `506ff54` did not
use port 8768. It called `/api/admin/agent-test`, which orchestrated Parakeet 8766,
CosyVoice 8767 and Ollama 11434 directly from the website backend. There was no
single upstream gateway base URL for that tester. The same contract is present
in the earlier available commit `ea5cbea`.

The recent integration added two early-return conditions to the existing admin
route: a nonempty `SHAHVEX_API_URL` dispatched GET and POST to
`lib/shahvex-tester.ts`. That bypassed the original implementation. The frontend
then received a `transport: shahvex` marker and selected raw-PCM gateway behavior,
disabled per-session configuration editing and suppressed extraction.

The `.env` currently contains `SHAHVEX_API_URL=https://ai.shahvex.com`. The
read-only production DB inspection found **zero** `shahvex_agent_bindings` rows.
`getShahvexTester` requires such a binding before returning agent metadata, so
the automatic switch blocks those existing agents with a configuration 409.
Its start path also rejects AI-first agents, and its other action handler does
not implement the original extraction/preview/turn API. Even a binding alone
would not make the old functionality equivalent.

Recovery removes **only those two automatic dispatch lines** from the admin
route. The original GET and all original POST actions now run even while
`SHAHVEX_API_URL` remains configured. No URL was guessed or replaced. Cloudflare
`/api/shahvex/*` routes, credentials, Tunnel and Access are retained independently.
The shared `handleTestSession` extraction introduced during earlier demo work
is preserved; it still runs the original STT/Ollama/CosyVoice contract.

No frontend, agent record, saved script, voice registry record, authentication
rule, model configuration, physical service or running process was changed by
this recovery. No physical service was started, stopped or restarted.

## OLD versus NEW and status

| Purpose | Recovered OLD URL/endpoint | NEW integration | Evidence and current verification |
|---|---|---|---|
| Website portal | `http://127.0.0.1:3000/controler`, also documented development alias `http://localhost:3000` | Existing website remains; public origin `https://www.shahvex.com` | README, `docs/admin-agent-testing.md`, `docs/local-backend-connection.md`; local protected APIs currently respond 401 anonymously. Public website voice flow not retested. |
| Admin tester API | `/api/admin/agent-test?agentId=…`; POST `action=extract`, `preview`, `start`, `turn`, `interrupt`, `stop` | Incorrectly switched to remote adapter solely by URL presence | Both available commits' admin route; current regression test proves local config/extraction/preview/AI-first/text/PCM/session behavior with Cloudflare URL set. |
| Conversation generation | `http://127.0.0.1:11434/api/chat` | `https://ai.shahvex.com/conversation` or `/conversation/stream` | `lib/agent-test.ts`, `lib/agent-test-stream.ts`; real local text/voice inference passed. Remote gateway accepts audio multipart, not old JSON text/config. |
| STT | `http://127.0.0.1:8766/transcribe` | Private STT invoked internally by 8768 | Old HEAD admin route; current `lib/agent-test-session.ts`; real synthesized WAV transcribed successfully. `/health` returned 200/ready. |
| Voice list | `http://127.0.0.1:8767/voices` | No corresponding public 8768 route | `lib/agent-test.ts`; HTTP 200, 11 inventory entries, all four DB agent voice IDs currently selectable. |
| Voice preview/warmup | `http://127.0.0.1:8767/synthesize`, `/health` | No independent preview operation in 8768 | Old admin route and `warmSelectedVoice`; actual WAV synthesis passed; health 200/ready. Preview HTTP action also tested with mocks. |
| Streaming | `http://127.0.0.1:8767/stream`, through website NDJSON `/api/admin/agent-test?action=turn` | `https://ai.shahvex.com/conversation/stream` through `/api/shahvex/conversation/stream`, raw PCM | Old `lib/agent-test-stream.ts` and admin route. Actual recovered local pipeline emitted 24 kHz PCM plus transcript/delta/done events. |
| Current separate gateway | Not used by the original global admin tester | `https://ai.shahvex.com` → known tunnel origin `http://127.0.0.1:8768` | `.env`, captured OpenAPI and integration report; local health 200/ready; authenticated public health 200/ready during recovery. |
| Older legacy gateway | `http://127.0.0.1:8787` | Not replaced or reconfigured | `.env.example`, `lib/local-voice-relay.ts`, `gateway/server.cjs`, `deployment/Manage-ShahvexLocal.ps1`; historical, currently unreachable on this machine. |
| SSH/backend bridge | `http://127.0.0.1:18787` → remote 8787 | Not replaced or reconfigured | `gateway/backend-client.cjs`, `gateway/e2e.cjs`, `docs/backend-private-connection.md`; historical default, currently unreachable. |
| Legacy STT/TTS | `http://127.0.0.1:8788/transcribe`; `http://127.0.0.1:8765/synthesize` | Separate from current Parakeet/CosyVoice tester | `gateway/physical-engine.example.json`, legacy deployment/docs; historical, respective health endpoints currently unreachable. |
| Experimental phrase gateway | No original global-tester dependency | `http://127.0.0.1:8769` | Documented experimental port; local health 200/ready. Not selected, changed, inferred public, or tunneled by recovery. |
| Isolated review listener | `http://127.0.0.1:8789` | Not a production replacement | `deployment/Start-VoiceReviewBackend.ps1`; historical review fixture, not tested or selected. |
| New private demo links | No `/test/agent/[token]` in the two historical commits | `/test/agent/[token]` → `/api/demo/agent/[token]`; optional `SHAHVEX_DEMO_BACKEND_URL` | New uncommitted demo work. `demo-engine.shahvex.com` is an example, not confirmed deployed/configured. Demo bridge env vars are absent from `.env`; no existing live link was generated/revoked. |
| WebSocket | No original Shahvex AI WebSocket URL recovered | No WebSocket introduced by this recovery | Original tester uses HTTP NDJSON, audio uploads and Web Audio worklets. Legacy relay uses HTTP POST PCM/NDJSON. Third-party telephony SDK transport is separate and was not changed. |
| LAN address | No concrete AI LAN gateway address recovered | None substituted | Relevant workspace/history URL inventory and DB connection inspection found no configured LAN AI endpoint. Dynamic environment/other-machine configs remain outside evidence. |

`docs/client-demo-baseline.md` contains `/controller?tab=agents`; the actual
repository route is spelled `/controler`. That historical documentation spelling
does not change the AI service routing and was not "fixed" as unrelated work.

## Scope and URL provenance

[gateway-url-inventory.json](gateway-url-inventory.json) contains 45 relevant
literal URL forms, each with source file/line and status, plus dynamically
constructed 8766/8767/11434 endpoints. It covers the workspace (including
frontend/backend, env references, deployment, docs, backups), both commits reachable
from all Git refs, and the available reflog. No stashes or additional commits
were found. Dependency directories, generated builds and the private recovery
backup were excluded. No remote Git history beyond the locally available refs
was invented or claimed.

Only parsed scheme/host/port/path are reported; URL credentials, query strings and
fragments are excluded. Quarantined backup code was treated as inert text, never
executed. Unit-test localhost ports/paths, placeholder URLs and public website
examples are labelled as such, not promoted to working production endpoints.

Database inspection used one **READ ONLY** transaction and rolled it back. It
found 4 AGENT records, all 4 with currently available saved voices; no
`voip_connections` rows or URL-valued top-level provider-config fields; and zero
physical agent bindings. Secret columns and private script/knowledge contents
were not printed. No database writes/migrations were run by recovery.

## Was this Cloudflare 403, CORS, authentication or proxy failure?

- Authenticated Cloudflare health returned 200/ready after recovery, with
  credentials read only from backend environment. Prior unauthenticated 403 is
  expected Access protection; it was not bypassed or disabled.
- The concrete regression is the backend adapter/schema/binding switch. It
  occurs before a conversation can begin and does not require a Cloudflare
  failure to reproduce. The regression test failed before the two-line fix and
  passed afterward.
- Old requests use JSON config/text/opening or WAV turns, with NDJSON transcripts
  and PCM chunks back. New requests use gateway multipart audio and a physical
  agent ID, with raw PCM back. They are different contracts.
- `proxy.ts` has no diff against HEAD. Existing session-cookie/admin/origin
  checks remain. The `next.config.ts` changes add privacy/microphone headers only
  for `/test/agent/*`; there are no rewrites redirecting the admin tester.
- No CORS cause was observed or required to explain this regression. The browser
  still calls its own website; loopback engine calls are backend-to-service.
- No production browser failure log was captured here, so unrelated browser or
  deployment-specific failures cannot be ruled out by a health check alone.

## Backup and exact changes

Before changing recovery code, current modified/untracked files plus `.env` were
copied to:

```text
E:\Shahvex\.data\recovery\gateway-20261110-003104
```

The directory has explicit NTFS access for the current identity, SYSTEM and local
Administrators, is under Git-ignored `.data`, and contains the uncommitted patch
and base commit. The `.env` backup is private; never attach or commit that folder.

Files changed in recovery:

- `app/api/admin/agent-test/route.ts`: remove the two automatic remote dispatches.
- `tests/agent-test.test.cjs`: regression proving all original tester actions
  remain local with the Cloudflare URL configured.
- `.env.example`: clarify that the URL configures `/api/shahvex/*`, not the old
  admin tester.
- `docs/shahvex-physical-api-integration.md`: mark the former auto-routing behavior
  as superseded by this recovery.
- New `docs/gateway-recovery.md` and `docs/gateway-url-inventory.json`.

Byte comparisons against the recovery snapshot confirm `.env`, the frontend
tester component, original engine client and Cloudflare HTTPS client remain
unchanged. No repository reset, bulk rollback, tunnel deletion or token rotation.

## Verification results and honest limits

| Area | Result |
|---|---|
| Original connection reachability | Parakeet/CosyVoice health ready; voice list 200; Ollama model present. |
| Real voice pipeline | Existing opt-in `live Parakeet -> Ollama -> CosyVoice round trip` passed with synthesized test speech; real STT, LLM and TTS streamed nonzero PCM. No browser microphone/speaker audition implied. |
| Real text-to-voice turn | Existing live three-sentence/example test passed, with real LLM deltas and streamed PCM. Generic synthetic input, no customer data. |
| Configuration/extraction/preview/start | New regression passed with Cloudflare URL set. Uses mocked auth/DB/engine for action coverage; actual voice synthesis separately verified live. |
| Session memory / AI-first / stop / interrupt | Mocked route, cancellation and streaming tests passed. No authenticated browser session or physical barge-in listening test performed. |
| Existing agent creation / settings | Existing `agent-settings` and `bpo-local-voice` tests passed with mocks. No real agent was created/edited to avoid changing saved data. |
| Demo/testing links | Existing demo security/consent/ownership/bridge tests passed with mocks. No real link was generated or external demo voice session exercised. Older 8787 local-demo path remains blocked here by absent listener/configuration; it was not redirected blindly. |
| Database | Read-only inventory/voice-availability check passed. Existing records unchanged. |
| Cloudflare integration | Authenticated `https://ai.shahvex.com/health` returned 200/ready using the existing client. Separate APIs retained. |
| Website authentication | Existing local port 3000 admin tester, agent listing and `/api/shahvex/health` returned 401 anonymously. |
| Targeted tests | 45 total: 43 passed, 2 live tests skipped in the mocked run. Both skipped live tests then ran explicitly and passed (2/2). |
| Production build / TypeScript | `npm run build` passed. |
| Full suite | 211 tests: 203 passed, 7 skipped, 1 pre-existing quarantined backup-evidence hash failure. Evidence was not changed to silence it. |
| Diff whitespace | `git diff --check` passed. |

The restored direct flow requires Next.js to run on the physical machine (or an
already-established same-host loopback forwarding setup). Vercel cannot reach
this machine's loopback ports by itself. This recovery does not pretend otherwise
or reroute cloud requests to a guessed endpoint.

Refresh the existing physical portal, open **Agents > Test Agent**, select the
saved agent and perform the normal microphone/preview/session checks. A development
Next process can reload changed source. An already-running production Next process
may need an **application-only** restart using its existing service manager/start
command to load the rebuilt app; this recovery did not kill an unidentified live
portal process or discard its process environment. Do not restart STT/TTS/Ollama,
the tunnel or Cloudflare Access. No public deployment was performed or claimed.
