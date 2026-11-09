# Existing website → physical conversation gateway

Recovery update (2026-11-10): automatic rerouting of `/api/admin/agent-test` based
on `SHAHVEX_API_URL` was removed because it broke the existing direct-service
tester contract. `/api/shahvex/*` and its security remain available independently.
The automatic-tester activation statements below describe the earlier integration
and are superseded by [gateway-recovery.md](gateway-recovery.md).

## Architecture and inspected contract (2026-11-10, Asia/Karachi)

Existing Next.js 16.3.1 App Router / React 19 / TypeScript, Node API routes,
PostgreSQL via `pg`, an existing Prisma schema, and signed `jose` session cookies
for ADMIN/BPO/AGENT. Existing permissions/verified admin ownership and BPO ownership
are reused; no second login system, framework or dependencies were added. The live
website was previously verified as Vercel. The existing `AgentTestPanel`, WAV
microphone capture, PCM player, recording mixer, states and cancellation controls
are reused without adding a page/section or changing the layout. Local service
testing remains the existing path when `SHAHVEX_API_URL` is unset.

The schema was retrieved directly from `http://127.0.0.1:8768/openapi.json` and
saved as `docs/shahvex-gateway-openapi.json`. The authenticated public schema was
retrieved afterward and matched the local schema exactly. Read-only inspection
of running WSL source confirmed responses that OpenAPI leaves untyped:

```text
/home/nazeer_ahmed/shahvex-ai/gateway/services/shahvex_gateway.py
/home/nazeer_ahmed/shahvex-ai/gateway/services/agent_manager.py
/home/nazeer_ahmed/shahvex-ai/gateway/services/conversation_manager.py
```

No physical file, process, model setting or tunnel configuration was modified.

Actual upstream contract:

| Operation | Request | Response |
|---|---|---|
| GET /health | none | readiness/capability JSON |
| POST /conversation | multipart `audio` (required WAV), `session_id`, `agent_id`, `voice_id`, `agent_name` | WAV, session/agent/voice headers |
| POST /conversation/stream | same multipart fields | raw PCM16 little-endian, 24000 Hz, mono; session/agent/voice headers |
| GET /sessions/{session_id} | 32 lowercase hex upstream ID | session/agent/voice IDs, busy, turn_count, history_messages |
| DELETE /sessions/{session_id} | same upstream ID | deleted, or 409 while busy |

`agent_id` selects an existing physical JSON agent; that agent overrides request
name/voice and supplies the prompt/script/knowledge. Empty agent IDs activate a
generic manual-demo prompt: **the website adapter never uses that fallback**.
The gateway retains at most 12 history messages, has 30-minute idle expiry and
in-memory sessions, and rejects overlapping turns. Its stream starts only after
STT and a non-streamed LLM reply finish; it streams TTS audio, not LLM tokens/SSE.

## Backend configuration

Provision only in the existing backend `.env` and Vercel Production secret store:

```dotenv
SHAHVEX_API_URL=https://ai.shahvex.com
SHAHVEX_CF_CLIENT_ID=<service token client ID>
SHAHVEX_CF_CLIENT_SECRET=<service token secret>
```

`.env.example` has blank placeholders and the documented URL. Existing `.env`
values were neither overwritten nor printed. Do not prefix these names with
NEXT_PUBLIC_, commit them, or put them into browser storage. Setting the URL
enables the remote adapter in the existing Admin tester; missing credentials
then fail closed instead of falling back to Vercel localhost.

Keep the existing `shahvex-physical-ai` tunnel → `http://127.0.0.1:8768` and
Cloudflare Access Service Auth policy selecting `shahvex-nextjs-backend` unchanged.
No additional public hostname or raw STT/TTS/Ollama/experimental port is needed.

The HTTPS client uses only a closed operation list, verified TLS, fixed configured
origin, no redirects, no caller-supplied credentials and no cache. Connection/TLS
deadline is 10 seconds, first response 110 seconds, total request/stream 240
seconds; health has 10 seconds total. The Node HTTPS client bypasses caches and
sends `Cache-Control: no-store`. No user cookies go upstream. Error bodies and
network exception details are never returned or logged.

Vercel conversation routes use Node runtime and `maxDuration=300`. The existing
project must allow that duration (Fluid compute or an adequate plan). Incoming
multipart body is limited to 2 MB; outgoing WAV to 4 MB; PCM is streamed, bounded
to 12 MB and the total deadline. Audio capture already limits WAV turns to 21
seconds. Recording stays browser-local. Check production response streaming and
Cloudflare first-response limits; do not buffer in an intermediary.

## Website routes

