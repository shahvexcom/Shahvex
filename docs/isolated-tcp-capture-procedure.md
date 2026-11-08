# Isolated TCP capture procedure — approval required

**Current scope gate (3 November 2026): DO NOT RUN the capture commands below.** The user's subsequent approval expressly forbids collecting unrelated process data and requires fixture-only collection to be guaranteed. This profile is host-wide and cannot meet that condition. `-Approved` alone now refuses execution; broader collection needs separately explicit approval. No trace or fixture was started in response to that conditional approval. Post-capture flow filtering does not satisfy a collection-time restriction.

WPR executable-name filters are not a demonstrated solution: filtering `node.exe` or `python.exe` would also include production processes with the same names. Microsoft also documents that an ETW PID scope filter does not enable a provider registered by a kernel-mode driver, so a generic fixture-PID filter cannot be assumed to capture the required TCPIP kernel events. No filter was tested by silently starting capture. Source: [Microsoft EVENT_FILTER_DESCRIPTOR documentation](https://learn.microsoft.com/en-us/windows/win32/api/evntprov/ns-evntprov-event_filter_descriptor).

3 November 2026, Asia/Karachi. Preparation only: **no trace started, no synthetic requests sent in this preparation, no live AI requests, installation, service restart or production change**.

## Verified capability and privacy boundary

Built-in WPR, Pktmon, logman and tracerpt are available. No tshark/dumpcap was found on PATH; this is not a complete installed-software inventory. WPR successfully parsed the custom profile and displayed its event-ID allowlist. Read-only manifest validation checked all **24 installed versions** of the 15 selected event IDs. No string or generic packet/payload binary field is allowed; binary socket-address fields are metadata and permitted. Manifest review ran in a child PowerShell with process-only ExecutionPolicy Bypass; persistent execution policy was not changed.

Chosen first stage: `Microsoft-Windows-TCPIP` **ETW metadata**, with built-in WPR and event-ID filtering. Capture is pending explicit approval for elevated temporary tracing. No driver or software installation is proposed.

Important limits:

- The allowlist covers TCP send/receive sequence and byte counters, cumulative/duplicate ACK-related state, retransmission state, FIN delivery and received/sent RST events. These are provider events, **not guaranteed one-to-one wire packets**. `NumBytes` is not automatically an Ethernet packet length. Missing events are not proof that bytes or FINs were absent.
- This provider can observe loopback stack activity, but event coverage for this exact failing flow must be demonstrated in a short feasibility capture. Do not promise complete packet/ACK evidence before validation.
- Event-ID filtering is **host-wide**, not an isolated-port collection filter. Raw ETL may therefore contain other connections' TCP metadata (addresses, process IDs, counters and timestamps), plus normal ETL machine metadata. Fixture-only TCB/flow selection occurs during analysis. This scope requires explicit approval; do not label the raw ETL fixture-only or distribute it. No packet contents, audio, transcripts, cookies, tokens or reference audio are requested by the allowlisted provider templates.
- Standard Pktmon defaults can record payload. `--pkt-size 0` means **full packets**, not metadata-only; fixed snap lengths can also include payload on short headers. Those modes are not proposed. Pktmon non-packet metadata flags alone do not guarantee sequence/ACK coverage. No broad `netsh capture=yes` fallback is authorized.
- If ETW coverage is incomplete, lost, or unsuitable, stop. A different capture method or driver must be separately reviewed and approved. Do not install Npcap or enable a global raw capture automatically.

Sources: [Microsoft WPR event-ID filtering](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/eventfilters), [WPR filtering guidance](https://devblogs.microsoft.com/performance-diagnostics/filtering-events-using-wpr/), [Pktmon capture options](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/pktmon-start). Local installed help and provider manifests take precedence for supported syntax and schemas.

## Prepared files

- `tests/Shahvex-TcpMetadata.wprp`: event-ID allowlist, no packet provider, no stacks, 8-MiB memory buffers.
- `tests/Review-TcpMetadata.ps1`: read-only schema review; refuses unexpected string/generic binary fields or missing IDs.
- `tests/transport_tcp_trace_fixture.py`: existing reviewed synthetic HTTP response path, fixed 65,324-byte WAV, loopback ephemeral port, 15 sequential normal requests (five each fetch/core HTTP/raw TCP). It waits for a gate file before requests; no injected failures or native synthesis.
- `tests/Invoke-IsolatedTcpMetadata.ps1`: approval/admin gates, readiness age and process/listener checks, schema validation, unique owned WPR instance, maximum 55-second collection wait, finally stops only that instance. It never changes firewall, antivirus, TCP options, maintenance, credentials or services.
- `dist/tcp-metadata-schema-review.json`: installed schema review and profile hash.

Fixture runtime is bounded to 45 seconds, with a 2-second per-request diagnostic deadline. The 120-second initial wait gives time to start the approved trace. Timeout/cancel is tagged explicitly and must not be interpreted as spontaneous connection closure. If startup takes too long, use a new directory and repeat setup, not automatic request retries.

## Exact procedure — only after capture approval

Use a new directory name; existing evidence is never overwritten. Do not start either capture/fixture sequence until the user approves the scope above. No production maintenance window is necessary for these synthetic requests, but avoid concurrent troubleshooting captures to make interpretation reliable.

**Terminal A: ordinary PowerShell in the repository**

```powershell
Set-Location P:\shahvex
python tests/transport_tcp_trace_fixture.py --output P:\shahvex\dist\TcpTrace-20261103-v1
```

Expected: `Ready; waiting for capture-go ...`. Only an ephemeral synthetic listener is running; no fixture request yet. Stop if startup fails. The directory contains `ready.json` with PID, port, response size and productionRequests=0.

**Terminal B: PowerShell explicitly opened as Administrator after approval**

```powershell
Set-Location P:\shahvex
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/Invoke-IsolatedTcpMetadata.ps1 -FixtureDirectory P:\shahvex\dist\TcpTrace-20261103-v1 -Approved
```

ExecutionPolicy Bypass is confined to this reviewed local child process, not a persistent policy change. If organizational policy blocks it, stop; do not weaken that policy. WPR profile/trace code remains unverified at elevated runtime until this approved execution.

Expected: schema review succeeds, WPR starts a uniquely named instance, then the gate triggers only synthetic requests. Capture stops after fixture completion or the bounded wait. Outputs: `application.json`, `schema-review.json`, `trace-owner.json`, `tcp-metadata.etl`, `done`. Terminal A reports complete/attempt counts, including any failures. Complete delivery is not assumed.

If WPR start fails, the fixture gate is not created; no requests should begin. If trace stop fails, the exact owned-instance stop command is printed. Do not stop/cancel other WPR sessions.

**Terminal B: read-only ETL event export after collection**

```powershell
tracerpt.exe P:\shahvex\dist\TcpTrace-20261103-v1\tcp-metadata.etl -o P:\shahvex\dist\TcpTrace-20261103-v1\tcp-metadata.xml -of XML
```

Stop on any decoding error or event loss. Provider schemas may need Event Log decoding if tracerpt output is insufficient; do not treat opaque records as successfully decoded packet evidence. Keep ETL/XML local because non-fixture connection metadata may be present.

## Correlation and decision gates

1. Match the synthetic listener/client ports, timestamps and TCP control blocks. Server records now include both ports, request ID, expected WAV length/hash, header bytes, accepted writes, send/flush completion and shutdown begin/return. Client records retain counts, prefix hash, header/RIFF sizes, socket state and explicit deadline reason. Reject ambiguous flow matches.
2. Require both a complete and a failed **identical 65,324-byte** transfer. If no failure reproduces, report that outcome; do not infer a fix or automatically extend capture.
3. Validate sufficient event coverage and no event/buffer loss before drawing negative conclusions. WPR memory buffering is bounded and can lose events; empty/missing events mean inconclusive evidence.
4. Establish the TCP response sequence range using its actual HTTP header length plus 65,324 body bytes, accounting for SYN/FIN sequence consumption and 32-bit wrap. Compare the tail's send/receive/ACK evidence, retransmission events, receive/delivery counters and FIN/RST ordering. Do not equate ETW send events, `sendall` completion or TCP ACKs with successful application reads.
5. If the tail is received/ACKed in the stack but absent from application counts, investigate stack-to-socket/application delivery. If tail send evidence exists without receipt/ACK, inspect transport/drop/closure evidence. If the server never reports the final range, investigate emission/framing. These are hypotheses until matching complete evidence exists.
6. The isolated failure already retains its RIFF header, so 44 bytes is not automatically a missing WAV header. Test exact header/body boundaries and the last acknowledged range rather than padding or subtracting 44 bytes.
7. Preserve the current VoiceStreaming release. Only prepare a correction targeting a demonstrated component; require repeated full length/hash success, strict truncation rejection, cancellation/native-drain and no stale-audio regressions before any separately approved rollout. No fix or latency benefit is claimed now.

## Stop and rollback

The capture script's finally block stops only its unique WPR instance. If interrupted, use the instance from `trace-owner.json`, never a global stop/cancel:

```powershell
$run='P:\shahvex\dist\TcpTrace-20261103-v1'
$owner=Get-Content -LiteralPath (Join-Path $run 'trace-owner.json') -Raw | ConvertFrom-Json
wpr.exe -stop (Join-Path $run 'tcp-metadata-recovery.etl') -skipPdbGen -instancename $owner.instance
```

Stop the fixture with Ctrl+C **in Terminal A only** if it is still running. Preserve all trace/evidence files. No production file/network/service rollback is needed because none was changed. Do not release maintenance or restart any AI service as part of cleanup.

## Validation completed before approval

WPR profile parsing succeeded; 24 installed event-template versions passed the read-only schema check. Both PowerShell scripts parsed; Python fixture compiled. Existing Gateway tests: **66/66 passed**. No elevated capture or fixture execution has occurred, so successful-versus-failed TCP traces and a packet-proven root cause remain pending.
