> Current workflow correction: Create/Edit Agent no longer accepts or assigns scripts. Script and lead-sheet assignment stays on the existing Scripts page. Creating an agent requires voice/style/first-speaker settings but no script. Editing an agent preserves its assigned script. The repeated language/accent helper line was removed from the creation form. The operator confirmed all currently installed voices are English with an American English accent; that metadata is applied once to the trusted existing registry entries. Future uploaded voice metadata remains independent. The tester UI and test-only script overrides are unchanged.

# Agent creation and global voice tester refinement

## Admin workflow

1. Open `/controler?tab=agents`. There is one **Test Agent** action beside **Create agent**. Rows retain agent identity/status, saved local voice and Edit, without per-row Test Agent or provider controls.
2. Create/Edit an agent: select an active local voice, write Agent Script, choose Conversation Style and Who Speaks First, then save. Existing profile, login, avatar, status and call-access fields remain. Voice preview uses the current local TTS proxy. Gender/accent are derived from selected voice metadata rather than independent invented values. Current language is English only.
3. Open the global Test Agent modal and choose an existing agent. Its saved name/avatar, local voice, style, first speaker and script load. Language and registry accent appear below the voice selector; absent accent metadata says **Not provided by registry**, not American.
4. Test overrides are temporary: tester start/extraction never writes agent settings. Use Edit Agent to save changes. Script uploads through the existing Scripts screen synchronize the saved agent script, preserving that workflow. Legacy blank saved scripts fall back to the latest existing assignment.
5. Click **Start Test**. This initiates microphone permission and automatic browser-only recording. At the user's explicit request there is no extra recording-consent checkbox or consent banner. No capture starts before Start and microphone permission. The recording indicator/duration remains visible.
6. Conversation is voice-only in the UI. Text composer/Send and manual Interrupt are removed. Automatic genuine-speech barge-in is preserved.
7. **End Session** is always accessible in the shared footer while active. It stops mic/playback, cancels requests, finalizes the recording, and exposes preview/download. Start Test is available in that same footer when idle, including on the mobile Conversation tab.
8. The brush **Clear Conversation** action clears display only. During a live session it asks for confirmation, preserves server memory and recording, and suppresses already-cleared turn bubbles. It does not silently end/reset the session or discard recordings. No "Conversation cleared. Start a new session" badge appears.

The Agent Configuration heading is removed. The avatar/name/live state, actual-playback ripple, script extraction, read-only details, voice/style/first-speaker controls and independent scroll areas remain. Mobile uses accessible tabs. The empty-conversation microphone has a dedicated centered flex container.

## Saved fields and APIs

Additive SQL initialization version 27 adds agents.local_voice_id, agent_script, conversation_style, speaks_first and language. Existing agent data is retained. Create validates mandatory voice/script and persists all settings atomically with creator ownership. Edit preserves unspecified fields and validates selected active local voice. The corresponding Prisma Agent fields are documented in schema.prisma. Runtime uses the project's existing additive SQL initializer, not a destructive reset.

`GET/POST /api/admin/agents` and PATCH carry saved settings. `GET /api/admin/agent-test?agentId=...` loads the saved settings and avatar, while its session actions keep overrides only in process memory. Existing /api/admin/scripts writes synchronize the agent script when assigning/updating scripts.

Quick Dial navigation and workspace access are removed from both controller and BPO. Both legacy Quick Dial GET/POST endpoints now return HTTP 410 without executing calls. Old records and unrelated APIs remain intact.

## Local voice registry and secure reference preparation

`GET /api/admin/local-voices` returns dynamically approved/selectable local voices for creation/editing. `?manage=1` supports the existing **BPO > Voices** admin area, which now leads with Local Voice Library. Legacy voice assignment UI remains under an explicit collapsed section for compatibility.

The registry stores unique ID, name, gender, language, accent, owner/global visibility, private reference path/transcript, status, rights verification, transcript verification, and existing-service trust. Additive models/tables are LocalVoiceRegistry/local_voice_registry and LocalVoiceBootstrap/local_voice_bootstrap. Current languages are restricted to English server-side; schema metadata supports future additions without presenting unsupported languages now.

