# Physical PC VM feasibility — NO-GO under current restrictions

Read-only assessment, 3 November 2026 (Asia/Karachi). No VM creation/launch, feature enabling, installation, reboot, network change, capture or AI-service request occurred. Inventory queries required access outside the tool sandbox; they only read Windows state. No credentials or process command lines were collected.

## Observed PC state

| Check | Result |
|---|---|
| Windows | Windows 11 Pro, 25H2, build **26200.9711** |
| CPU | Intel Core i7-12700, **12 cores / 20 logical processors** |
| RAM | **31.72 GiB** total, **17.23 GiB** free at the inventory snapshot |
| Disk | C: **258.98 GiB** free; P: **96.74 GiB** free |
| CPU load | Three one-second samples: **7.37%, 2.60%, 3.76%**; not an AI peak-load test |
| GPU | RTX 4060, **8,188 MiB** total, **4,396 MiB** allocated, **1%** utilization at snapshot |
| VM features | Hyper-V-All, Hyper-V, Windows Sandbox, VirtualMachinePlatform, HypervisorPlatform all report **InstallState=2 (disabled)** |
| VM tooling | No WindowsSandbox, VMConnect, Get-VM or New-VM found by command lookup; no vmms/vmcompute service objects returned |
| Existing virtualization | HypervisorPresent=true; systeminfo reports a detected hypervisor. VBS status=2 (running) |

Raw processor virtualization/SLAT/firmware flags reported false while an existing hypervisor was detected. Do **not** interpret those exposed flags as proof of unsupported hardware or disabled BIOS virtualization. Current security virtualization is operational, but launch capability for an ordinary Windows guest was **not demonstrated**. Do not disable VBS or change BIOS/boot settings to resolve the discrepancy.

Pro supports the relevant Windows features, but edition support does not mean they are enabled. Enabling them and any reboot would violate the current no-change instruction. Sources: [optional-feature state meanings](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-optionalfeature), [Hyper-V requirements](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/host-hardware-requirements?pivots=windows).

## Resource and service impact

Capacity appears sufficient for a small guest, **conditional on separate provisioning approval**. Suggested starting allocation: **2 vCPUs, 4 GiB fixed RAM**, increase to 6 GiB only if needed, no vGPU/GPU pass-through, and a Windows 11-compatible virtual disk of at least **64 GB** (80 GiB dynamic is a practical proposal). Dynamic disk maximum is not the same as actual host consumption. Budget space for the base image, clone/checkpoint and export, not just the empty VHD size. These are planning allocations, not a tested guest configuration. [Windows 11 requirements](https://support.microsoft.com/en-us/windows/experience/compatibility/windows-11-system-requirements)

The synthetic fixture requires no GPU. Nevertheless, VM boot and guest background activity can consume CPU, RAM, memory bandwidth and disk used by Whisper, Ollama, Chatterbox and Next.js. Low snapshot CPU usage does not guarantee no interference during an AI turn. Keep an agreed host memory reserve (for example 8 GiB), observe paging/CPU during a separately approved trial, and stop only the test guest if contention appears. Do not unload models or stop production services to make room. Prefer an already provisioned VM on another test machine.

## Reproduction and comparability

The host defect has already reproduced using only standard-library synthetic Python HTTP/socket fixtures and Node/Python clients: **no Chatterbox, Ollama, Whisper, Gateway or Next.js execution is required by the fixture**. Those production services remained running independently; they need not be stopped for a guest test. The guest does not need AI models, voice/reference files, credentials, database access, GPU drivers or production ports.

Match Windows **26200.9711**, Python version/architecture, Node **26.13.0**, fixture/wrapper-source hashes, fixed 65,324-byte response, loopback address, header/body grouping and timeout classification. Record guest TCP counters as on the host. Recheck actual Python version before final staging; it was not queried anew in this assessment.

A guest still differs in kernel instance, virtualized CPU scheduling, NIC/filter stack, installed security components and background load. A clean VM cannot be assumed to reproduce a host-specific filter/driver condition. A disconnected guest can use **127.0.0.1 with no virtual switch or external adapter**. Fixture execution and ETW collection need no internet; use an already provisioned Windows image and verified offline runtimes. Initial Windows setup/activation or missing runtime acquisition is a separate prerequisite, not justification for bypasses or network access.

## Conditional setup → test → trace → cleanup

This sequence is a plan, **not authorization**. The exact base-image/runtime paths are not available, so creating a runnable VM provisioning command now would require invented inputs. Exact guest trace commands and output paths are already documented in `docs/tcp-trace-isolation-decision.md`.

1. Select an **existing dedicated Windows VM on another machine** with its hypervisor already enabled. Confirm image path/build, runtime provenance, storage/export path and approval. Do not enable this PC's optional features.
2. After separate setup authorization, create an isolated clone/checkpoint, allocate 2 vCPUs/4 GiB RAM, leave its external NIC disconnected, and omit GPU sharing. No production-host mappings. Keep a manifest of owned VM/disk paths for cleanup.
3. Transfer only the reviewed fixture bundle/source and offline runtimes using the approved media/export route. Do not copy `.env`, AI models, reference audio or the full repository. Stage at `C:\Shahvex-TcpFixture` inside the guest; satisfy the AST-source path described in the decision document without running the TTS server.
4. Run the fixed synthetic transfers **without tracing first**. Require matching successful and failed full-length/hash observations. If the signature does not reproduce, do not capture merely to produce a trace file.
5. If reproduction succeeds, separately approve guest-wide TCP metadata scope (guest background connections can still appear), validate that guest's event manifests, and execute the decision document's named WPR session. The reviewed hard-duration watchdog is still pending: no strict 55-second guarantee is claimed by the current PowerShell finally block.
6. Compare sequence/delivery/ACK/FIN/RST metadata with sendall/shutdown/close and receiver counts. Missing/lost events are inconclusive; do not weaken WAV integrity checks.
7. Stop only the owned named guest trace and fixture. Export/hash the dedicated evidence folder. Shut down only the owned guest, then revert its checkpoint or delete only the approved clone/disks after verifying ownership/path. Preserve the base image and production services. Never use a blanket VM/process stop/delete command.

## Negative result and diagnostic value

No failures in a clean guest means **the defect was not reproduced in that tested environment**, not that the host is fixed or any client is reliable. With intermittent failures, a small all-green sample is particularly weak. A guest failure matching both byte pattern and socket counters would justify guest-local causal tracing; different failures may be unrelated.

The potential value is moderate **if an existing comparable guest is readily available**. Building virtualization on this working AI PC adds setup/reboot risk and changes the environment being diagnosed, with no guarantee of reproducing the failure. That cost is not justified under current restrictions.

**Recommendation: NO-GO for a temporary VM on this PC now.** Safest next step: identify an already provisioned, disconnected Windows test VM on another machine. If none exists, retain the current evidence and request a separately reviewed provisioning decision rather than changing the Shahvex server. No host-wide capture or production patch is recommended by this assessment.
