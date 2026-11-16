> Updated workflow: the tester is now global beside Create Agent. The recording-consent checkbox and manual text/Interrupt controls were removed at the user?s request; Start initiates recording after microphone permission. Clear is display-only with active-session confirmation, End Session finalizes. Quick Dial is retired for both portals. See [current refinement](agent-creation-voice-library.md). Historical test descriptions below refer to the earlier recording implementation run and remain evidence of its actual audio mix.

# Admin recording, VoIP and loading polish

## Recording in the existing tester

Open `/controler?tab=agents` and choose **Test Agent**. Check the recording permission/consent box before Start. Microphone permission is requested only after that user action. The existing ConversationRecorder (MediaRecorder) starts automatically after the session is created, before AI-first opening is requested.

A MediaStreamDestination in the same 16 kHz Web Audio context mixes:

- Microphone input after the browser's echo cancellation/noise suppression. Web Audio resamples the input track to the context rate. A recording gain respects the existing microphone mute control.
- The actual output of the existing PCM playback worklet, after selected-voice synthesis, resampling, playback buffering, and interruption. It is a direct graph connection; speaker output is not recaptured. Audio not rendered because of interruption is not recorded.

The context clock preserves chronological order, pauses and silence. Interruption clears playback but does not stop the recorder. Stop, End session, close, and turn/disconnect errors finalize available audio before graph cleanup. Duplicate starts are guarded. The recording indicator/timer is separate from content-loading skeletons.

After Stop, an audio preview, duration and Download Recording link appear. Supported browser output is WebM/Opus, WebM, or MP4 with `.webm` or `.m4a` as appropriate. No fake WAV extension is used. A completed download remains available in the agent row after modal close while that Agents component remains mounted. Start of another test replaces the previous recording, so download it first. Leaving Agents or reloading discards browser-only data. No complete recordings are uploaded or put in localStorage. The existing recorder has a 20 MB recording limit; errors are shown clearly. Physical speaker echo remains dependent on browser AEC and headphones; no acoustic speaker-loop recording is intentionally added.

Mobile now uses accessible Configuration/Conversation tabs so consent, Start/Stop and recording controls do not squeeze the script into a small scroll area. Desktop preserves the two independent scroll panels.

## Agent cards and navigation

Regular admin agents retain their name/avatar, status, call access/counts, essential edit action, and Test Agent. Provider labels/badges and the provider-specific Manage action are removed from this card. The selected local test voice is shown after configuration loads/changes; before loading it honestly says to select in the tester. Test voice overrides remain session-only, consistent with the existing tester.

**VoIP** replaces **AI Credentials** in admin navigation. Old `?tab=credentials` links resolve to VoIP. Existing `credentials` RBAC grants still authorize VoIP for compatibility; new role editing uses a `voip` permission. The old credential records and API endpoints remain for unrelated consumers. No cloud AI dependency is added. The BPO client workspace also exposes VoIP using the same component with BPO authorization.

## Routes and additive models

- `GET/POST /api/admin/voip`: approved authorized admin's own connections and agents.
- `GET/POST /api/bpo/voip`: approved BPO client's own connections and agents.
- POST actions: `save`, `test`, `assign`; system-super-admin-only `claim-legacy` establishes an unverified legacy agent's owner explicitly.
- Existing tester, script extraction, preview and conversation routes remain in use.

SQL initialization version 26 adds `voip_connections`, `voip_agent_assignments`, and `admin_agent_owners`. Corresponding Prisma models are VoipConnection, VoipAgentAssignment and AdminAgentOwner. No existing agent records, credential records or old tables are dropped. Do not use a destructive Prisma reset; this project uses its existing additive SQL initializer.

New regular agents record the authenticated creator in an atomic INSERT CTE. BPO agents continue using the established bpo_created_agents ownership relation. Older regular agents without a verified creator are excluded from client assignment until a system super administrator explicitly confirms their owner in VoIP. The system does not guess ownership from global admin access or a script upload. Verified mappings cannot be reassigned through the legacy confirmation action.

Connections and assignments always use authenticated owner ID from the correct portal cookie, never a browser-provided tenant ID. Assignment writes jointly check owned agent and owned connection. A composite owner/connection database foreign key prevents cross-tenant connection assignment. Even a super admin sees only its own connection secrets/configurations; the separately restricted legacy-ownership section is the only system-wide ownership tool.

## Secret storage and network validation

The existing AES-256-GCM credential format/key derivation was moved into a reusable server-only credential-crypto helper. Legacy decryption remains compatible. VoIP saves require CREDENTIAL_ENCRYPTION_KEY or AUTH_SECRET to be configured. GET/save/test responses never contain plaintext credentials or ciphertext. Editing keeps the saved secret unless a new one is supplied. Raw upstream bodies, credentials and arbitrary error text are not returned/logged.

Default outbound access requires HTTPS and public DNS addresses. `SHAHVEX_VOIP_ALLOWED_HOSTS` optionally approves exact private hostnames/IPs or HTTP targets on trusted networks; it is a server-only deployment setting, not browser input. DNS answers are checked, pinned for the HTTP connection, and bounded by a timeout. HTTP redirects are not followed, TLS certificate validation stays enabled, and response/time limits apply. This is not a general-purpose browser proxy.

