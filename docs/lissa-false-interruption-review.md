# False interruption and playback stalls

User reports silent audio after about a minute, an Interrupted status without
intentional speech, and clarification text. Service logs show completed Lissa
synthesis rather than a fixed 60-second timeout. Exact acoustic cause was not
reproduced using the user's microphone.

The browser previously interrupted after only 60 ms of detected speech during
playback, shorter than the 200 ms needed to accept a recording. Brief noise could
therefore cancel a reply without producing a usable replacement customer turn.
Playback now requires 200 ms of consecutive speech to interrupt and retains the
stronger threshold for 350 ms after reference audio. Preroll retains the onset.
This trades roughly 140 ms of barge-in responsiveness for fewer false triggers.

Player clear acknowledgement is now abortable and bounded. Backpressure detects
stopped context/processor or lack of progress instead of waiting indefinitely.
These failures surface visibly; they do not silently restart or change the voice.

Validation: capture and player regression tests pass, including repeated 160 ms
noise bursts, correlated echo, continued real speech and abort during a missing
worklet acknowledgement. A real Chrome interruption test measured 208 ms to
clear, rejected old audio and resumed subsequent audio. A synthetic browser-only
soak ran 75 seconds/75 playback rounds without losing audio. It is not a complete
microphone-to-Lissa call test. TypeScript passed. No engine, prompt, reference
recording or voice synthesis settings were changed. Reload the localhost page
and start a fresh session to use the updated browser code.
