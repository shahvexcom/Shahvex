# Shahvex call recovery update — conversation flow correction V4

This complete package supersedes V3, V2 and the earlier call recovery ZIP. The intro correction records the actual speech phase and a pending intro restart in the shared session. It handles both an intro aborted during synthesis and an intro whose synthesis finished while its audio was still playing. A normal flexible introduction is rephrased directly using the configured identity, alternating natural wording. The next listening reply advances to the script-based purpose. Mandatory exact openings retain the existing grounded model path.

Copy the included app/, lib/, gateway/ and deployment/ files over their matching paths in the current Shahvex project. Each included source file is complete. This package uses the GitHub main source inspected on 19 November 2026. Keep a copy of the current files so the complete update can be rolled back together.

## Install on the running services

1. Apply the matching source paths to the website project and to the PC tester project. The native bridge also needs gateway/conversation-resume.cjs, conversation-silence.cjs and their existing conversation-flow.cjs and question-memory.cjs dependencies.
2. Run npm run build in the full website project, then restart its existing Next.js production process. Restart the existing PC tester service to load the changed TypeScript session/stream modules.
3. Update and restart the existing VICIdial AudioSocket bridge process. Its production source entry is deployment/vicidial-bridge/server.cjs. Keep its existing environment, connection ID, shared secret, spool directory, audio endpoint and port assignments. If the installed copy uses another source directory, put all matching relative dependencies beside that installation before restarting. The standard bridge expects the project directory structure.
4. Resume the website campaign and its assigned AI agents. The free agent must have a running campaign assignment and a unique configured remote user / audio prefix. Atomic admission continues to reject an already occupied agent.

## Audio connection checks

The production bridge now resolves configured UUID prefixes through the authenticated website callback when an explicit AGI registration is absent. It retries a temporary startup response using the same admission event ID. Native identity linking continues with bounded backoff while the audio call is active. A rejected or empty lead API response can use the existing authenticated lead readback. These changes require the AudioSocket connection to actually reach this bridge.

On the Asterisk host, use the installed protected JSON config with the supplied read-only diagnostic.

    python3 deployment/vicidial-bridge/check-link.py /etc/shahvex-vicidial.json

For the screenshot's Olivia line, verify the configured website prefix / extension 3548 and remote user 78618 against the actual dialplan. Every other line needs its own exact mapping. The native dialplan must route the intended customer audio to the production AudioSocket listener with that line's UUID prefix, or perform the existing signed AGI registration. A native API connection by itself cannot create this audio route. Avoid placing real secrets in command arguments or screenshots.

During a real call, the diagnostic should show the expected prefix, an active call ID, increasing input bytes when the customer speaks, and increasing output bytes while AI speaks. The website should show the linked AI transcript and listening controls for the same native call. If only a native observation exists and no bridge stream exists, inspect the actual Asterisk extension route and bridge network/service logs. If a stream exists with AI speech but remains unlinked on the website, inspect exact remote-user, campaign and native lead/caller-code readback.

The warning remains visible when audio genuinely is unavailable. The live Asterisk installation, actual network routing and production database were not accessible during this update. Successful integration of every real call still needs live verification.

## Expected conversation behavior

- An introduction interrupted by a greeting or listening signal is rephrased with the configured identity. The next listening response moves to a naturally summarized, script-based purpose.
- A greeting or listening signal during an interrupted question triggers a shorter rephrasing of that same question. Its original question identity is retained for subsequent answer tracking.
- After three seconds of quiet following completed playback, the unanswered question is rephrased once. Further three-second quiet windows ask whether the customer can hear, give an are-you-still-there warning, then play a polite goodbye and close after playback. Speech cancels the pending silence close.
- A separate 30-second initial-response deadline protects a silent opening whose stream never finishes. A recognized customer reply disables that deadline.
- The first hangup / end-the-call request, including end-the-call-now and hangout variants, receives one addressed two-minute invitation. A repeated request or refusal closes immediately with no new spoken line. A listening reply while this invitation is pending resumes the saved business question, or explains the purpose if no question was pending. Do-not-call and removal requests retain immediate closure.
- Sir / ma'am follows an explicit customer preference or an explicit male/female statement in the transcript. When that information is absent, this version uses Sir by default. It does not infer gender from audio.
- The handoff intent and transfer implementation files are preserved. The callback and control handler now also submit a native HANGUP command for the exact linked customer call, including a durable retry after the AI audio leg has closed. Pending or submitted handoffs continue to block new conversation turns.

## Live acceptance calls

Use one mapped free AI agent and one human agent in the configured transfer group. Check an interrupted opening, an interrupted business question, an answered rephrased question advancing to the next question, the full quiet sequence, a repeated hangup during the two-minute invitation, a direct human-transfer request, and an accepted transfer offer. Repeat on each configured audio line before scaling concurrency. A busy AI agent must not receive another active call.

Rephrasing and purpose generation were checked through the normal tester entry with mocked model/audio responses. Actual wording and voice behavior depend on the running model and STT/TTS services and still require live listening.

The three-second value starts the recovery request after completed playback. Actual rephrased speech also needs model inference and TTS time. A hard three-second maximum of audible silence was not demonstrated on the user's physical server.

An immediate customer end stops queued speech and closes the local audio leg without waiting for a slow native callback. Its native hangup event remains durable until acknowledged. If native identity is missing, the server reports a pending native hangup and retries rather than targeting another call. End-to-end caller disconnection and final website status still require a live test against the installed dialplan and VICIdial API.

## V4 recorded-call corrections

Native calls acknowledge completed PCM playback using the exact completed turn ID. A generated intro whose audio was interrupted is rephrased before purpose progression. Stale acknowledgments cannot mark another turn heard. The browser tester retains its existing interruption mechanism.

Repeated listening signals return to the unanswered question in fresh wording, or continue the next applicable script step. Stock model replies such as I am here and listening are filtered. Clarification is allowed only for an actual customer question, never a greeting, ordinary answer, or hangup request. Why-transfer questions receive a fresh script-grounded explanation before consent handling. A declined connection is tracked so routine handoff offers do not immediately repeat.

Restart the Next.js website, shared tester service and production AudioSocket bridge after replacing all matching paths. The diagnostic above must print conversation revision REC382-385-388-v4. The shared tester /internal/status and turn timing flow-ready event also expose this revision. If missing or different, inspect the installed source path and restarted process before judging a new call recording.

The package contains complete replacement files and cumulative earlier linking, silence and hangup changes. Back up your current matching files before replacement. Keep deployment environment/config files as configured.
