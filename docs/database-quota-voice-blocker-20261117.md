# Database quota blocker during voice-latency work — 17 November 2026

User reported approximately six seconds at the handset after one-query admission was activated. Latest completed real customer call in the inspected recording directory is 35318501-78bd-415f-a894-dc4d21c581c2, accepted by the audio router at 18:30:15 PKT. Production bridge measured admission 1290 ms and first PCM 1506 ms. This does not prove handset answer-to-ear latency; several seconds of the user-reported wait remain outside that measurement.

At inspection around 19:24 PKT the running website was receiving PostgreSQL SQLSTATE 53000: “Your account or project has exceeded the quota. Upgrade your plan to increase limits.” The configured provider is Neon. Native callbacks were returning 503; voice bridges/adapter health remained 200 with zero active/starting calls and configured capacity 101. Fresh call admission cannot be treated as working while the database rejects connections.

Neon documentation confirms CU-hour/public-network limits can suspend compute and block connections with 53000. The error alone does not identify which quota is exhausted. Requested the user's Neon Usage screen status; no billing change, plan upgrade, project deletion, database replacement, or access-check bypass was performed.

Completed unaffected work: bounded saved-event retries and a background outage circuit on 429/5xx/network failures. Per-event retry grows from 10 to 60 seconds; background work pauses for 30 seconds on outage failures. A pending live sync event is reused rather than creating a new queued event on every retry tick. Fresh urgent lifecycle events can still attempt immediately; failed events stay durably queued. Maintenance backs off as well. No queued event was deleted as an outage workaround: 137 pending files before/after activation.

Validation: two new outage/backoff regressions and all 29 native regressions passed. Tests verify event retention, bounded attempts, sync-event reuse, and immediate delivery attempts for a new call-ended event despite background backoff. Activated campaign bridge after signed zero-active-call checks; service and health verified. No native campaign or routing change was made in this step. Website remains on `.next-live-onequery`.

Remaining work: restore database quota access through the owning Neon account, then verify a fresh real caller's answer-to-ear timing and investigate remaining native/transport delay. The first-second requirement is not marked achieved.

Primary provider documentation: https://neon.com/docs/introduction/plans#what-happens-if-i-exceed-my-free-plan-limits

## Subsequent recovery

The user restored the original Neon compute allowance and canceled the proposed database migration. The original DATABASE_URL was verified accessible with 52 public tables; both route readiness checks returned 200. No data was copied and NEW_DB_LINK was not activated. A further tested production build, `.next-live-direct`, combines prefix readiness with connection lookup and event completion with voice activation. Internal production 3531 test measured first PCM 930 ms and first audible output 1070 ms, without customer speech or phone dialing. Handset answer-to-ear latency remains unverified after this update. See restore/reports/database-connection-recovery-20261117.json.
