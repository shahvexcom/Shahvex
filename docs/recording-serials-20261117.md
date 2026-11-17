# Persistent recording serials — 17 November 2026

Deployed build: `.next-recording-serial`.

Each database call has a unique, durable numeric recording serial displayed as `REC-000123`. PostgreSQL identity allocation assigns existing and new calls; a unique index enforces uniqueness. Stop/Start and call completion keep the same serial. Re-running schema initialization does not renumber calls or reset the sequence. Numbers may have gaps because calls without a saved recording also receive an identifier. The additive migration assigned 148 existing calls 148 unique serials, with zero missing values and the same row count. It used a transaction, a 3-second lock timeout and a 30-second statement timeout after both bridges reported zero active/starting/connected media calls.

The live monitor shows the serial and a Copy serial button. Its conversation search matches serials. A separate Find recording by serial form performs an exact indexed lookup over all call history, including records outside the monitor's recent-call window. The result links to the call details and authenticated recording download. Call details, recording players, ended-call/history lists, archive reports and Quick Dial history also show serials. Local test recordings, which have no database call row, display a stable `LOCAL-<full call UUID>` reference.

Downloads use `recording-REC-000123.wav` (or the original provider audio extension) and an `X-Recording-Serial` response header. The live monitor uses that serial in its browser download filename. Existing recording storage paths remain mapped by their recording ID in the call row, so serial lookup resolves the actual saved recording without needing an uploaded copy. Local test downloads include their full local reference.

Lookup endpoints: `GET /api/admin/recordings?serial=REC-000123` and the BPO equivalent. They require the appropriate session, enforce the existing admin/BPO call boundary and own-user Quick Dial ownership, return 404 for inaccessible or missing serials, accept only bounded bigint serials, and return portal-relative links rather than storage addresses or credentials. Neither lookup nor download places or controls calls. Manual/native recording audio still comes through the existing authenticated proxy.

Validation:

- Production build and TypeScript passed.
- 46 tests passed, including a real PostgreSQL TEMP-table migration followed by rollback: backfill, automatic numbering of 100 new rows, uniqueness, and idempotence. Unit/integration checks covered exact bigint formatting, invalid references, portal ownership, serial filenames and headers, and existing call/listening/recording/voicemail behavior.
- Browser fixture checks passed for display, clipboard copy, serial search, an older recording outside the listed calls, missing serial feedback, serial download filenames, desktop/mobile layout and existing controls; zero page errors and zero microphone requests.
- Read-only verification used actual saved recording `REC-000005`: exact lookup resolved the correct call, a range download returned HTTP 206 with a valid WAV header, and the filename/header matched its serial. An unknown serial returned 404.

Screenshots at workspace root: `artifacts/live-monitor-recording-serial-desktop-20261117.png` and `artifacts/live-monitor-recording-serial-mobile-20261117.png`. Screenshot call details are fictional fixtures.