## Actual VICIdial verification

Test Connection POSTs form parameters to the documented `/vicidial/non_agent_api.php`, using `function=user_details`, `agent_user=<integration user>`, `stage=csv`, `header=YES`, `source=shahvex` and API user/pass. This is a read-only authenticated function. Connected (API) requires the documented user header and an active row matching the configured integration username. An unauthenticated `version` response, HTML login, HTTP failure, wrong user or API permission error never means Connected. Editing configuration resets its test status; revision checks prevent a stale test from verifying newer settings.

The deployment must support user_details and grant the integration user the documented API access, user level and reporting permissions. Reference: [official VICIdial Non-Agent API](https://www.vicidial.org/docs/NON-AGENT_API.txt), especially user_details. POST variable support is present in [VICIdial API source](https://raw.githubusercontent.com/ccabrerar/vicidial/master/www/vicidial/non_agent_api.php).

Routing saves Shahvex-side campaign IDs for outbound, or DID/in-group/destination settings for inbound. Saving does not mutate VICIdial, launch campaigns, originate calls, create SIP channels, or connect live media. API verification does not prove campaign existence or SIP/RTP routing. The existing telephony adapter remains an interface pending the client's actual Asterisk/VICIdial deployment contract and test calls. Real calling is accurately shown as not verified.

## Skeleton coverage

Shared theme-colored, accessible AdminSkeleton placeholders cover admin route entry, agent list/rows, tester configuration/voices, script extraction and extracted-detail content, VoIP connections and assignment data, Scripts, Documents and Settings. Existing Live Calls/BPO skeletons remain; live-call fetches now have a timeout. Skeleton animation respects reduced motion. New fetches are bounded and clear loading on failure; Settings' old never-ending error skeleton is fixed. Actual live Listening/Thinking/Speaking/Recording states remain text/indicators.

## Verification performed

- TypeScript and Prisma schema validation; production build and targeted lint are part of final checks.
- Route/helper tests: AES secret round trip and no plaintext responses, owner isolation, cross-tenant assignment refusal, unauthorized legacy-claim refusal, verified ownership requirement, destination validation, unauthenticated-version false-positive rejection, and a real loopback HTTP fixture validating the exact read-only POST operation. The fixture is not a live client VICIdial installation.
- Recorder test: ordered chunks, actual MIME, duplicate start refusal and exactly one finalization.
- Existing full tests: 171 passed, 7 skipped, one pre-existing backup-security evidence-hash failure in tests/gateway-integration.test.cjs. Its backup files were not modified.
- Real browser: recording consent blocks Start, agent provider UI is absent, recording remains active during interruption, and the next turn can speak normally. A 115587-byte WebM download decoded to 16.26 seconds (peak 0.78, no clipping in that sample). Re-transcribing the mixed recording through local Parakeet produced: "I would like to book a visit. I'd be happy to help you arrange a visit. You can visit Monday through Friday." This verifies both microphone and actual played AI speech in chronological order. The typed follow-up question was correctly not reconstructed as audio.
- Real browser: close while recording finalized safely; download remained available afterward. Filename used shahvex-Daniel-2026-11-09.webm. Agents skeleton appeared during a delayed fetch; mobile tester and VoIP layouts fit a 390px viewport without horizontal overflow.
- Actual authenticated VoIP GET reached the existing PostgreSQL-backed schema and returned successfully. Real VICIdial credentials/server were not provided, so live client API verification and external routing are not claimed. Save/test/assignment behavior is verified by route fixtures; complete real installation acceptance remains a deployment step.

## How to verify in admin

1. Agents: confirm local-voice/Test Agent controls, no Groq/Telnyx labels or Manage. Existing Edit still opens.
2. Tester: consent, Start, speak, interrupt, speak again, Stop. Play and download the recording. Close during a separate short test and check Download last recording afterward.
3. VoIP: save your actual VICIdial HTTPS URL, API-enabled integration user and secret. Use Test Connection and inspect status/last-tested time. Check server allowlisting if your dialer is on a private network.
4. System super admin only: establish legacy agent ownership if necessary. Select your agent and connection, direction, then campaign or inbound routing fields. Save. Log in as another client to verify isolation.
5. Verify real SIP/media and controlled test calls separately before claiming live calling. This feature exposes no campaign-launch or real-call action.

## Changed-file groups

Recording: agent-test-panel.tsx/CSS, browser-pcm-player.ts; existing ConversationRecorder reused.
VoIP: voip-manager.tsx/CSS, admin/bpo VoIP routes, voip-controller.ts, vicidial.ts, voip-schema.ts, credential-crypto.ts, database initializer, Prisma schema, .env.example.
Admin integration: admin-control-center.tsx, agent-credential-cell.tsx, admin-settings.tsx/API, admin agents API, legacy credentials API helper import, BPO workspace.
Loading: admin-skeleton.tsx/CSS, controler/loading.tsx, Scripts/Documents/Settings/Live Calls loading/error paths.
Tests: voip.test.cjs, conversation-recorder.test.cjs. Existing tester regression tests remain.