| Website route | Authentication/behavior |
|---|---|
| GET /api/shahvex/health | approved website user; sanitized capability status |
| POST /api/shahvex/conversation | authorized saved agent and session; WAV response |
| POST /api/shahvex/conversation/stream | same authorization; original raw PCM stream |
| GET /api/shahvex/sessions/[id] | owner + current agent authorization; sanitized status |
| DELETE /api/shahvex/sessions/[id] | owner + Origin check; supported upstream close |

These use existing ADMIN cookies by default. Existing BPO/AGENT cookie contexts
are selected explicitly with `?portal=bpo` or `?portal=agent`, then role and
approved account are rechecked. An agent can access itself only when it is a
regular non-BPO agent. BPO users can access their own BPO-created agents. Admin
access requires `admin_agent_owners.verified=TRUE` for that admin and excludes BPO
agents. Legacy unverified ownership is not silently claimed.

Website conversation input is multipart `audio`, `agentId`, optional `sessionId`,
and required `turnId` (1–80 letters/digits/underscore/hyphen). These are the
website's own request fields, not invented upstream fields. No `script`, custom
URL, model selection, upstream session ID, voice override or prompt is accepted.
The adapter supplies exactly the five real upstream fields from server data.

Website session IDs are opaque local UUIDs. Upstream IDs remain server-side in
PostgreSQL and are never accepted from the browser. Each request rechecks owner,
agent access and configuration binding. Shared PostgreSQL admission prevents
duplicate/parallel submissions across Vercel instances. A definite upstream 409
busy response permits a safe retry; uncertain failures are not blindly replayed.

60 requests/minute/user; at most 3 unexpired website sessions/user; fixed
30-minute website session lifetime; one in-flight turn/session with a bounded
lease. Edge limits may supplement this. New additive tables initialize when
needed: `shahvex_agent_bindings`, `shahvex_sessions`, `shahvex_turns`,
`shahvex_rate`. Existing tables/data and the authentication schema are unchanged.
Use the existing app's schema initialization/deployment policy; for restricted DB
roles, have a DBA preapply the exact CREATE TABLE statements in
`lib/shahvex-access.ts`. Do not run Prisma reset/db push to deploy this change.

## Required agent binding: no automatic script synchronization API exists

The gateway exposes no agent create/update/config-read endpoint. Therefore website
script/persona/style/knowledge edits **cannot** be pushed through the advertised
API. Preserve existing records, and use an operator-verified binding to an already
configured physical agent. No binding was automatically created during this task.

For an existing approved, verified-owned admin agent:

1. Privately compare its current saved name, script/instructions/goals/knowledge,
   voice ID and applicable style with the already-existing physical agent JSON.
   Verify voice gender/accent against the existing voice, not a guessed parameter.
   Any unresolved mismatch is a blocker; do not edit the physical service as a
   workaround. The gateway does not accept independent accent/language settings.
2. After initializing the additive tables via an authorized route, obtain a
   read-only website fingerprint:

   ```powershell
   node --env-file=.env scripts/shahvex-binding-fingerprint.cjs WEBSITE_AGENT_ID VERIFIED_ADMIN_OWNER_ID
   ```

   This SELECT-only tool prints the website ID and config hash, never script,
   knowledge, password or credentials. It does not assert physical equivalence.
3. A database operator can record the independently verified mapping using a
   parameterized query (values supplied separately, not concatenated):

   ```sql
   INSERT INTO shahvex_agent_bindings
     (agent_id,upstream_agent_id,config_hash,verified_at,verified_by)
   VALUES ($1,$2,$3,NOW(),$4)
   ON CONFLICT(agent_id) DO UPDATE SET
     upstream_agent_id=EXCLUDED.upstream_agent_id,
     config_hash=EXCLUDED.config_hash,
     verified_at=NOW(),verified_by=EXCLUDED.verified_by;
   ```

   `$1` website agent ID; `$2` existing physical ID; `$3` verified fingerprint;
   `$4` verifying authorized admin ID. Bindings are one-to-one, including unique
   upstream IDs, to avoid routing different website customers into one mapping.
4. Existing Admin > Agents > Test Agent uses the physical adapter automatically
   when the URL is configured. Its saved configuration remains visible; unsupported
   per-session editing/extraction/voice preview is disabled in remote mode, with
   an explanation. Local mode retains its existing controls and behavior.
5. Website configuration changes invalidate the hash and require reverification.
   Physical-only config edits cannot be detected through this API; revoke the
   binding before making any such change, then independently reverify afterward.

Hash coverage: website ID, name, saved voice ID, accent, language, first-speaker
setting, conversation style, and effective saved script (including embedded
instructions/knowledge). The actual returned physical agent/voice headers are
also checked before audio is released to the browser. A binding is an explicit
operator attestation, not a claim of remote cryptographic configuration proof.

