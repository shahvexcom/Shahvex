# HTTP WAV client isolation review — 3 November 2026

**No production correction is justified yet.** Normal-response receive stalls are reproducible in synthetic isolation, but changing readers/clients/close handling did not reliably eliminate them. This is not proof of a single upstream Undici bug or the exact mechanism behind the earlier live0.2MB failure.

This investigation made **zero requests to live AI services**, including health requests. No production/runtime files, services, models, credentials, voice/script/VAD/streaming settings, deployment artifacts or backups were modified. The40-character first-clause minimum remains. The only new executable code is diagnostic, experimental/unwired client helpers, and isolated tests. All six deployed Gateway/native files still match the approved VoiceStreaming ZIP payload hashes.

## Follow-up evidence

See `docs/transport-tail-investigation.md`: exact 44-byte-tail stalls now reproduce in both Node raw TCP and Python raw sockets against the isolated Python HTTP fixture. The earlier 10/10 raw success was a limited sample and no longer supports narrowing this to Node's HTTP path. No production correction is proven or deployed.

## Actual Gateway lifecycle, read-only source audit

1. Chatterbox-WAV synthesis submits a JSON POST through fetch, with loopback URL restrictions, redirects rejected and a60-second `AbortSignal.timeout` covering the request/body. No synthesis retries occur.
2. Native STT and accepted native TTS are intentionally drained. Generation/barge-in cancellation does NOT immediately abort accepted native inference. TTS checks generation cancellation before another segment and after the accepted body drains. Do not remove this protection to change the symptom.
3. `limited(response)` iterates `response.body` with `for await`, copies chunks into Buffers and enforces the4,000,000-byte limit. Fetch/Undici enforces HTTP framing; the application does not manually compare the header length there. WAV decode then validates chunks before resampling and emitting PCM.
4. Native Python serializes the complete WAV before200headers, declares `len(data)`, writes64KiB slices, flushes and uses `Connection: close`. Its guard prevents a second error response after headers. A completed Python write reports acceptance by the local socket, NOT receipt by the peer application.
5. The browser receives valid PCM only after a complete native segment is validated. This full-WAV boundary remains required by the existing API; no synthetic filler or partial corrupt WAV is accepted.

