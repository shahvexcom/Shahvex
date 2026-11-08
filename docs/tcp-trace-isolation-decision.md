# TCP trace decision — reviewed plan, not authorized for execution

3 November 2026, Asia/Karachi. **No trace, VM/Sandbox launch, installation, production request, service restart or host configuration change was performed.** The existing host-wide capture remains blocked. This document does not authorize capture or guest provisioning.

## Decision

Prefer an **existing dedicated Windows 11 VM on a separate test machine**, with no external virtual NIC, no production data and matching Windows/Python/Node builds. First reproduce the same 65,324-byte failure using the existing application-level fixture. Only if it reproduces should an approved trace run inside the guest. If no such environment exists, obtain provisioning approval separately; do not enable Hyper-V, Sandbox or host virtual switches automatically.

| Option | Isolation/privacy | Evidence and limitation | Decision |
|---|---|---|---|
| Host TCPIP ETW | Event-ID filtering is host-wide; may retain unrelated addresses/process metadata | Highest fidelity to the failing host; cannot satisfy current fixture-only restriction | Blocked; requires explicitly broader approval |
| Dedicated disconnected Windows VM | Separate guest kernel; ETW sees guest metadata, not host connections | Best repeatability and privacy. Build, drivers, filtering and scheduling differ; failure must reproduce first | Preferred, ideally on another machine |
| Windows Sandbox | Separate kernel; disable networking/vGPU and map only a credential-free fixture bundle | Disposable, but host tools are not inherited; runtime staging needed. Fresh environment may not reproduce host-specific cause | Secondary choice if already available and separately approved |
| Host network compartment/container namespace | Separates network endpoints, not the scope of the prepared host ETW session | Does not make this event-ID filter fixture-only. Creating containers/networks changes host state; process-isolated containers share kernel | Not a sufficient capture-scope guarantee |

Sandbox and ordinary VMs still run guest background processes. A guest-wide trace can include **their** TCP metadata. A disconnected dedicated guest removes Shahvex-host exposure but is not mathematically fixture-process-only; approval must explicitly permit guest background metadata. If that is forbidden too, no supplied profile is authorized. Do not silently substitute post-capture filtering for collection-time isolation.