Initial population takes a one-time dynamic snapshot of the existing backend-selectable English voices. Existing operational approvals are retained so current voices keep working; this is not a claim that historic cloning-rights or reference transcripts have been independently audited. Subsequent new backend IDs require an app registry record and explicit approval, not a hardcoded frontend list. Selectors use only active, owner/global-visible records that are approved/trusted and actually selectable in the backend.

Authorized admins may upload a 1-30-second mono PCM WAV reference up to 10 MB, a matching transcript and an explicit cloning-rights declaration. Local Parakeet verifies the ordered transcript within a bounded word-edit distance. Invalid/mismatching references are rejected. Files use random UUID names in `.data/local-voices`, outside public assets, with owner/system-admin reference access and no public filesystem paths. `.data` is git-ignored. Ownership races do not publish or orphan an unauthorized reference; replacing a valid reference removes its old private file.

Uploads enter PENDING. Approval requires rights/transcript verification and an existing selectable backend Voice ID. The current CosyVoice API exposes no safe voice-registration/cloning endpoint, so this website does not invent one, edit installations, or pretend an upload installed a new voice. An operator must provision the matching voice/reference in the existing backend, then an authorized admin approves it. Approval makes the record appear on the next selector load without rebuilding the app. Only system administrators can publish global voices; private records/references remain isolated. No additional language synthesis or model service is installed.

Voice preview for approved selections uses the existing `/api/admin/agent-test?action=preview` local TTS proxy. Complete conversation recordings are still client-only; authorized reference uploads are a separate explicit library operation.

## Verification

- Route tests cover create/edit persistence of voice/script/style/first-speaker and registry-derived accent/gender; English-only validation; ordered reference transcript matching; tenant-scoped approved registry lookup; and Quick Dial 410 from both portals without executing provider functions.
- Real browser: exactly one global Test Agent and zero row tester actions; no Quick Dial navigation. Nine dynamically available voices were returned, all English (the UI does not assume a fixed count). Create form shows required script/voice/style/first-speaker fields. Agent selection loaded existing names Daniel/Lauren/Jenifer from the current application.
- Real browser: zero Agent Configuration headings, manual customer inputs, Send, Interrupt or recording-consent checkboxes. Empty-state microphone center deviation measured 0 px.
- Real browser: automatic barge-in accepted the recorded customer sentence "I would like to book a visit." during AI playback. Confirmed Clear retained the ongoing recording, End Session finalized a downloadable recording, and the mobile modal fit 390x844 without horizontal or vertical clipping. No page errors occurred in that run.
- No real user agent settings were overwritten for browser testing; persistence is exercised with route/database fixtures and the actual runtime registry/settings read path was checked.
- Existing recording/VoIP work remains covered in admin-recording-voip.md. Real client VICIdial credentials, SIP/media paths and external calls remain unverified.

## Files added/updated for this refinement

- admin-control-center.tsx, agent-voice-fields.tsx, agent-test-panel.tsx/CSS, controler/page.tsx.
- admin agents API, existing tester API, admin scripts API.
- admin/local-voices API, local-voice-registry.ts, voice-reference-validation.ts, local-voice-library.tsx, BPO management Voices tab.
- BPO workspace, controller/BPO Quick Dial routes, admin permission UI.
- database/schema initializer, prisma/schema.prisma, .gitignore.
- tests/agent-settings.test.cjs and this documentation. Existing recorder, VoIP and extraction/streaming tests remain.

## Limits

Unknown existing voice accent metadata remains explicitly unknown until verified metadata is supplied. Existing service approval is inherited, not a retrospective rights audit. Uploaded references do not install new voices: operator provisioning is still required before approval, and the approving administrator must confirm the backend Voice ID matches the supplied reference. Private local reference storage needs a persistent secured application filesystem in production; ephemeral/serverless deployments need their existing private storage integration before using uploads. The selected demo runs locally. Native GPU inference and physical microphone/speaker acoustics retain their previously documented limitations.

Final checks: production build, standalone TypeScript, Prisma validation and targeted ESLint passed. All 23 selected settings/input/streaming/recording/VoIP tests passed with the two live AI-service tests enabled. Full suite: 174 passed, 7 skipped and the one pre-existing backup-security evidence hash mismatch.
