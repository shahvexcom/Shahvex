# Campaign integration implementation and handover

Implementation date: 2026-11-11. **No real VICIdial call or human transfer has been verified.** The repository contains website/backend code and an installable persistent AudioSocket adapter. The dialer engineer must approve its suitability for the actual VICIdial/Asterisk deployment. Existing unrelated workspace changes were preserved; nothing was deployed to VICIdial and no credentials were rotated.

## Implemented flow

Create AI agent profiles using name, gender, voice, conversation style and first-speaker settings. Script and campaign selection are separate from the agent form. In VoIP, save a connection without choosing agents; create a campaign/category, select that saved connection and supply its script. Goals, tasks, questions, required lead fields, instructions and FAQs are extracted automatically from source-grounded excerpts. Assign existing free agents inside the campaign accordion. An agent already assigned elsewhere is rejected until removed from its former campaign. A campaign owns its script; every call keeps its immutable configuration snapshot and selected agent voice. No customer sheet is required.

VICIdial retains lists, carrier configuration and outbound dialing. The website enables dedicated Remote Agent lines, verifies the answered caller-code/campaign/lead against the Native API, and atomically reserves an eligible free AI instance from the same campaign/script pool. Selection uses oldest assignment first. A second reservation cannot acquire the same runtime row. Busy agents remain unavailable during uncertain cleanup and transfer.

Runtime states are `OFFLINE`, `READY`, `RESERVED`, `BUSY`, `TRANSFERRING`, `ERROR`. Reservation happens before voice startup; media-ready confirmation activates the conversation. Signed heartbeats refresh leases. Expiry marks ERROR and never automatically frees a customer channel. The bridge spools events and recovers interrupted call metadata after restart. Duplicate events have payload hashes, processing leases and cached responses; conflicting reuse fails closed, and out-of-order failures can retry.

The shared tester supplies STT, conversation, TTS, interruption and PCM playback. Existing time-permission/interruption filters remain in that path. The identity directive now truthfully identifies AI rather than claiming a human identity, as required by the master prompt. No second conversation engine was introduced.

Customer-grounded lead fields and qualification evidence are stored locally. Sync jobs merge only the current call's marked comment block, preserve other operator text, read back Native writes, and retry at most five times per result revision. Native field mapping fills empty matching fields and blocks conflicting operator values. Full structured results stay on the website. If comments capacity is insufficient, a call reference replaces the AI summary; if even that cannot fit, transfer is blocked. Custom native fields require a verified adapter extension; unsupported mappings fail explicitly.

Transfer requires recorded consent, valid qualification or an explicit request for a human, required configured fields, confirmed data sync and a ready human in-group. Unknown native transfer responses are never automatically resubmitted. Human answer is independently verified against Native agent status/lead. The AI runtime is released only after **both** AI media closure and confirmed human connection/customer termination. Native human calls and their recordings continue independently. Website playback serves only the bridge's AI segment. Waiting music is supplied by the dialer's real customer media path.

Start/Pause/Stop buttons control **AI Remote Agent intake** using documented Native operations. They do not claim to start or stop the entire carrier campaign. Campaign state reconciliation restores saved intake after restart and withdraws incompatible/busy capacity. Direct agent stop disables its automatic assignment intake. Disconnect blocks new calls while signed completion/recording callbacks can finish existing sessions.

## Changed-file map

This lists the campaign integration, including integration files already present as workspace changes when the master prompt was supplied. It does not attribute unrelated TTS, gateway or browser-test changes to this task.

