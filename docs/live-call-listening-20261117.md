# Receive-only live call listening — 17 November 2026

Deployed build: `.next-live-listening`.

Every answered call has a headphone/Listen live button in the conversation list and a Listen live / Stop listening control in the selected call. Starting another listener stops the previous one and selects that conversation. Changing call/source, navigating away, call end and AI handoff close the listener. Connecting/error/listening states are visible. Browser AudioContext starts from a user click and plays the customer and AI audio together. The listener never requests a microphone, creates a browser media input, uploads audio, or issues a call-control command.

The bridge copies the existing 20 ms customer and actual AI playback frames to a separate authenticated GET stream. The capture tap is independent of recording, so Stop recording does not stop listening. The observer does not alter AI queues, turn state, hold state or the customer socket. Slow listeners are disconnected once their output queue exceeds 16 KB; that listener's backpressure never delays customer audio. Streams are bounded to eight listeners per call, 64 per bridge, and 15 minutes per connection. Reconnecting is a user action. No past audio is replayed. The browser caps playback buffering and drops stale network chunks to avoid accumulating delay.

Admin and BPO GET endpoints enforce portal authentication and per-call ownership before proxying. Local test routes verify the authenticated owner's configured loopback bridge and active test call. The Node proxy signs each request, pins the resolved allowed host, forbids redirects, forwards no bridge credentials to the browser, disables caching/proxy buffering and destroys only its own upstream when the browser stops. AI handoff ends listening at the AI leg; this does not monitor the subsequent human-agent call.

Verification:

- Production build including TypeScript passed.
- 42 regression tests passed, including both speakers in PCM, unchanged customer audio, two-call isolation, listener disconnect, listener limits, bad signatures, non-GET rejection at the bridge, call-end cleanup, slow-listener dropping, portal/ownership checks, receive-only browser player, zero microphone calls, and proxy cancellation. Existing voicemail, hangup and recording tests passed.
- Candidate browser checks used fictional calls and synthetic audio: real AudioContext scheduled samples; Play/Stop and switching worked; zero microphone requests; all audio requests GET without an upload body; no browser errors; desktop/mobile checks passed without horizontal overflow. Existing recording and per-call End controls were also exercised with intercepted fictional actions.
- Deployment required zero active/starting calls and zero connected media sockets on both bridges. Website and both changed bridges restarted successfully. Adapter and concurrency 101 preserved. No customer calls were made by tests.

Workspace screenshots: `artifacts/live-monitor-listening-desktop-20261117.png` and `artifacts/live-monitor-listening-mobile-20261117.png`; all displayed customer details are fictional test fixtures.

Post-deployment browser checks passed against port 3000 with the same receive-only/switching assertions and zero microphone requests. Both production portal endpoints returned 401 without authentication; both updated bridges returned 409 for a signed nonexistent call ID. No live call was controlled by those checks.
