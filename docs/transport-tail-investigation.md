# Recurring WAV tail-delivery failure: isolated investigation

3 November 2026. **No live Chatterbox/Gateway/AI requests, production edits, restarts, credential reads or deployment in this investigation.** No correction is proven. Keep the current VoiceStreaming deployment and 40-character threshold.

## Latest failure and exact client path

Retained listening evidence: `dist/Jennifer-Generic-Listening-v1/metrics/run-failure.json`. The second phrase of `neutral-style-aware` declared 65,324 bytes and yielded 65,280, then threw `UND_ERR_RES_CONTENT_LENGTH_MISMATCH`. No retry followed. Header wait was 1,135.39 ms. The earlier runner did **not** retain time-to-error, socket closure or native per-write records, so those historical details cannot be reconstructed. A 44-byte difference alone does not establish a header bug.

That request bypassed the Gateway TTS adapter: `gateway/style-review/run-approved-listening.cjs` submitted JSON `{text}` directly to the loopback `/synthesize` endpoint using Node fetch, a 60-second timeout and async iteration of the response body. It counted every yielded byte, including the WAV header, and did not slice 44 bytes off before counting. No Gateway generation signal or barge-in cancellation was attached. The actual production `gateway/services.cjs` uses a similar fetch/full-body iteration path through `limited()`, validates WAV, then resamples; accepted native work intentionally drains before cancellation is applied. Neither path should bypass integrity checks.

The inspected physical Python file constructs the complete WAV, declares `len(data)`, writes 64-KiB slices, flushes, requests `Connection: close` and prevents duplicate responses after headers. `BaseHTTPRequestHandler` uses an unbuffered socket writer whose inspected implementation calls `sendall()` and returns the full byte count. Thus ordinary successful writes are not unchecked short `send()` returns. Socket acceptance still does not establish peer receipt.

Read-only comparisons confirm the physical `core.cjs`, `services.cjs` and `chatterbox_voice_server.py` bytes match their approved VoiceStreaming ZIP entries. This verifies disk contents, **not which revision a long-running process loaded**. No live revision endpoint or process-memory inspection was used.

## New diagnostics and measurements

Added isolated files only:

- `tests/transport-tail-clients.cjs`: bounded fetch, core HTTP and Node raw-TCP controls, ephemeral-port restriction, body counts/hashes, RIFF validation, byte/readable-state snapshots, closure/error/deadline classification.
- `tests/transport_tail_matrix.py`: extracts only the inspected physical Handler class via AST; no torch/model import. Synthetic PCM16 WAVs, complete per-write counts, send return and socket shutdown timestamps. POST bodies are fully consumed. Logs contain metadata and synthetic hashes, no transcripts, credentials, raw audio or reference material.
- `tests/transport_bare_bytes.py`: independent Python bare-TCP control without HTTP, WAV or Node.

All fixtures use temporary loopback ports, excluding 3000/8765/8787/8788/11434. No retries. A deliberate 2-second **diagnostic** deadline is recorded as client cancellation, never misreported as a spontaneous length exception. Production timeout settings are unchanged. Write traces are bounded by at most 31 body writes for the largest fixed fixture.

Primary journal: `dist/transport-tail-20261102T225425516066Z.json`:

| Client | Complete normal bodies / attempts |
|---|---:|
| Node fetch | 8/10 |
| Node core HTTP | 7/10 |
| Node raw TCP, manual HTTP framing | 8/10 |
| Python raw socket, manual HTTP framing | 8/10 |

Node controls used five repeats each of 65,324 and 2,000,044 bytes. Python raw used ten 65,324-byte responses. These are small diagnostic samples, **not production error-rate estimates**.

For failed normal 65,324-byte bodies, all four clients reproduced **exactly 65,280 bytes received, 44 missing**, with the same received-prefix hash. The prefix begins `RIFF` and advertises the complete 65,324-byte WAV: this is an incomplete tail in the isolated cases, not removal of the 44-byte WAV header. Larger failed responses were short by 34,005 or 34,087 bytes; therefore loss is not universally 44 bytes.

For a representative raw-TCP failure, the server accepted all 65,324 body bytes and returned from send/flush in 0.22 ms, then socket shutdown returned approximately 1 ms later. The receiver stalled with 65,280 body bytes plus 184 HTTP-header bytes (`socket.bytesRead=65,464`), `paused=false`, JS-readable bytes=0, and no end event before its diagnostic deadline. Python raw independently received the same truncated prefix. All normal server writes and shutdown calls completed in the retained final matrix. No native inference or GPU load was involved.

