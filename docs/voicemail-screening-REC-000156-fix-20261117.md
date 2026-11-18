# Voicemail and call-screening fix for REC-000156 — 17 November 2026

User authorized fixing voicemail hangup after the read-only five-recording review. This change addresses only machine-message detection and termination; the audit's unrelated reminder-budget, recording-metadata/duration and missing incoming-media findings were not changed.

The shared detector now recognizes the reported record-name-and-reason screening request, this-person-unavailable/additional-message wording, and please-reply/record-after-tone prompts, plus closely related screening/name-at-tone variants. Existing protections remain for human questions, reported/quoted greetings, ordinary hold requests, generic unavailability and personal discussion of voicemail. Digits alone are not classified as voicemail.

The bridge also checks recognized user-text events before counting a customer response or accepting subsequent audio. Recognized voicemail or screening clears queued/partial agent audio, aborts the current turn and closes the direct AudioSocket without waiting for a database/provider hangup acknowledgment. The exact-call hangup remains durably queued for reconciliation. No reply, goodbye or presence prompt is generated after recognition. End logs distinguish detected voicemail/screening from the opening no-response cutoff. The local dialplan controls direct-call termination; an unavailable native provider API still requires its queued reconciliation.

Verification:

- 62 detector, engine, bridge and existing voice/control regressions passed. Tests include the three exact missed texts, no model/TTS/PCM reply, human false-positive cases, late-PCM rejection and immediate local closure with a hung backend.
- Replayed real customer-channel audio from REC-000156 (screening opening and later unavailable/tone message) and REC-000152 (forwarded voicemail greeting), resampled to 16 kHz in temporary analysis files. All three isolated updated sessions returned voicemail end with zero speech events and zero model/TTS requests.
- Production build and TypeScript checks passed into `.next-voicemail-screening-156`.
- After deployment, the production shared adapter processed the same three real clips in isolated sessions: all returned `end_call` reason voicemail and zero delta/PCM/error events. Timings were 141, 77 and 50 ms for pre-recorded clip processing; these are not handset or real-time greeting detection timings. No customer calls were dialed.
- Deployment guarded by zero active/starting/connected media calls on both bridges and zero adapter sessions/busy voices. Website, adapter and both bridges restarted successfully. Capacity remains 101. Agent intake, routing, opening timing and other settings were preserved.

Detection is based on recognized machine speech. An intro already transmitted before the machine is recognizable cannot be retracted; this change prevents subsequent conversation and flushes any remaining queued intro/audio as soon as detection succeeds. No additional answering-machine detection waiting stage was introduced.

Production audio-clip verification: `restore/reports/voicemail-screening-156-live-verification.json` under workspace root.
