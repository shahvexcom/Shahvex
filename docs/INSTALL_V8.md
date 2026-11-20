# Shahvex V8 — listening recovery and health side replies

Apply over the V7 files. This ZIP contains 12 changed/new runtime files, three regression test files, and this guide. Each source file is complete. Keep the folder paths; gateway/health-side-topic.cjs is a required new file.

## What changed

The actual early fast-listen callback now forwards the final-turn flag and stable turn ID. The PC transport now accepts the existing playback-complete endpoint. A failed, malformed or empty final speech probe now retries the ORIGINAL caller waveform through the established audio-turn route instead of discarding it. Errors in that fallback preserve the call and record a diagnostic. These are verified code defects; the exact production failure still requires a fresh call and diagnostics.

Brief speech admission is 120 ms rather than 180 ms. Recent caller voice blocks the no-response timer, as do existing recognition/processing states. This does not force a response while speech is still being recognized.

“Are you drunk?” answers “No, I don't drink alcohol” with a brief accurate general health fact, then resumes the pending question. Smoking and meal side replies follow the same resume rule. No invented drinking, breakfast, personal meals or customer local time. General health answers state uncertainty when needed and do not diagnose or prescribe. Side conversation is excluded from qualification answers and native lead evidence; a genuine subsequent answer still advances the script.

Native transfer command execution is unchanged. Existing V7 intro and hangup behavior is retained. No dialplan, credentials, saved agent configuration or UI changes are included.

## Install on your device

1. Finish active calls. Copy the ZIP's gateway/, lib/, deployment/ and tests/ contents into the existing project, preserving paths and replacing the listed files.
2. In your project terminal run:

```bash
cd /home/syed-nazeer-ahmad/shahvex/restore/website/Shahvex
npm run build
```

3. After the build succeeds, restart the website, shared tester and campaign bridge using your existing launcher. Building alone does not reload running processes. Restarting alone does not rebuild the website. Do not replace the existing launcher/configuration.
4. Run:

```bash
python3 deployment/vicidial-bridge/verify-live-flow.py
```

Expected revision: REC402-403-404-v8. Tester matches and website build marker should match. During a fresh call also verify the active voice worker revision (or bridge log “Active call voice flow revision”); tester/build checks alone do not prove which worker handled a call. After the call the verifier can show a bounded recent speech report, including speechProbeFailures, speechFallbacks and lastSpeechIssue. If listening still fails, share that diagnostic output: audio_turn_failed means the original audio route also failed and needs backend/log investigation.

## Focused live check

- Say Hello during the intro, then answer naturally. Customer speech should appear and the existing introduction recovery should work.
- Speak a short Yes/Hello, then a longer sentence with pauses. Confirm it is heard and the bot does not issue no-response checks while recognition is in progress.
- Ask “Are you drunk?” midway through a question. Expect a truthful short answer and the pending question; that side conversation must not qualify as Yes/No.
- Test one existing consented transfer after the above. No transfer execution behavior was intentionally changed.

## Validation and limits

62 focused regression tests passed, plus three existing native handoff tests. Seven changed TypeScript files transpile without syntax diagnostics; changed CJS files pass node syntax checks and the verifier compiles. Callback/transport/model responses in these tests use fixtures; local bridge transport exercises real sockets. No full Next production build or live physical STT/TTS/VICIdial call was run here. Install, build, restart and fresh-call verification are required on your device.

Local transcription-assisted review of recordings 402–404 found caller Hello/Yes speech present in the recorded customer channel. This supports investigating the recognition/turn path; it does not by itself identify a single production cause or certify transcription quality.

General health fact references: WHO Alcohol https://www.who.int/news-room/fact-sheets/detail/alcohol ; WHO Tobacco https://www.who.int/news-room/fact-sheets/detail/tobacco ; WHO Cancer https://www.who.int/news-room/fact-sheets/detail/cancer .

Additional existing handoff suite: 15/16 passed. One pre-existing consent-mode label assertion expects CUSTOMER_ACCEPTED_HANDOFF but receives CUSTOMER_REQUESTED_HUMAN. Re-running that test with the original unchanged vicidial-results.ts reproduces the same failure. Transfer command tests pass; this unrelated label behavior was not modified.
