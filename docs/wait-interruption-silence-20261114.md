# Wait requests and no-response timing

Both native and tester capture retain 600 ms pre-roll and finalize only after 700 ms of quiet. This preserves leading words and half-second pauses. Semantic probes and normal audio turns use the same recognition helper. A filler/backchannel result after sustained speech gets one padded-waveform retry; a fuller meaningful result replaces the suspicious short result, without merging or inventing transcripts. A failed retry preserves usable original text.

Pause requests such as “wait a second” are meaningful interruptions. Native/browser playback decisions recompute the class from transcript text rather than discarding the request on a supplied filler label. The dialogue replies “Of course, take your time.” without asking another qualification question in that turn.

Shared native/browser timing is 5000 ms → reminder, 4000 ms → reminder, 3000 ms → goodbye, 5000 ms → hangup. Windows begin after the prior playback/processing finishes. Speech resets the sequence and cancels hangup; transfer-waiting suppression remains intact. Final TTS emits no_response/end_call with delayMs 5000; the audio owner performs delayed hangup, not the model.

Verification: 46 speech/silence/capture/voice tests passed including a real local AudioSocket timing run (about 17.5 seconds with short reminder audio). Additional bridge lifecycle, requested handoff and persistent adapter suite: 19 passed, two opt-in skips. TypeScript passed. Synthetic local Lissa audio reduced to 8 kHz telephone bandwidth then fed to recognition retained wait, hold-on and Medicare/Medicaid phrases. This is not a real-caller accuracy benchmark. Restarted adapter smoke verified recognized wait text, meaningful interrupt kind, Lissa acknowledgment PCM, and goodbye delayMs 5000. Reports: restore/reports/wait-recognition-smoke-20261114.json and wait-adapter-verification-20261114.json.

Adapter and bridges were activated only after zero sessions, busy calls, starting calls and audio connections. Concurrency remained at the user's current 101; voice engines and settings were retained. No customer calls were originated.
