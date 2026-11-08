# Fixture-only socket-boundary investigation

3 November 2026, Asia/Karachi. The user's strict fixture-only restriction remains active. **No ETW/global trace, elevated operation, production service request, credential read, restart, driver installation or network-setting change occurred.** The broader WPR profile remains blocked. No correction is proven or proposed for deployment.

## Instrumentation

`tests/transport_socket_boundaries.py` subclasses only the newly accepted synthetic server sockets. It records actual `sendall` argument lengths and SHA256 hashes, enter/return/error timestamps, shutdown direction/return, socket close enter/return, cumulative client receives and EOF/timeout. It does not write payload bytes into logs. Every response entity is the same deterministic **65,324-byte PCM16 WAV** with hash `e70914f1fb459ce12b16c4f9ff39f4a3364ae5614300963ce4346c3d7af3abf8`. Raw bytes are generated in memory, never customer/reference audio.

Additional read-only instrumentation in `tests/fixture_tcp_info.py` queries **only the caller's own isolated loopback socket**, refusing known production ports. It uses Windows `SIO_TCP_INFO` version 0 and `FIONREAD`; no process/connection table is enumerated. The ioctl does not require elevated privileges. Inspected response size is exactly 88 bytes; unexpected size/errors are retained instead of guessed. No ACK trace or packet capture is implied by these counters.

