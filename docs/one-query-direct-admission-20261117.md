# One-query controller audio admission — 17 November 2026

Latest real 3531 call before this change: AudioSocket accepted at 18:19:10 PKT, admission 3270 ms, first outgoing PCM 3641 ms. The user reported about seven seconds at the handset. Prepared speech itself was fast; serial database admission dominated the measured server path.

Added an opt-in controller direct-audio path that claims the durable connected event, validates current connection credentials and exact line mapping, checks enabled campaign/assignment and daily limits, locks the assigned agent/runtime, inserts one call, and reserves its runtime in one PostgreSQL statement. Duplicate event IDs and audio UUIDs retain existing deduplication behavior. Busy, paused, wrong-route, and revoked-credential cases cannot allocate a call. BPO uses the existing entitlement path. A failed reservation forces statement rollback rather than leaving an orphan call.

Voice-session attachment and media activation now share one atomic query. The existing separate readiness callback is skipped only on explicit mediaReady=true. The warm turn-signing cache still verifies the current encrypted secret in SQL before admitting any audio turn.

Activated `.next-live-onequery` via the website unit with SHAHVEX_DIRECT_ATOMIC_ADMISSION=1 and SHAHVEX_TURN_CONNECTION_CACHE=1. Other bridge/voice settings and concurrency 101 retained. Signed checks showed no active calls before activation; routes were warmed and confirmed ready before measurement.

Validation:

- Rollback-only PostgreSQL TEMP-table integration passed for one-query admission: exact mapping, duplicate event/UUID, busy instance, disabled assignment, daily limit, stale secret, wrong remote user, and BPO isolation. The fixture includes the actual runtime-to-call foreign-key relationship.
- Atomic media activation TEMP-table regression passed, including session attachment, missing voice, already activated, and ended calls.
- 29 native regressions and four audio-latency/signing-cache regressions passed. Production build/type checks passed.
- Real internal production AudioSocket test on 3531 only after native user 78601 reported READY. No phone dialed and no customer speech sent. First PCM 1184 ms; first audible PCM 1325 ms. Bridge corroborated admission 995 ms and first PCM 1183 ms. Test leg cleaned up and both route checks returned 200.

Evidence: restore/reports/production-opening-without-hello-20261117.json. This is AudioSocket-to-audible-output timing, not handset answer-to-ear timing. The latest seven-second handset report preceded this deployment; a fresh handset test was requested. A first-second handset guarantee has not been established.

Rollback: remove SHAHVEX_DIRECT_ATOMIC_ADMISSION to select the existing admission path; the production build is retained. No permanent schema migration was introduced.

## Follow-up after original database recovery

The user canceled database migration and restored the original Neon compute allowance. Existing DATABASE_URL remains selected; NEW_DB_LINK was not activated and no data was copied. Old database connectivity and 52 public tables were verified.

Additional consolidation in `.next-live-direct`: current prefix readiness is returned with the authenticated connection read; voice allocation, media activation, and successful connected-event completion commit in one atomic query. Temporary PostgreSQL regressions and all 29 native regressions passed; production build/type checks passed. New internal production 3531 measurement: admission 718 ms, first PCM 930 ms, first audible PCM 1070 ms. No customer speech or external dialing was used.

User confirmed the delayed handset test was a normal automatic DIALER call, not a SHAHVEXAI transfer. Read-only native checks verified remote 78601 ACTIVE, one line to 3531, on-hook=N. SHAHVEXAI has no-delay=N, but that group was not changed because it is not the confirmed outbound path. Native API callid_info on the historical ended call returned custtime=0 and did not provide answer-to-transfer timing. Read-only Reports index has outbound aggregate/export reports but no exposed AGI/CDR timing-log link. No additional native routing changes were made. A first-second handset guarantee is still not established; remaining upstream time requires a fresh real call and/or native PBX answer-to-route logs.