Sources: [Microsoft Sandbox isolation/requirements](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/), [Sandbox networking/mapping controls](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file), [Windows container network namespaces](https://learn.microsoft.com/en-us/virtualization/windowscontainers/container-networking/network-isolation-security).

## Provider, exact IDs and coverage

Minimum provider count: **one**, `Microsoft-Windows-TCPIP`, GUID `{2F07E2EE-15DB-40F1-90EF-9D7BA282188A}`. No NDIS/packet-content, process, stack, disk, browser or capture-driver provider is requested.

Proposed guest profile: `tests/Shahvex-TcpGuestReview.wprp`, verbose level **5**, explicit event-ID allowlist. Eleven modern coverage candidates plus three compatibility IDs follow. This is the smallest reviewed candidate set here, **not proof all IDs emit on every Windows build**. Validate the guest's installed schemas before collection; IDs/versions and actual active congestion-control path determine useful coverage.

| Purpose | Exact IDs and installed task names | Interpretation limit |
|---|---|---|
| Send ranges | **1332** `TcpDataTransferSend` | SeqNo/BytesSent; newer versions include address and window/state metadata |
| Receive ranges | **1074** `TcpDataTransferReceive` | SeqNo/NumBytes; not necessarily one event per packet |
| Cumulative ACK state | **1330** `TcpDataTransferCumAck`; **1331** CTCP equivalent; **1429** CUBIC equivalent | Congestion-algorithm dependent; do not add counts across algorithms |
| ACK detail | **1550** `TcpSendTrackerAck` | AckNo, Start/End, retransmission/SACK-related metadata; not a complete wire ACK trace guarantee |
| Retransmission | **1351** `TcpDataTransferRetransmitRound` | SndUna/RexmitCount; round/state event, not necessarily every retransmitted packet |
| FIN delivery/injection | **1176** `TcpDeliveryFin`; **1180** `TcpTcbInjectFinComplete` | Stack/application FIN processing, not independent proof of FIN on wire |
| RST received/sent | **1184** `TcpConnectionTerminatedRcvdRst`; **1479** `TcpRstSend` | Includes endpoint/state/reason metadata |
| Compatibility send/ACK paths | **1071** `TcpDataTransferCumAck`; **1073** `TcpDataTransferSend`; **1333** `TcpCtcpDataTransferSend` | Retained until actual guest event coverage is established; not duplicate bytes to sum |

These 14 IDs are present in the inspected host manifest; that is not guest validation. The profile parsed successfully using installed WPR without starting it. Buffer capacity: **128 × 64 KiB = 8 MiB**, memory logging only, no file-mode spill. No stacks, capture-state request or raw packet provider. Keywords are broad only within this ID allowlist. Unexpected string/payload fields in any guest event version mean stop/review; socket-address binary fields are address metadata.

ETW templates contain counters, pointers, endpoints, process identifiers and timestamps, **not requested audio/TCP payloads**. ETL saving can add normal machine/image metadata; do not promise zero machine identifiers. Data/sequence lengths are TCP-provider lengths, not Ethernet packet lengths. If actual packet flags/lengths cannot be reconstructed adequately, report inconclusive; do not turn on raw capture automatically. Source: [Microsoft event-ID filtering](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/eventfilters).

## Guest prerequisites and staging — approval pending

No guest is confirmed available. `WindowsSandbox.exe`, VM management commands and VMConnect were not found by the current command lookup; this does not establish optional-feature installation state. No feature enumeration requiring elevation was attempted.

Stage only reviewed fixture code, approved offline Python/Node runtimes, this profile and the approved wrapper **source for AST extraction**. No AI models, `.env`, credentials, database exports, voice references, production logs or full repository mapping. Use a new guest root `C:\Shahvex-TcpFixture`, and supply these relative files:

```text
tests/transport_tcp_trace_fixture.py
tests/transport_tail_matrix.py
tests/transport-tail-clients.cjs
tests/chatterbox_transport_test.py
tests/Shahvex-TcpGuestReview.wprp
gateway/wav.cjs
gateway/reviewed-chatterbox/chatterbox_voice_server.py
```

The reused fixture currently reads the wrapper source from `C:\Shahvex-AI\chatterbox-testing\chatterbox_voice_server.py`. In the **guest only**, copy the staged reviewed wrapper there. It is read/AST-parsed; do not run/import its model initialization. This path is not a host mapping. Verify hashes against the reviewed source before testing. Python uses only the standard library; no torch or pip installation is needed. Record Windows build, runtime versions and source hashes. Do not copy the production AI virtual environment.

For a full VM, use an already provisioned disconnected guest; no host switch/NIC/firewall edits. Sandbox, if separately selected and already enabled, should use `<Networking>Disable</Networking>`, `<VGpu>Disable</VGpu>`, disabled clipboard/audio/video input and only a read-only staging-folder mapping. Any writable export folder must be a new empty evidence-only folder explicitly approved for that purpose; never map `P:\shahvex` or `C:\Shahvex-AI`. Sandbox closure destroys unexported evidence. This document does not start or configure either environment.

## Exact guest commands — only after separate run approval

Run the same fixture **without tracing** first, using a newly reviewed setup that triggers `capture-go` without WPR, to establish both successful and failed identical bodies. This gate is essential; do not run a trace merely because its tools are installed. If the failure does not reproduce, retain that result. Do not change Windows/security settings to force reproduction or infer the host is fixed.

Once reproduction and guest schema checks pass, the following are the planned capture commands. `v1` is a new output directory. No host terminal runs them.

**Guest Terminal A — ordinary PowerShell**

```powershell
Set-Location C:\Shahvex-TcpFixture
New-Item -ItemType Directory -Force C:\Shahvex-TcpFixture\dist | Out-Null
python tests/transport_tcp_trace_fixture.py --output C:\Shahvex-TcpFixture\dist\Trace-v1
```

Expected: ephemeral loopback fixture ready, waiting up to 120 seconds for `capture-go`. This is not a production listener. If prerequisites fail, stop.

**Guest Terminal B — Administrator, after approved scope and schema validation**

```powershell
Set-Location C:\Shahvex-TcpFixture
$run='C:\Shahvex-TcpFixture\dist\Trace-v1'
$instance='ShahvexGuestTcp-'+[Guid]::NewGuid().ToString('N')
$owned=$false
try {
  wpr.exe -start tests/Shahvex-TcpGuestReview.wprp!ShahvexGuestTcp -instancename $instance
  if($LASTEXITCODE -ne 0){throw 'Trace start failed; do not trigger fixture'}
  $owned=$true
  @{instance=$instance} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $run 'trace-owner.json')
  $until=[DateTime]::UtcNow.AddSeconds(50)
  New-Item -ItemType File -Path (Join-Path $run 'capture-go') -ErrorAction Stop | Out-Null
  while(!(Test-Path -LiteralPath (Join-Path $run 'done')) -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 200}
} finally {
  if($owned){
    wpr.exe -stop (Join-Path $run 'tcp-metadata.etl') -skipPdbGen -instancename $instance
    if($LASTEXITCODE -ne 0){Write-Warning "Owned trace stop failed; recover instance $instance immediately"}
  }
}
```

The fixture subprocess is bounded to 45 seconds. Capture stop begins by 50 seconds, targeting the approved **55-second** maximum. **PowerShell/WPR cleanup cannot guarantee a hard 55-second limit if the controller hangs or stop fails**; an independently reviewed watchdog is required before approving a strict hard cap. Until that exists, these are review commands, not an execution-ready guarantee. No automatic fallback or global cancellation.

After collection, guest-only read-only export:

```powershell
tracerpt.exe C:\Shahvex-TcpFixture\dist\Trace-v1\tcp-metadata.etl -o C:\Shahvex-TcpFixture\dist\Trace-v1\tcp-metadata.xml -of XML
```

Reject absent/opaque events or lost-event/buffer counts as inconclusive. Correlate TCB/endpoint metadata against fixture ephemeral ports, IDs, monotonic application timestamps, header length and body hashes. A tracing run may alter timing; lack of failures while tracing is not a fix. ETL buffer capacity is 8 MiB; exported ETL/XML files include serialization/merge metadata and are **not capped at exactly 8 MiB**. Reserve a dedicated 64-MiB evidence budget and stop/review if exceeded; no deletion or overwrite of old runs.

**Host route, if ever separately authorized:** same direct WPR start/stop commands and profile, but root/output `P:\shahvex\dist\TcpHostTrace-v1`. It would be a host-wide selected-event trace, including unrelated connection/process metadata. Current strict scope explicitly forbids it; the existing host capture script remains blocked. Do not pass a broader-scope override based on guest approval.

## Results and interpretation

| Trace result | Supports | Does not prove |
|---|---|---|
| Full tail receive/ACK range, application short | Stack-to-application delivery/read discrepancy | Which component withheld/discarded data without matching delivery events |
| Tail send event, no matching receive/ACK, retransmissions | Incomplete delivery/acknowledgment in observed path | Physical transmission or a particular filter/driver fault |
| No tail send range after accepted sendall | Stall before observed TCP send progress | Absence on wire if event coverage/loss is uncertain |
| RST precedes tail/FIN completion | Connection abort timing is relevant | Who caused it or why without matching status/reason evidence |
| FIN covers only a shorter sequence range | Premature termination/framing hypothesis | That Python intentionally supplied fewer bytes; compare hashes and events |
| Complete ranges/EOF only in guest; host still fails | Environment-dependent behavior | That the host defect is fixed or which host component causes it |
| Same signature fails in guest with matching range evidence | VM is useful for restricted causal experiments | Exact equivalence to the host's historical failure |
| Missing events, event loss or no failure during capture | Insufficient evidence | Healthy transport, absence of resets, or absence of the tail |

Account for TCP SYN/FIN sequence consumption, 32-bit wrap, duplicate retransmission ranges, actual HTTP-header size and trace offload/coalescing. The 44-byte deficit varies with send grouping; never fill bytes or disable validation. Prepare a correction only after a demonstrated cause and repeated exact-length/hash, strict-corruption and drain/cancellation regressions.

## Cleanup and rollback

Stop only the owned named guest WPR instance. On interruption, read `trace-owner.json` and use:

```powershell
$run='C:\Shahvex-TcpFixture\dist\Trace-v1'
$owner=Get-Content -LiteralPath (Join-Path $run 'trace-owner.json') -Raw | ConvertFrom-Json
wpr.exe -stop (Join-Path $run 'tcp-metadata-recovery.etl') -skipPdbGen -instancename $owner.instance
```

Ctrl+C only the fixture's guest Terminal A if needed. Verify that named session is stopped before exporting evidence/closing the guest. Do not cancel other recordings. Export only the dedicated evidence folder through the separately approved route, hash the files, then close the disposable guest or return the dedicated VM to its pre-test checkpoint. Never revert/stop a production VM or alter host settings.

No production rollback is necessary because none is changed. Existing VoiceStreaming remains the baseline. **Pending approvals:** guest availability/provisioning and exact background-metadata scope, any runtime staging/export mechanism, and the reviewed bounded capture execution. No host capture, installation or guest start is authorized by this plan.
