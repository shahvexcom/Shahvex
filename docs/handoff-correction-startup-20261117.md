# Recorded handoff correction and startup improvements — 17 November 2026

The user supplied a screenshot and reported a delayed initial greeting. Inspected the latest real 3531 recording (`3531019c-ef20-45dc-931b-6dd6e6d4fe4a.wav`) and saved conversation history. Re-transcribed the final customer channel locally. It contains the customer's correction about the offered licensed-person connection and waiting for it. Recognition also split/misrecognized speech around “licensed again.” The prior dialogue wrongly ended the call after “I won't do that,” replayed that goodbye as “My last point was…,” and generated a generic clarification instead of retaining handoff context.

Implemented and activated:

- Share contextual human-request reaffirmation between spoken responses, transfer consent, and requested-human eligibility. The exact recorded correction now retains the pending request. Questioning a transfer or explicitly withdrawing consent still does not authorize handoff.
- Handle connection acknowledgments/status before unrelated progression/fallback paths. While waiting, non-question fragments and vague acknowledgments do not restart the model, replay a goodbye, infer cancellation, or ask the customer to restate the purpose. Explicit cancellation remains supported.
- Limit the factual unconfirmed-connection status to one occurrence; never announce a successful native transfer without confirmation.
- Suppress generic “clarify what you'd like me to do” / “not sure I caught that” resets before model speech. Recovery cannot replay end-call/connection statements or speak after a final bye; handoff waiting never consumes generic clarification fallback.
- Activate direct media readiness during the authenticated connected event and return an explicit `mediaReady` flag. The bridge skips its redundant readiness callback only when that verified flag is true; other paths retain the handshake.
- Media activation is one atomic SQL statement with a locked candidate call, requiring an allocated voice session and RESERVED runtime. It updates the call and runtime together, and does not reactivate completed/previously activated calls.

Production build: `.next-live-final-conversation`, selected by the existing website unit drop-in. Website, adapter, campaign bridge, and manual bridge healthy; configured capacity 101 retained. Activated only after signed idle checks. 3531 and 3548 resolve checks remain HTTP 200.

Validation:

- 29 native/bridge tests, 15 requested-handoff tests, 22 streaming tests, two recorded-correction tests passed. PostgreSQL rollback-only TEMP-table integration verifies readiness activation and rejection of missing-voice, ended, and already activated calls. Production builds/type checks passed.
- The broader campaign-runtime suite has three unresolved failures in release, assignment, and merge-sync fixtures; it is not described as passing.
- Live synthetic voice session: explicit human request -> “Alright, please wait”; ambiguous fragment -> no new speech/end-call; exact recorded correction -> “I don't have confirmation of a completed transfer yet”; duplicate correction -> no repeat. No native human transfer or customer dial was possible in this synthetic adapter session.
- Tested an internal production 3531 AudioSocket leg only after native agent 78601 reported READY and both bridges had zero calls. Sent no customer speech and dialed no phone. First PCM 3056 ms; first audible PCM 3196 ms, improved from 4527 ms in the prior real call's bridge log. Internal test leg closed and runtime returned ready. Evidence: `restore/reports/production-opening-without-hello-20261117.json`, `restore/reports/live-waiting-correction-20261117.json`.

The user clarified that the reported nine seconds was from the previous call, not a fresh call after this deployment. No claim is made that customer answer-to-ear latency is now zero or that the old nine/twelve seconds has been verified resolved. A fresh handset call is still required. Internal AudioSocket timing excludes upstream native/carrier answer-to-AudioSocket delay. DIALER's separately approved routing extension remains 8368.
