# Browser interruption recovery

The user's report of an unsolicited Interrupted status followed by silence after
roughly two minutes has not been reproduced with their microphone or Lissa engine.
There is no evidence here of a fixed two-minute timeout.

Source changes:

- Invalidating an unplayed speculative draft now displays Listening. Only queued
  or playing audio produces the Interrupted status.
- Cancellation acknowledgements have a three-second deadline. Network failures
  and BUSY acknowledgements allow the next turn to use existing server admission
  and bounded BUSY retries. Authorization/session errors remain visible. Consumed
  cancellation promises and new sessions no longer inherit an old rejection.
- Speech finalization now waits 300 ms of silence instead of 500 ms. The 100 ms
  speculative draft start, 200 ms playback barge-in gate, echo rejection and
  minimum voiced duration remain. Pauses longer than 300 ms can split speech;
  validate this tradeoff with the user's speaking cadence.

Validation: 17 targeted tests and TypeScript passed. The existing Chrome worklet
test measured 216 ms synthetic speech to clear, silence within its 25 ms check,
rejected old audio and successfully resumed next-epoch audio while cancellation
was still pending. These are browser fixtures, not physical microphone or Lissa
end-to-end measurements. An outdated route-test module loader was repaired so
the input/session regressions exercise the current speculative wrapper.

No TTS engine, voice reference, prompt or deployed service was changed. The
configured silence wait is 200 ms shorter; this does not prove an equivalent
end-to-end speedup or a one-second response. A real multi-minute Lissa call and
speech-end-to-audible-response measurements are still required.
