# Silent voicemail termination and live monitor refresh — 17 November 2026

Activated `.next-live-voicemail` in the website service, with the updated adapter and campaign/manual bridges. Original database, route mappings, concurrency 101, voice configuration, and fast admission/signing-cache settings retained. Signed checks showed no active calls/sessions before rollout; both route checks and all bridge/adapter health endpoints passed afterward.

Voicemail:

- Expand recognized machine greetings to explicit voicemail/mailbox introductions, full/unconfigured mailboxes, record-after-tone prompts, named recorded greetings, and inability-to-answer/message prompts. Keep human questions, reported speech, and personal mailbox discussions outside automatic machine classification.
- Shared session emits end_call(reason=voicemail) without model inference, synthesis, reply text, or PCM.
- Native bridge immediately clears queued/carried speech, cancels synthesis and recognition progression, and requests customer hangup. It does not wait for queued playback. Early speech-recognition probes and full overlapping-utterance recognition independently classify voicemail from recognized words rather than trusting a supplied interruption label.
- Voicemail is terminal for the audio leg: suppress subsequent utterance processing, silence reminders, and later model turns even if native hangup must retry. Preserve the hangup request durably on failure. Browser tester stops capture/playback on the same voicemail event.
- Classification requires recognized machine wording; this is not a guarantee of detecting every possible recording or suppressing an intro already sent before voicemail was recognized. No new carrier/real voicemail call was placed.

Monitor:

- Shared admin/BPO component has a new responsive operations layout with live/recent call metrics, campaign/local source tabs, agent/customer/extension search, live/ended filters, selected-call details, readable agent/customer bubbles, auto-scroll, and useful empty/error states.
- Pakistan timezone is explicit in the sync clock. Technical transport labels were removed from the main conversation header; campaign, extension, remote user, and call state remain visible.
- Scope monitor styles to prevent the shared raised beige theme from overriding flat transcript surfaces and the search field. Existing API authorization and source isolation remain unchanged.

Verification:

- Two machine-greeting classification tests, four immediate-end/probe/failed-hangup regressions, and 29 native regressions passed. Tests verify zero model/TTS/reply events, clearing long playback queues, ignoring late PCM, early recognition while audio is still being captured, and continued silence after a failed hangup request.
- Production build and TypeScript passed.
- Running adapter synthetic greeting checks emitted only user/end_call/done, with zero delta/PCM, in 5–6 ms after supplying recognized text. These are post-recognition timings, not carrier-level detection timings.
- Actual deployed UI checked at 1440 px desktop and 390 px mobile with fictional call fixtures in an isolated authenticated browser context. Search, filters, auto-scroll, and empty state passed; no horizontal overflow or browser errors. No test calls were written into the production monitor API.

Artifacts: `artifacts/live-monitor-desktop-20261117.png`, `artifacts/live-monitor-mobile-20261117.png`, `artifacts/live-monitor-empty-20261117.png`, `restore/reports/voicemail-live-verification-20261117.json`.
