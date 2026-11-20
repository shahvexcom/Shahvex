# Shahvex V9 — recording 409: opening, latency and question progression

Apply this update over V8. Six changed runtime files are included, complete and ready to replace, plus eight regression-test files. Preserve the paths. The V8 health-side-topic helper remains required and is not changed in this ZIP.

## Install

Finish active calls, then replace the included files in your existing project. Run:

```bash
cd /home/syed-nazeer-ahmad/shahvex/restore/website/Shahvex
npm run build
```

After a successful build, restart the website, shared tester and campaign bridge using your existing launcher. Building does not restart running workers, and restarting alone does not rebuild Next.js. Your existing credentials, launcher, model services and dialplan are not replaced.

Then run:

```bash
python3 deployment/vicidial-bridge/verify-live-flow.py
```

Expected revision: REC409-v9. Check the running tester and website build, then during a FRESH call check the active voice-worker revision (or bridge log “Active call voice flow revision”). Tester/build matches alone do not prove which worker handled a call. For customer-first calls the voice-worker marker may appear only once the customer speaks.

## Requested flow

- Customer-first: no opening speech before customer input. The bridge honors the configured first speaker, and the shared handler also guards against an accidental opening request.
- First customer input routes to the configured introduction. A flexible intro interrupted before playback completion restarts as “Hi, this is [name] from [company]. How are you doing today?”; configured mandatory wording remains authoritative.
- Acknowledgment after completed intro produces the actual configured purpose, followed by one brief permission question. When a usable purpose sentence is available in the script/goal, this path does not need an LLM call.
- The next acknowledgment starts the first business question; subsequent answers/acknowledgments advance to the next unasked applicable question. Okay/Yep/Hmm/Mm-hmm can be acknowledgments in context. A raw acknowledgment is never turned into an invented numeric age, name or location.
- Automatic question repeats on silence are disabled. The existing presence/end sequence remains. An actual customer question is answered and joined back to the pending question; this intentional resume remains available, as does an explicit request to repeat.
- The first routine transfer line is declarative (“Let me connect you …”), without an added permission question. An affirmative reply after an actual transfer offer is accepted without extra speech. Native transfer execution code is not changed.

## Delay repairs

The previous bridge performed early speech probes, then a final probe with a semantic model classification and potential extra holds. V9 removes the early probes and the final semantic model gate. Normal speech uses one final recognition pass (recognizer empty/error recovery may still retry).

The native speech-end boundary is fixed at 350 ms, including when an old launcher passes 1000 ms. New voice before the boundary resets it. This is a practical speech boundary, not a guarantee of understanding arbitrary pauses; a pause longer than the window can end an utterance. No model-driven 30-second incomplete-thought hold remains in this path.

A more direct playback bug was also repaired: the recognizing flag used to remain set while the entire response was synthesized. That prevented already-ready PCM from playing. Recognition is now released before reply generation; the speech decision queue also stops waiting for the old reply's entire synthesis stream. A new utterance can therefore be recognized and interrupt a still-open response stream. The existing 120-ms minimum voiced admission and 350-ms recent-voice guard remain.

The final speech-probe transport deadline is 3 seconds rather than 8 seconds. Failed/empty recognition retains V8's original-waveform fallback and protected diagnostic counters. Actual STT/model/TTS compute or network latency can still add time; this patch does not promise a sub-second physical-service response.

## What is unchanged

No model or Whisper weights/settings, voice selection, telephony credentials, VICIdial commands, database schema, agent configuration or UI files are changed. Existing hangup confirmation, repeated-stop behavior and V8 health replies remain. The changes are in turn routing, playback admission, the first-speaker guard and conversation progression.

## Validation

66 focused tests passed, plus three existing native handoff tests. These include actual shared-handler dispatch, complete interrupted intro recovery, customer-first silence, purpose before screening, one question per acknowledgment, no silence repeat, health/identity resume, silent transfer acceptance, and real local-socket bridge playback before synthesis completion. A still-open synthesis stream is interrupted by the next utterance in the native fixture. Test transport/model/STT/TTS responses are fixtures; these are not calls on your physical setup.

The old tests that required semantic pause holds, automatic silence repeats or a purpose LLM call were updated to the requested V9 behavior. The previously reported unrelated handoff consent-mode label mismatch remains outside this patch; the selected real-command handoff checks pass.

Recording 409 was reviewed using local transcription assistance on both audio channels. It contains caller greetings/identity-purpose questions and an opening “I'm here and listening” response. Transcription timings are coarse and not a calibrated latency benchmark. The code paths above provide concrete explanations for added delay; the complete production cause still needs the fresh-call check.

No full Next production build, deployed worker restart, or live VICIdial/model call was performed here. Run the build and verification on your device.

## Fresh call checklist

1. Set customer-first, connect, and remain quiet briefly: no agent intro should start.
2. Say Hello: hear configured intro. Say Hello during it: hear full restarted intro with wellbeing question.
3. Acknowledge intro: hear purpose. Acknowledge purpose: hear first question, then progress through questions once each.
4. Ask a real question midway: hear its answer and pending question; answer it and progress.
5. Accept the transfer statement with Okay/Yep/Mm-hmm: no extra spoken line before the existing transfer process.
6. If delay remains, share a fresh recording plus verify-live-flow output. Check recent speech diagnostics for failed probes or audio_turn_failed rather than replacing more files blindly.
