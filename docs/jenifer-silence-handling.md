# Conversation repetition and silence handling

The shared local/PC tester prompt now prohibits unsolicited repetition of identity,
purpose, goal, tasks, offers, answered questions and the customer name. A volunteered
name may be acknowledged once. Explicit requests to repeat or clarify remain valid.
Unclear input asks one targeted clarification; validated speech with an empty STT
result receives a fixed clarification through the selected voice, without a fake
customer transcript.

The browser tester measures continuous listening time. After ten seconds it requests
one of three distinct presence checks. Each check is followed by another ten seconds
of listening. After the third unanswered check and its final ten-second grace period,
the server synthesizes goodbye and emits `end_call`. The browser waits for processing
and queued playback to finish before running its existing stop/recording cleanup.
Confirmed customer speech resets the sequence and cancels a pending goodbye.
Processing, playback, active speech, mute and suspended audio restart the listening
window without spending an attempt. Stop/unmount clears the timer.

Presence events use the authenticated existing turn endpoint, validated numeric steps
and server-owned text. They bypass model inference, use the existing cancellable PCM
stream, and are never stored as customer speech. The browser owns the acoustic timer;
this endpoint is not an independent server-side inactivity monitor.

Scope: AgentTestPanel using the local or PC tester, including demo sessions on that
path. The older `transport: shahvex` audio-only gateway and actual telephone hangup
adapters do not use this timer. Deployment of the changed browser and tester services
is required; saved agent scripts are not modified automatically. The revised script
is supplied separately in `jenifer-revised-script.txt`.

Verification: deterministic clock tests, mock-engine tester integration, interruption,
clarification, streaming and speculative capture/session tests. These verify runtime
behavior and transport, not live model obedience, real microphone acoustics or a
production telephone call.