This rules out a fetch-only, Node-HTTP-parser-only or WAV-decoder-only explanation as **necessary** for the isolated failure. It does not identify the exact OS/socket/filter/server-lifecycle component. The server's completed shutdown call is not packet-level proof of a FIN or final bytes reaching the receiver. OS/network mediation, Python/Windows send/close behavior and other shared environment effects remain unseparated.

## Fault controls and failed regressions

All **9/9** injected loss/framing/cancellation controls were rejected:

- Deliberately dropping the last 44 bytes reproduces the fetch mismatch, core HTTP reset classification and raw count mismatch; the WAV itself is incomplete.
- Advertising 44 extra bytes also produces a length mismatch, but the received WAV is complete. This demonstrates why declared/received counts alone cannot distinguish incorrect framing from missing tail bytes. Only the synthetic evidence includes the required prefix/RIFF information.
- Deliberate client cancellation is logged separately and returns no valid audio.

The three delayed-valid cases were not all healthy; see the journal. The matrix **exits with failure on spontaneous normal/delayed delivery defects**, rather than turning them into passes. The first retained 42-case journal `dist/transport-tail-20261102T225319711671Z.json` also failed its delayed-valid assertion and remains preserved. Neither failed run is presented as an all-green transport fix.

Bare TCP with Python sender/receiver completed **20/20** length-checked transfers, with matching retained hashes, at sizes 65,324 and 65,536: `dist/transport-bare-20261102T225505740530Z.json`. It has different framing, payload and timing; this sample does not exonerate all underlying TCP behavior or prove an HTTP-layer cause.

Existing Gateway and experimental-reader regressions: **73/73 passed** using isolated/mocked services. They cover cancellation/native draining, stale-audio rejection, strict corrupt-body rejection, bounded reads and existing VoiceStreaming behavior. They do not override the failing normal transport matrix.

Reproduce without touching AI services:

```powershell
Set-Location P:\shahvex
python tests/transport_tail_matrix.py
python tests/transport_bare_bytes.py
node --test tests/gateway*.test.cjs tests/wav-body-reader.test.cjs tests/http-wav-candidate.test.cjs
```

Expected matrix behavior: preserve a new timestamped journal; exit nonzero if any normal/delayed valid delivery fails. The occurrence is intermittent; success in another run is not proof of a fix.

## Correlation with earlier evidence

`docs/http-client-isolation-review.md` and its matrices already showed normal stalls across fetch and core HTTP near the end of responses. Its earlier raw controls completed 10/10, but **the new Node and Python raw failures weaken its earlier suspicion of a specifically Node HTTP receive path**. Reader/client replacement is now less justified, not more.

The approved earlier single live request (`.env.native-transport/once-1793655470896.json`) received all 209,324 bytes with `Connection: close`: headers at 4,035.97 ms, body transfer 14.58 ms. That success does not establish correctness of close handling in every transfer. Earlier immediate/graceful-close and receive-window experiments also failed intermittently; do not revive them as fixes without new causal evidence.

The live listening mismatch and isolated stalled prefix have the same byte-count pattern, but different terminal observations: live fetch reported a Content-Length exception; normal synthetic stalls ended when the explicit diagnostic deadline fired. No historical packet trace links the two mechanisms conclusively. They are correlated evidence, not proof that every failure shares one cause.

## Recommendation and rollback baseline

**No production patch is justified yet.** Do not switch clients, add sleeps, increase timeouts/buffers, pad missing audio, bypass lengths, or retry accepted native work. No transport or latency improvement is claimed.

The smallest justified next step is a separately reviewed, metadata-only loopback TCP sequence/ACK/FIN/RST trace on the **isolated fixture port**, correlated with these write/shutdown/receive IDs and timestamps. It must establish whether the missing tail was sent, acknowledged, reset, filtered or held. No packet capture, OS tracing, filter/driver change or runtime installation was performed here. Trace collection must exclude payload and production ports. A correction should target the demonstrated component only, with repeated full-length/hash controls and strict corruption/cancellation regressions before a live pilot.

There is no production rollback to perform. Preserve the approved current VoiceStreaming files and existing backups. A future approved correction must back up the then-current matching files and roll back to **VoiceStreaming**, not a pre-streaming release, without changing tokens, voices, STT drain, phrase thresholds or generation rejection.
