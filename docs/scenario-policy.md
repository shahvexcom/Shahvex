# Native call scenario policy

The running assignment sampled for this change asks one business question about monthly money back on a card. The worker selects examples for the current attempted question from `gateway/scenario-catalog.json`. It keeps the assigned question order and uses the existing playback, native transfer and hangup paths. The catalog contains 88 rebate cases, 94 age cases and 93 coverage cases. Age and coverage examples apply when the assigned script includes the matching question. The catalog stays in memory and adds no model request or prompt expansion.

| Source example | Worker behavior |
| --- | --- |
| Bare “Hello?” or silence | Keep the existing silence clock and wellbeing check. A social answer acknowledges the caller and advances past the attempted business question. |
| “Can you hear me now?” or “Are you still there?” in a sample repeat reply | Omit the presence question. Replay the current scripted question after a qualifying request. |
| “Speak louder”, “speak slower” or “speak more clearly” | Replay once at the configured voice settings. The reply makes no promise about changing delivery. |
| Age estimates, uncertainty, objections and questions about Part B or the caller’s number | Retain usable information, supply grounded context and follow the script’s progression. These do not grant permission to repeat. |
| “I think so, can you check?” and “Let me check” | The first retains the tentative response and uses the native handoff. The second uses the existing customer hold handling. |
| Callback sample promising a future call | Report that callback scheduling is unavailable on this call. No confirmed native callback scheduler was found. |
| Do-not-call sample promising removal | Write the verified call lead number to the site’s existing suppression table and close the call. If the call has no verified number or the write fails, the worker still closes without claiming removal. Independent VICIdial dialer-list suppression requires a separate integration. |

The repeat counter is scoped to the call and applicable attempted question. Existing turn identifiers guard retried events. The first two requests replay the outstanding question, including only missing multipart values where applicable. A third request uses the existing announcement and playback acknowledgement to invoke the native executor. A direct request for a person can transfer before the count reaches three. Caller-supplied action tags have no execution authority.

## Verification

The production build completed with TypeScript validation. The worker and callback fixtures exercised all configured action types, including tentative answer retention, the hold path, duplicate turn handling, concurrent call isolation, and closing on an opt-out. The callback fixture verified the database suppression call and one native transfer submission after acknowledged playback. The AudioSocket fixtures covered native hangup, transfer drain, speech boundaries, eligible silence, and the script watchdog. Monitor and call-control fixtures also ran.

The broader fixture run had 72 passes and five failures. The five failures reproduced on the exact saved source for build `hH46KGm5egpxGPlpJhxhA`. They cover legacy branching, REC418 hangup and location assumptions, identity confirmation, and hearing recovery.

The loopback benchmark used the running adapter and candidate worker with the same assigned configuration. Five warm samples per worker measured the time from submitting the typed answer “No” to receiving first PCM. The deployed baseline samples were 4, 2, 2, 3, and 2 ms. The candidate samples were 3, 4, 2, 2, and 4 ms. The medians were 2 and 3 ms, within the spread of the samples. These measurements cover warm adapter response and exclude speech recognition, network carrier audio, and PBX transit. No outbound diagnostic calls were placed.

## Deployment

Build `r_M0xTg-oNmVZTJ55kfq_` is live in `.next-fast-handoff-final`. The website manifest served HTTP 200, and the voice adapter and campaign bridge reported `script-scenario-policy-v1`. The PBX and both audio bridges reported zero active calls and connections before the restart. The manual-test bridge retained its existing launcher and version.

The previous build is in `.next-fast-handoff-final.pre-scenario-hH46KGm5egpxGPlpJhxhA`. Matching worker and campaign bridge source backups are in `.data/rollback-scenario-hH46KGm5egpxGPlpJhxhA`. The deployed campaign bridge runs from the `monitor-orn-stage.uWYnPK` launcher overlay. Its hold predicate, revision, and two scenario modules received the focused update.