References: [Microsoft TCP_INFO_v0 fields](https://learn.microsoft.com/en-us/windows/win32/api/mstcpip/ns-mstcpip-tcp_info_v0), [Windows socket IOCTLs and non-elevated SIO_TCP_INFO](https://learn.microsoft.com/en-us/windows/win32/winsock/winsock-ioctls). `BytesOut`/`BytesIn` count sent/received bytes; `BytesInFlight` is currently unacknowledged sent bytes. They are snapshots, not a packet-by-packet sequence history.

Fixtures use ephemeral 127.0.0.1 listeners and exclude 3000/8765/8787/8788/11434. Tests use sequential connections and bounded receive/half-close waits. No automatic retry of a failed transfer: every planned trial is a separately labeled synthetic request. Each fixed comparison permits at most 30 trials per mode. Instrumentation and scheduling can affect occurrence rates, so these are diagnostics, not production failure-rate or latency benchmarks.

## Controlled differential results

Initial ten-per-mode screen suggested buffering/coalescing might help; follow-up disproved both. Main randomized follow-up: `dist/transport-socket-boundaries-20261103T074231155756Z.json`:

| Isolated mode | Complete / attempts | Failed body counts |
|---|---:|---|
| Reviewed unbuffered baseline | 27/30 | 65,280 |
| Buffered body writer | 25/30 | 65,280 |
| One sendall, shorter fixed HTTP headers | 28/30 | 65,194 |
| Shutdown write, bounded 200-ms peer-EOF wait before close | 26/30 | 65,280 |

The buffered writer still made a full 65,324-byte body sendall in the inspected trace; its name does not establish a changed on-wire segmentation. No buffering benefit is proven. Waiting after shutdown did not reliably fix anything.

The shorter-header coalesced mode was confounded by a header-length change, so a second mode retained the reviewed header fields/order and **184-byte header size**, changing only header/body send coalescing. Its first 30 trials passed; the next 30 yielded **26/30**, with 65,096 body bytes received on failures. Combined: **56/60**, not a reliable fix.

- Original separate body send: argument 65,324 bytes; failed body prefix 65,280; **44 missing**.
- Short-header coalesced send: 86 + 65,324 = 65,410 bytes; failed total response prefix 65,280; body 65,194; **130 missing**.
- Same-header coalesced send: 184 + 65,324 = 65,508 bytes; failed total response prefix 65,280; body 65,096; **228 missing**.

Thus the 44-byte count is **not an invariant WAV-header/framing defect**. In these failed coalescing comparisons, the observed prefix limit follows a **65,280-byte send/delivery boundary**, with header placement changing the apparent body deficit. This does not identify a particular buffer, driver, Windows feature or security product. Larger earlier fixtures had different deficits; do not generalize this prefix limit into a universal rule.

Evidence journals:

- `dist/transport-socket-boundaries-20261103T074146940809Z.json`: initial screen, 40 transfers.
- `dist/transport-socket-boundaries-20261103T074231155756Z.json`: 120-transfer follow-up.
- `dist/transport-socket-boundaries-20261103T074309081469Z.json`: 30 baseline and 30 same-header coalesced transfers.
- `dist/transport-socket-boundaries-20261103T074321253097Z.json`: independent 30 same-header coalesced transfers, four failures.

## Sender/receiver counter comparison

Read-only per-socket counter run: `dist/transport-socket-boundaries-20261103T074426918723Z.json`. Baseline 19/20 complete; same-header coalesced 20/20 in that run only. Baseline trial **10** failed; trial **1** succeeded. Same expected body hash and 184-byte header length.

| Observation | Successful trial 1 | Failed trial 10 |
|---|---:|---:|
| Body argument passed to sendall | 65,324 | 65,324 |
| sendall returned normally | Yes | Yes |
| Sender BytesOut before shutdown | 65,508 | 65,464 |
| Receiver BytesIn at EOF/timeout | 65,508 | 65,464 |
| Application body received | 65,324 | 65,280 |
| Application-readable queued bytes | 0 | 0 |
| Receiver state | 7 (CLOSE_WAIT) | 4 (ESTABLISHED) |
| Receiver EOF | Yes | No; diagnostic timeout |
| Sender BytesInFlight at pre-shutdown snapshot | 0 | 0 |

Failed trial 10: server sendall returned, then shutdown and close returned normally; client later timed out after approximately 1,035 ms. The captured sender counters already showed only 65,464 bytes **before** shutdown. The receiver had the identical total and no queued readable data at timeout. These observations narrow this to **reported TCP send/delivery progress below HTTP/WAV application parsing**, rather than an application simply forgetting to copy the final 44 bytes. They also show why sendall success alone is insufficient.

There is no captured sequence/ACK history. Zero BytesInFlight does not prove the unsent remainder was ACKed, and successful shutdown return does not prove FIN delivery. Sender snapshots did not persist after closing the handle. Counter semantics/snapshot timing cannot establish whether remaining accepted bytes were in an internal send queue, intercepted elsewhere, discarded on teardown, or affected by another shared component. No OS/filter/provider is blamed without evidence.

## What is established and what remains missing

Established at application/socket level:

- Identical complete WAV bytes and correct declared Content-Length reach the sendall call.
- Normal sendall/flush/shutdown/close returns occur in both successful and failed traces.
- Failure is reproducible without native synthesis, GPU, Gateway, Node HTTP parsing or a global trace.
- Buffering, coalescing and bounded graceful-close waiting do not consistently resolve it.
- Failed reception is not explained by an intentionally stripped 44-byte WAV header; changing header/write grouping changes the shortfall.
- Per-socket sent/received counters can fall short despite normal sendall return, with no readable tail at the client.

Still missing for an exact root cause/correction:

1. Which send/transport queue or layer contains the accepted-but-not-counted tail, if any.
2. Whether the tail's TCP sequence range and FIN were emitted, acknowledged, reset or filtered after the final snapshots.
3. Whether close causes loss or merely follows a stall already present; snapshots suggest progress was short before shutdown, but do not prove causation.

Packet/stack evidence would be required **only if** those questions cannot be answered through further fixture-owned counters or a suitably scoped diagnostic interface. The existing broad ETW profile cannot satisfy the user's scope restriction and will not be run. No further broad-capture approval is requested here; the missing evidence is stated precisely rather than asserting that global capture is the only route.

## Tests and reproduction

```powershell
Set-Location P:\shahvex
python tests/transport_socket_boundaries.py --repeats 30 --seed 11032027
python tests/transport_socket_boundaries.py --repeats 30 --seed 11032029 --modes coalesced-sameheaders
python tests/transport_socket_boundaries.py --repeats 20 --seed 11032030 --modes baseline,coalesced-sameheaders --tcp-info
python tests/fixture_tcp_info_test.py
```

Each matrix writes a new timestamped journal and reports complete/attempt counts. Exit status alone is not a healthy-transport assertion; inspect the reported failures. A successful sample is complete only after exact body equality, declared length and EOF are verified. Do not promote a mode merely because one small run passes. No missing bytes are fabricated and no corrupt response is accepted.

No production correction is justified. Preserve the current VoiceStreaming release as rollback baseline; no production rollback is needed for this fixture-only work. The WPR refusal gate, Jennifer's reference/model/settings, threshold, scripts, database, credentials and production services remain unchanged.