| Area | Files |
| --- | --- |
| Additive migration | `lib/campaign-schema.ts`, `lib/voip-schema.ts`, `lib/database.ts`, `deployment/migrations/030-campaign-runtime.sql`, `deployment/migrations/031-connection-management.sql` |
| Campaign configuration/API | `lib/campaign-config.ts`, `lib/campaign-controller.ts`, `lib/campaign-script-extraction.ts`, `lib/agent-campaign-assignment.ts`, `app/api/{admin,bpo}/campaigns/route.ts` |
| Agent creation/display | `lib/bpo-agent-profile.ts`, `app/api/{admin,bpo}/agents/route.ts`, `app/components/agent-voice-fields.tsx`, `admin-control-center.tsx`, `bpo-agents-workspace.tsx` |
| VoIP UI/API | `app/components/campaign-manager.tsx`, `voip-manager.tsx`, `voip-manager.css`, `lib/voip-controller.ts`, `lib/vicidial.ts`, `lib/vicidial-config.ts` |
| Routing/runtime | `lib/agent-runtime.ts`, `lib/vicidial-live.ts`, `vicidial-queue.ts`, `vicidial-callback.ts`, `vicidial-bridge.ts`, `lib/call-start.ts`, `app/api/telephony/vicidial/route.ts` |
| Leads/transfer/recording | `lib/vicidial-results.ts`, `vicidial-comment-merge.ts`, `vicidial-handoff.ts`, `vicidial-controls.ts`, `vicidial-recording.ts`, `vicidial-leads.ts` |
| Existing call/report integration | `app/api/{admin,bpo}/calls/route.ts`, their `[id]/recording/route.ts`, `lib/agent-call-detail.ts`, `agent-report-export.ts`, `app/components/live-calls.tsx`, `call-detail-page.tsx`, `bpo-dialing-workspace.tsx` |
| Script-only BPO flow | `app/api/bpo/scripts/route.ts`, `app/components/bpo-script-panel.tsx` |
| Shared AI identity | `lib/agent-test.ts` (identity correction only in this master-prompt implementation) |
| Persistent bridge deployment | All files under `deployment/vicidial-bridge/`: server, AI recorder, registration/handoff AGI scripts, dialplan, systemd and environment examples |
| Tests | `tests/campaign-management.test.cjs`, `tests/campaign-runtime.test.cjs`, `campaign-layout.test.cjs`, `vicidial-live.test.cjs`, adapted `agent-settings.test.cjs`, `bpo-local-voice.test.cjs` |
| Handover | This document, `docs/vicidial-live-setup.md`, `deployment/vicidial-website.env.example` |

## Verification and limits

Local audit: ports 8766, 8767, 8768, 8769 and 11434 responded. HTTP health endpoints returned 200. Ollama reported 0.40.15. STT OpenAPI advertises `/transcribe`, not streaming recognition. TTS advertises `/synthesize` and `/stream`; the website keeps native speed/pitch defaults and rejects fabricated controls. The experimental 8769 service is not a requirement for this integration. Existing environment secrets and Cloudflare settings were not changed.

TypeScript, focused new-module ESLint checks and a Next compile-mode production build passed. A real local Ollama extraction test correctly returned a supplied goal, two questions, two required lead fields and FAQ excerpts from a sample script. Connection edit/enable/disable/delete controls are owner-scoped; deletion archives the connection while retaining call references. Category deletion detaches its campaigns without deleting agents/calls. Agent/category/campaign accordions start closed, and the separate Scripts tab is removed from the agent page. Focused integration checks: 52 tests, 47 passed, five previously retired-agent-portal skips, including a real Edge layout test at 360, 768 and 1440 pixel widths. They use mock Native/SIP events plus real HTTP/TCP AudioSocket transport and PCM recording/playback, not a real carrier.

Previous full repository run (before the script-only UI revision): 290 tests, 262 passed, 19 failed, nine skipped. Remaining failures are the demo/test harnesses missing `@/lib/agent-test-speculative`, stale conversation-progress exact-output/JSON assumptions, a gateway evidence hash mismatch, and a gateway recording mock failure. These are not counted as passing. Agent settings and BPO creation regressions introduced by new imports were fixed and their tests pass. Full-suite failures still require separate review; no claim of a clean whole-repository test suite is made.

Database DDL is additive and typechecked as source but has **not** been exercised against the production database. No real campaign synchronization, Native mutation, multi-host database concurrency, carrier call, transfer music, Asterisk hook or human recording boundary is production-verified. No throughput claim for 50+ calls is made: physical remote lines, bridge limits, GPU latency and carrier limits must be measured.

Native `update_lead` provides no compare-and-swap operation. Immediate pre-write/readback checks reduce operator-note races, but cannot prove an operator did not edit between the final read and write. For an absolute concurrent-write guarantee, the engineer must provide a dialer-side serialized merge endpoint or operational single-writer policy. Ambiguous pipe-encoded lead records fail closed. Streaming STT and streaming partial-transcript barge-in require an upstream STT contract; the supplied adapter uses existing utterance recognition plus audio VAD interruption.

## Administrator information and exact manual setup

Obtain the HTTPS dialer URL, API username/password, actual Native API/VICIdial build, Asterisk version, exact outbound campaign IDs, dedicated one-line Remote Agent users and matching phone extensions, human transfer in-group and ready human users, recording policy/base URL, comments column capacity, permitted lead-field mapping, HTTPS bridge host, allowed network paths and installed hook variables.

