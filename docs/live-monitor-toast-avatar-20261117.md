# Live monitor notifications, avatar photos and readiness audit — 17 November 2026

Final build: `.next-monitor-toast-avatar-final`.

The admin/BPO live monitor uses the existing global top-right toast provider for action progress, success and failure: call controls, current/archived recording downloads, serial copy/lookup, listening feedback, initial-script save/load errors and local-bridge connection actions. Transient action messages no longer render beneath the form or conversation. Connection failures produce a deduplicated toast while the feed badge preserves connection state. Transcript/listening state and lookup results remain visible because they are ongoing call information, not transient notifications. Download controls respect the server's original recording filename/extension.

The scoped monitor API now includes each agent's saved avatar. Both roster and conversation header display that photo, with a neutral user icon when missing or broken. Initial-letter placeholders were removed. All 20 mapped profiles have saved photos: 18 local assets exist and both existing Cloudinary image URLs returned HTTP 200 image/jpeg. No photos were changed.

Readiness audit (read only): extensions 3531–3550, 20 approved profiles, all mapped to the verified enabled direct AudioSocket connection and a configured voice. All 20 campaign assignments have intake_enabled=false. No profile currently passes enabled intake + ready pool + READY runtime checks; 3531 is also paused, pool_ready=false and runtime OFFLINE. One other runtime advertises READY but its disabled intake and missing pool still prevent admission. This is not an assertion that all 20 can receive live calls. Native remote-agent activation and handset audio were not changed or tested by the audit. Audio bridges and adapter are healthy with concurrency 101. Existing pause settings were preserved.

Verification: production build and TypeScript passed. Isolated browser checks used fictional calls with existing avatar images and synthetic audio: toast success/error placement, no inline action messages, saved photo loading and broken-image fallback, normal and archived recording downloads, clipboard/lookup, listening and per-call controls, desktop/mobile layout, no horizontal overflow and no page errors. Real production monitor API returned HTTP 200 with nine calls and nine avatar values. No customer calls were created or ended by these checks.

Workspace screenshots: `artifacts/live-monitor-toast-avatar-desktop-20261117.png` and `artifacts/live-monitor-toast-avatar-mobile-20261117.png`. Customer details are fictional fixtures.

Post-deployment verification of the final build passed all browser fixture checks, including the archived-result download toast. The real monitor API returned HTTP 200 with nine calls and nine saved-avatar values. Both bridges and adapter remained healthy; no agent intake or native activation setting was modified.
