# Live monitor per-call controls — 17 November 2026

Deployed build: `.next-live-call-controls`.

The admin and BPO live monitors have an individual End call button beside each live conversation, plus End call, recording Stop/Start and recording Download controls in the selected conversation. Actions capture the selected call ID; they do not stop agent queues or other calls. Failed actions retain the current state and show an error. Hangup remains pending until the media/provider confirms closure.

Campaign actions reuse existing authenticated, ownership-scoped call endpoints. Direct AudioSocket hangup closes only the selected media leg so its dialplan can hang up the customer. Native calls retain their existing exact-call control. New local test control/download routes authenticate the configured bridge owner, require same-origin POST requests, validate UUIDs, verify the requested call belongs to that owner's configured test bridge, and sign loopback-only bridge requests.

Recording controls operate on the bridge's AI recording. Stopping skips all subsequent captured samples and atomically publishes a valid stereo WAV snapshot; it leaves playback and the call running. Starting resumes capture into the same recording without adding samples from the stopped interval. Downloads use authenticated proxies and become available after Stop or call completion. While recording has resumed, the last stopped snapshot remains downloadable until a new snapshot/final file is published. Native dialer recording remains independent; the UI explicitly describes this scope. Handoff still permanently finalizes the AI recording, and controls reject released AI legs. Recovery prefers the unfinished file over an older stopped snapshot so resumed audio is retained after a crash.

Verification:

- Production build passed, including TypeScript checks.
- 37 regression checks passed: per-call isolation with two simultaneous synthetic AudioSocket legs; recorder stop/resume and crash recovery; bridge authentication; owner scoping; failure acknowledgments; voicemail and existing native-call regressions.
- Browser checks passed against the candidate and deployed website with intercepted fictional calls: per-call End, recording Stop/Start, download, failure feedback, unchanged second call, search/status filters, desktop/mobile layout and no horizontal overflow or browser errors.
- Deployment guarded by zero active/starting calls and zero connected media sockets on both bridges. Website and both changed bridge services restarted successfully. Adapter/routing settings and concurrency 101 preserved.

Screenshots: `artifacts/live-monitor-controls-desktop-20261117.png` and `artifacts/live-monitor-controls-mobile-20261117.png` under the workspace root. Screenshots contain fictional data. No customer calls were dialed or terminated during verification.

Post-deployment live API returned HTTP 200 with 14 calls and the expected recording/hangup fields. Read-only route checks returned 409 for 3531 and 3548 because their existing campaign assignments are disabled and runtimes OFFLINE (3531 pool ready=false; 3548 no pool entry). These queue/pause settings were not changed by this deployment.