The API account needs the installed build's Agent API Access, reports, lead modification and Remote Agent modification permissions; verify each function on that deployment. Read-only checks use `user_details`, `version`, `campaigns_list`, `agent_status`, `lead_all_info`, `in_group_status`, and `recording_lookup`. Mutations are restricted to `update_remote_agent`, `update_lead`, and Agent API `ra_call_control`. The implementation follows the [official Native API](https://www.vicidial.org/docs/NON-AGENT_API.txt) and [Agent API](https://www.vicidial.org/docs/AGENT_API.txt); installed-version behavior still needs verification.

Follow [the detailed installation steps](vicidial-live-setup.md): install the persistent Node bridge and restricted JSON/HMAC configuration; configure the verified Asterisk AudioSocket application and private port; give each Remote Agent its matching extension/AGI user; preserve the original caller-code through transfer; install actual customer/human bridge and customer-end hooks; configure in-group waiting music on the customer path; enable native campaign recording; test API and audio bridge separately. Asterisk version remains explicitly unknown in the UI until engineer verification; API version is populated from the documented read-only `version` operation.

On the website: save the connection and HMAC secret; verify API and bridge; synchronize actual campaigns; create category and script/settings; create agent profiles and assign them inside the appropriate campaign accordion; validate campaign; start AI intake. Do not upload the VICIdial number lists to this website. The dialer engineer must provision Remote Agents and confirm the dialing mode sends only answered customers into the AI path; this cannot be inferred from credentials.

## Deployment, rollback and validation commands

Back up the existing database and application release. Existing schema through v29 must exist before the standalone v30 SQL migration. The normal application schema initializer also applies this additive migration. Apply only to the intended database using your existing secure connection mechanism:

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f deployment/migrations/030-campaign-runtime.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f deployment/migrations/031-connection-management.sql
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build --experimental-build-mode compile
node --test tests/campaign-runtime.test.cjs tests/vicidial-live.test.cjs tests/voip.test.cjs tests/agent-settings.test.cjs tests/bpo-local-voice.test.cjs tests/agent-calls.test.cjs
node --test tests/campaign-layout.test.cjs
node --test tests/*.test.cjs
```

The website template is `deployment/vicidial-website.env.example`; bridge environment is `deployment/vicidial-bridge/bridge.env.example`. Preserve production encryption/auth keys and current secure gateway values. Start the bridge using its supplied systemd unit and the website using the existing deployment process. Do not replace existing Cloudflare routes or deploy the gateway inside an ephemeral Next request.

Rollback: pause AI intake, confirm no active AI customer sessions, stop the new bridge/service release, and restore the previous application release. Retain additive tables and call evidence. Do not drop columns/tables or restore a stale database over new call records as a routine rollback. Uncertain native calls require engineer reconciliation before returning their agent to service.

## Real acceptance checklist (still required)

1. Use two real test campaigns with distinct scripts/lead IDs, permitted test customer numbers and ready human destinations. Verify category, owner and exact campaign mapping separation.
2. Provision ten actual remote lines. Keep six AI calls busy and four READY. Answer four more calls; ensure only those four free instances receive them and no fifth dispatch enters a busy AI session. Measure STT/LLM/TTS latency and bridge/GPU capacity.
3. Confirm assigned voice, truthful disclosure, concise replies, no goal/time-permission question, and no false interruption marker without audio interruption. Test natural barge-in, silence, refusal, opt-out and caller hangup.
4. Extract a name and required campaign details; inspect full local structured evidence, Native comments, field maps and preserved human notes. Inject Native failure, verify five bounded retries and blocked transfer, then restore service and reconcile exhausted jobs manually.
5. Qualify and consent to transfer. Verify an actually ready human in-group, customer waiting music, correct human answer hook, customer/human two-way audio, AI leg detachment, and AI becoming available only after both confirmations. Check that website recording ends at the AI boundary and native recording continues.
6. Replay duplicate/out-of-order signed events, terminate/restart the bridge, interrupt a transfer response, disconnect/pause intake during a conversation, and exhaust all physical capacity. Verify no double transfer, premature release, cross-campaign session, fake success or overwritten operator record.
7. Retest existing browser voice tests and production authentication/Cloudflare access. Retain actual Native responses, sanitized event timings, call identifiers and recording-boundary evidence before declaring end-to-end calling operational.
