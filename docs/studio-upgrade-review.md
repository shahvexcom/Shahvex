# Local Voice Studio: continuity, session scripts and local recordings

## Reliability first — physical acceptance is pending

The previous physical multi-turn patch is not verified. Source changes here do not update the running C:\Shahvex-AI gateway. Source-confirmed causes/risks remain: the old browser closed all resources after a single turn-error; native Whisper may continue after cancellation and reject new admission; a 120s whole-stream backend deadline cut off longer sessions; Chatterbox's response writer mishandles WinError10053; its text input is limited to350 characters. No original STT status/log identifies the exact physical failure yet. New stage/httpStatus diagnostics must be collected before asserting its cause. Headphones remain required to minimize self-interruption; browser AEC is not guaranteed echo removal.

Repository now keeps recoverable turn errors visible without ending the session, skips LLM/TTS on empty STT, retains bounded histories and generation cancellation, and allows the local browser rehearsal up to10 minutes. The ordinary CLI keeps its existing120s deadline. Native-worker overlap remains prevented by the wrapper's admission lock and Gateway bounded worker queue; only explicit429 rejection retries. A resumed utterance is a new request, not replay of an uncertain transcription.

The ten-turn HTTP-stream fixture asserts one uninterrupted session/connection, retained context, fourth-turn interruption, subsequent replies and cleanup. Separate tests exercise empty STT, failure/recovery and script isolation. This is not proof that physical microphone interaction is reliable. First run the original assigned-script/headphones test for10 spoken turns **before** testing custom scripts or recording.

## Session-only script editing

Opening the modal loads the current assigned script using the existing approved-agent export after unchanged admin/local checks. Editing is disabled while a conversation runs. Start snapshots the selected custom content into a fresh Gateway session; editing later requires Stop/restart. Reset restores the assignment. The API reads/writes no permanent agent/script/lead configuration.

Custom instructions may change persona/goals/style for this local session but cannot remove the approved requirements. The server constructs an explicit approved-requirements block plus custom-test block and mandatory disclosure/no-invention rules. Total effective script remains capped at16000 characters; combining a long assignment with a long custom script can be rejected rather than truncated. These prompt constraints are not a formal guarantee of model compliance; test instructions against the approved script. There is no automatic semantic compliance verdict and no automatic lead-sheet row selection.

## Browser-only two-way recording

Opt-in only: check participant consent, then Start Recording while the conversation is active. Browser MediaRecorder receives a Web Audio destination fed by microphone→mute gain and scheduled AI sources→playback analyser. Those same AI sources feed the speakers; scheduled starts, pauses and stops therefore exist in the same audio timeline, including barge-in cancellation. No TTS chunk concatenation or microphone-only export is labeled as a conversation. The output is a mixed WebM/Opus recording (MP4/M4A fallback if supported). Separate tracks are not implemented in this version.

Mute sets both uploaded PCM and the recording's mic gain to silence; AI playback remains in the recording. Speaker/mic meters read actual graph/input data. Stopping conversation finalizes recording; preview and Download remain until close. Close/unmount discards recording and revokes object URLs; download before closing. Recording is limited to20MB and the10-minute rehearsal duration, kept only in browser memory; nothing is uploaded, stored in DB or sent to third parties. Browser codecs/devices still need physical playback/download verification. MediaRecorder unit tests use event fixtures and do not certify real sound synchronization.

## Physical deployment package

`dist/Shahvex-Studio-Review-v1.zip` refreshes the reviewed Gateway files (core.cjs, audio-stream.cjs, services.cjs, text-chunks.cjs) and contains the separate optional Chatterbox HTTP-handler patch. Manifest includes current reviewed physical original hashes and new hashes. No secrets, private contract or model files. The builder reads physical sources only to establish review baselines; it does not write them.

Use the exact staged verification/backup/restart/rollback procedure in `docs/multiturn-physical-review.md`, substituting **Shahvex-Studio-Review-v1.zip** and its newly delivered hash. Its manifest/path structure is unchanged. Do not apply both old/new bundles sequentially; apply only the current reviewed bundle against matching deployed hashes. Stop/restart only Gateway when applying Gateway files. Optional Chatterbox handler change requires its own reviewed stop/restart; do not touch Whisper/Ollama/model files. Repository website changes require only Next.js restart in the existing environment. No deployment is performed automatically.

## Local setup and browser acceptance

Keep physical AI services running. Restart only the existing Next.js terminal if needed:

```powershell
Set-Location P:\shahvex
$env:SHAHVEX_LOCAL_VOICE_TEST='1'
$env:SHAHVEX_GATEWAY_URL='http://127.0.0.1:8787'
if([string]::IsNullOrWhiteSpace($env:SHAHVEX_GATEWAY_TOKEN)){throw 'Provision the existing Gateway token privately; do not generate a new one'}
npm run dev -- --hostname 127.0.0.1 --port 3000
```

1. Use current Chrome/Edge on the same Windows PC with headphones. Sign into the local controller and select Jennifer's Voice Test. Require availability enabled/configured true.
2. Assigned mode first: verify displayed script matches assignment; start, grant mic permission, ask10 sequential questions with endpoint pauses. Include “How are you?”, “Who are you?”, script-related questions, interruption mid-reply and a context follow-up. Microphone must remain active after every reply. Empty recognition returns Listening. Recovering identifies an utterance failure; pause and speak again. Capture code/status/turnId if it repeats.
3. Check history by asking a follow-up that refers to an earlier synthetic fact. Do not use real customer data. Verify no stale audio resumes after interruption.
4. Stop. Change only the temporary script's tone instruction, restart and check Custom Test Script indicator. Stop/reset/restart; confirm the approved assignment never changed. Do not attempt mid-session script edits.
5. With all participants' consent, Start Recording. Say a sentence, wait for AI, mute and verify mic silence, unmute, interrupt a reply, then Stop Recording. Preview/download WebM; listen to **both** sides with real pauses and interruption. Recording starts at explicit opt-in, not retrospectively. A finished preview cannot be uploaded by this feature.
6. Start/Stop again, then close; confirm browser microphone indicator disappears and Gateway health eventually reports activeSessions0 / queue active0 / pending0. Download before closing; reopen must not retain old audio.

Capture Gateway turnId stages and browser `[Shahvex voice timing]` console metadata, never token/script/audio text in logs. Measured physical TTS remains **3.643s for73 characters** from the supplied log. All other stage metrics/acoustic delay and targets are pending measurement; scheduled playback is not proof of audible onset. No inference options/weights, voice profile, speaking rate or approved script changed. No sub2s response or100-call claim.

## Changed files and checks

- Browser modal/CSS: script controls, mixed recording/consent, preview/download, actual speaker meter, cleanup.
- `lib/browser-conversation-recorder.ts`: bounded local recorder lifecycle/export.
- local voice API + `gateway/test-script.cjs`: bounded authenticated custom-session composition, read-only assigned script load.
- relay:10-minute bounded local rehearsal deadline; core:empty transcription skip.
- tests:10-turn stream continuity, empty/failure recovery, assignment/custom/history isolation, recorder export/discard, auth/limits, modal/microphone cleanup.

Run `node --test tests/*.test.cjs`, `node node_modules/typescript/bin/tsc --noEmit --incremental false`, and the optional packaged handler check after generating its bundle. Automated results do not replace the physical10-turn/recording acceptance test above. Local restrictions still block Vercel/Railway and public hosts; no real telephony is enabled.