## Precisely missing physical capabilities

- Text message input: all conversation endpoints require an audio WAV. JSON text
  is rejected with 415. No fabricated text request or fake customer audio is sent.
- Agent configuration API: needed to securely validate/update scripts, persona,
  goals, instructions, documents/knowledge and style directly from website data.
- Config version/hash on responses: needed to verify remote prompt equivalence
  automatically and detect physical-only edits.
- Voice inventory/preview API: the gateway validates its private CosyVoice voice
  internally but exposes no voice-list, approval, upload or preview route. Existing
  voice/agent management APIs were left unchanged; their existing local-service
  dependencies are not made remotely reachable by this adapter. Provisioning new
  voices remotely needs additional protected gateway capabilities, not a public
  tunnel to port 8767. The tester uses the existing agent's verified saved voice.
- Transcript output: session GET gives counts/status only, not messages. The
  tester displays real audio states and explicitly says no text transcript is
  supplied. It never generates fake transcript lines.
- AI-first start: no start/opening operation without customer audio. Website
  agents configured AI-first are rejected rather than silently changed to
  customer-first.
- Explicit inference/turn cancellation: browser abort stops playback, cancels its
  upstream HTTP stream and releases website admission. The current gateway's
  synchronous STT/LLM worker may continue before headers, and its TTS generator
  may not immediately stop model work. A new turn can receive 409 until it drains.
  DELETE refuses busy sessions; do not claim GPU/kernel cancellation or guaranteed
  instantaneous physical barge-in. The existing local tester is unaffected.
- Streaming transcription/LLM deltas: current public stream is PCM TTS after a
  complete STT+LLM result. The experimental port 8769 is not used or exposed.
- Caller-specified session creation/early ID: disconnect before the first response
  may leave an unbound physical session until its existing TTL. No guessed delete
  endpoint or remote reset is used.

## Validation and deployment status

Live checks actually run:

- Local OpenAPI HTTP 200; local `/health` HTTP 200, ready.
- Public `https://ai.shahvex.com/health` without credentials: HTTP 403.
- Public health with configured backend credentials: HTTP 200, ready.
- **Implemented Node HTTPS client** against Cloudflare health: HTTP 200, ready.
- Public authenticated OpenAPI: HTTP 200 and exact match to captured local schema.

No real customer audio, conversation inference, session deletion or physical agent
configuration changes were issued as validation. Real conversations need a verified
agent binding and authenticated browser acceptance. Mocked tests cover contract
mapping, authorization, session isolation, raw incremental PCM, cancellation,
safe Cloudflare denial/network errors, input validation and stale config hashes.

Validation commands/results:

- `npm run build`: passed (including TypeScript and all new App Router routes).
- `node --test tests/shahvex-api.test.cjs`: 9 passed, no failures.
- Full `npm test`: 210 tests, 202 passed, 7 skipped, 1 pre-existing failure in
  quarantined backup evidence hashes (`tests/gateway-integration.test.cjs`). The
  mismatch was already present in HEAD and was not edited away.
- Local production HTTP smoke: health, both conversation routes, session GET and
  DELETE all reject anonymous requests with 401 and private/no-store headers.
  Existing admin tester also rejects anonymous requests.
- `git diff --check`: passed. Test-only local production server stopped afterward.

Conversation authorization/stream/session tests use mocks; actual browser speech,
voice playback, multi-turn memory and cancellation against a verified physical
agent remain pending. The passing live Cloudflare health check does not certify
those functions or deployment of this website update.

Deploy the reviewed code to the **existing** Vercel project after provisioning
the three backend variables and additive tables. Keep the present DNS/tunnel/
Access policy and the existing database/authentication secrets. Then log in as
the verified owner, provision a verified binding, and run a real microphone
conversation, follow-up memory, interruption/stop and recording-download check.
Confirm unauthorized session/agent access is denied and browser requests remain
same-origin without service credentials. This task does not claim that the
updated website has been deployed or real voice acceptance has passed.

Files created in this task:

```text
lib/shahvex-api.ts
lib/shahvex-access.ts
lib/shahvex-routes.ts
lib/shahvex-tester.ts
app/api/shahvex/health/route.ts
app/api/shahvex/conversation/route.ts
app/api/shahvex/conversation/stream/route.ts
app/api/shahvex/sessions/[id]/route.ts
scripts/shahvex-binding-fingerprint.cjs
tests/shahvex-api.test.cjs
docs/shahvex-gateway-openapi.json
docs/shahvex-physical-api-integration.md
```

Files modified in this task:

```text
.env.example
app/api/admin/agent-test/route.ts
app/components/agent-test-panel.tsx
```

Earlier private-link work already present in the workspace was preserved.