The standalone tested runtime is Nodev26.13.0 with bundled Undici8.12.2 and no `NODE_OPTIONS`. No repo-level `setGlobalDispatcher`, outgoing `headersTimeout`, `bodyTimeout` or keep-alive overrides were found. Gateway server `headersTimeout=5000` applies to incoming request headers, not outgoing Chatterbox bodies; direct-client failures also bypass that server. Undici has separate dispatcher timeout categories, but no live dispatcher internals were extracted. Official reference: [Undici error categories](https://github.com/nodejs/undici/blob/main/docs/docs/api/Errors.md).

`getReader()` locks a Web ReadableStream and requires release/cancellation cleanup; the experimental implementation tests those invariants. Its later socket stalls show that API substitution alone is not a verified correction. Reference: [Node Web Streams API](https://nodejs.org/api/webstreams.html).

## Isolated reproduction

Synthetic valid mono PCM16 WAVs were served by Python on temporary loopback ports, explicitly excluding3000,8765,8787,8788 and11434. No model/torch import or inference occurred. Client and server logs contain IDs, timing, counts and hashes only, not response audio, transcripts, credentials or reference audio. Journals are retained per run rather than overwritten to hide failures.

The production Node client consumes an async iterable; the matrix calls its actual `limited()` function as a separate control, with no diagnostic socket subscribers on that variant. Other variants test async iteration, explicit `getReader`, `arrayBuffer`, core HTTP flowing mode and an unwired bounded core helper. HTTP/1.0 andHTTP/1.1 both use explicit close; no keep-alive was enabled in production.

Representative full matrix `dist/transport-matrix-20261102T214846561912Z.json`, normal2,000,044-byte cases only:

|Client/reader|Complete / attempts|
|---|---:|
|Fetch async iteration|5/6|
|Actual Gateway `limited()` via fetch|4/6|
|Fetch explicit reader|3/6|
|Fetch arrayBuffer|5/6|
|Core HTTP control|5/6|
|Bounded core HTTP candidate|5/6|

Several clients stopped near1,965,957-1,966,039 received bytes despite server-side completed writes totalling2,000,044. In one captured fetch deadline snapshot, the socket was paused, not destroyed, with zero JS-readable buffered bytes. This is consistent with stalled receive/flow control but does not establish where the remaining bytes sat or were lost; a metadata-only packet/sequence trace would be needed.

These spontaneous normal stalls ended at the diagnostic5-second deadline, recorded as an explicit client abort. **They are not falsely reported as spontaneous Content-Length exceptions.** The earlier live failure instead reported an integrity error after~22seconds on a smaller WAV; the common underlying cause is unproven. Existing production60-second deadlines were not changed.

### Discarded corrections

- Explicit reader, arrayBuffer and core-client replacement each subsequently stalled. `arrayBuffer()` is also inappropriate as an unbounded workaround; the production limit must remain.
- Bounded graceful server closure did not eliminate the issue. In `dist/transport-close-20261102T215200597857Z.json`, immediate close completed18/20 fetch and19/20 core responses; graceful close completed19/20 for each. The experiment half-closed output and waited for peer EOF with an absolute250ms/4KiB cap. It is not a proven improvement and should not be deployed.
- A4MB receive high-water mark did not eliminate stalls. Workspace matrix `dist/transport-matrix-20261102T215554241809Z.json`: default bounded core8/10, larger window9/10. Outside sandbox restrictions, `dist/transport-matrix-20261102T215954034088Z.json`: default core10/10, larger window7/10. Thus sandbox restriction alone does not explain the phenomenon, and more buffering is not a verified fix.

The results are small, timing-sensitive samples, not production error rates or meaningful performance comparisons. Zero failures in an earlier sample was not treated as success after later failures appeared. Experimental helpers under `gateway/experimental/` remain UNWIRED and are not rollout-ready.

### Lower-layer controls

`dist/transport-raw-20261102T215732631527Z.json`: Node raw TCP consumed10/10 complete responses using HTTP/1.1 requests with equivalent Host/close headers; Python urllib consumed10/10. An earlier HTTP/1.0 raw control also completed10/10. These controls strengthen suspicion of an interaction in Node's HTTP receive/stream path on this machine, but are not enough to exonerate all OS/network/filtering or server behavior.

Windows documentation distinguishes graceful shutdown from abortive closure, where queued unsent data can be lost. This justified testing the lifecycle, not declaring it the cause. Reference: [Microsoft socket shutdown and closure](https://learn.microsoft.com/en-us/windows/win32/winsock/graceful-shutdown-linger-options-and-socket-closure-2). Python's server close flag controls connection reuse/closure; changing it is not evidence of a cure. Reference: [Python HTTP server lifecycle](https://docs.python.org/3.11/library/http.server.html).

## Fault, timeout and cancellation regressions

`dist/transport-faults-20261102T215849167741Z.json`:18 controlled cases covering truncated body, reset/premature socket closure, advertised length too large, advertised length too small, intentional cancellation and a deliberately short diagnostic deadline. Fetch, core HTTP and larger-window candidate each exercised the six cases.

All18 were rejected by HTTP and/or WAV-length validation. Under-declared HTTP lengths can appear complete to the HTTP parser while truncating the WAV; the RIFF/chunk checks must remain. No partial PCM is returned by the tested Gateway pipeline after truncation. Delayed complete responses are separately tested and not classified as corrupt merely because they are slow. Cancellation and deadline expiry are recorded separately.

Nine local Node unit/integration checks pass: reader cleanup/size/status classification, core candidate native-drain sequencing, no stale PCM/history, recovery on the next valid turn, bounded signal/loopback checks and benchmark ordering. All57 existing Gateway tests pass. Baseline normal transport matrices still contain real failures: this is NOT an all-green transport fix claim.

## Strongest supported conclusion

Native synthesis/GPU is not necessary to reproduce the isolated stall. Deliberate corruption reproduces the expected Undici mismatch/reset classifications, proving the new diagnostics can distinguish exact declared/received counts, but does not prove the historical Python producer made that mistake. Both major Node HTTP client paths can stall; a fetch-only implementation defect has NOT been established. The exact production root cause remains unresolved because the historical declared length and native per-write/closure records were not retained.

## Minimal recommendation and rollback

**Retain the current transport and40-character configuration for now.** Do not promote any experimental reader, disable integrity checks, increase deadlines, retry uncertain native jobs, or add arbitrary sleeps/socket-resume pokes. No code correction tested here was consistently successful, so no production patch/archive is prepared.

The smallest useful next investigation is correlated metadata-only TCP/receive tracing on the isolated port, plus a same-fixture run under another already available verified Node build if one exists. An OS trace or new runtime must be separately reviewed/approved; none was enabled or installed. For any later approved live observation, retain declared length, received counts, precise client abort reason, native completed-write lower bounds/failing offset, close timestamps and startup revision. Keep logs bounded and exclude payloads, script/transcript/authorization/reference data. No live request is authorized by this report.

There is no production rollback to perform now. Any later verified WAV-only client pilot should back up the **current working VoiceStreaming** `services.cjs` and record absence/hash of its new helper using the existing maintenance/proof/controller process. Rollback restores that exact current baseline and removes only a hash-matching introduced helper, with the same credentials and native services. Do not use an old cumulative rollback that restores pre-VoiceStreaming code. No backup is overwritten by this investigation.

## Voice latency implications

Production behavior is unchanged, so this work introduces no voice latency. A future transport correction must preserve the existing60-second overall native request bound,4MB body bound, drain, generation rejection, sequential synthesis, redirect/auth guards and WAV validation. Buffering the full native WAV is already required; it must not add an initial playback buffer or an extra model stage. A different client can add connection/copy overhead, and graceful-close waits or larger buffers have resource/latency costs without proven benefit here. No latency benefit or two-second result is established. Reliable transfer remains the priority before repeating the A/B experiment.
