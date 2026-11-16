# Customer-requested handoff — 14 November 2026

An explicit request to speak directly to the configured licensed person now takes the requested-human route without completing remaining screening questions or waiting for model-based qualification extraction. Generic yes/no answers, hypothetical transfers, and revoked requests do not authorize this exception. The ordinary script-driven handoff still enforces qualification.

The shared worker emits a short connection acknowledgment once, one waiting status at most, and no further audio for repeated waiting acknowledgments. A direct transfer-status question receives an honest unconfirmed-status answer once. Waiting for handoff no longer triggers unanswered-screening silence prompts or the associated silence hangup. Actual customer-end commands and the configured maximum call duration still apply.

Partial answers are persisted as verbatim customer evidence and merged with saved fields. Missing answers are not invented. Answering a question and requesting transfer in the same turn retains the answer. Native lead sync starts concurrently with explicitly requested handoff, with durable retries if sync fails. Full-summary/readback checks and operator-note preservation remain; a sync failure is not falsely reported as successful delivery. Native storage capacity and configured mappings still determine what can be written successfully.

The native transfer transaction retains its call-identity, consent, destination-availability and duplicate-command checks. An uncertain provider response is not automatically resubmitted. Successful submission detaches the AI leg using the existing bridge. Only actual native human-answer confirmation establishes a connected human; spoken waiting text never does. No fixed one-second connection promise is made.

Harmless marriage questions receive light, non-romantic humor and a return to the pending question. They are not treated as lead answers or as abusive conduct. Voice engines, emotion controls and filler configuration were preserved.

Validation: 111 targeted tests passed, including isolated native command submission with incomplete information, slow/failed sync, consent revocation, ambiguous acknowledgments, duplicate prevention, AudioSocket lifecycle races, finite waiting speech and marriage-topic return. TypeScript passed. An actual local Lissa synthesis check produced the first acknowledgment and one status update without an LLM request; the next two waiting turns emitted no audio. No external phone number was dialed, and a real customer-to-human handoff remains unverified.

The adapter was reloaded only after its sessions and both bridges' active/starting calls were zero. Voice engines were not restarted. Verification details are in `restore/reports/requested-handoff-verification-20261114.json` from the workspace root.

## Lead comments and nonblocking submission — 16 November 2026

Human comment summaries now include every collected field, including name/phone details also mapped into native lead boxes. Customer-requested handoffs include an instruction to complete remaining script details, with uncollected answers explicitly unknown. An empty lead is labelled as having no collected answers. Existing operator comments and grounded customer preferences remain preserved. Permission and audio-check confirmations cannot become partial lead answers.

The requested-handoff callback returns native transfer status without waiting for outstanding comment synchronization. Synchronization starts concurrently and retains durable retry behavior. Native availability/identity checks and acknowledgment playback still apply; there is no fixed zero-latency connection guarantee. Concurrent synchronization means an immediate human connection can precede the comment update. Native field size/permissions can prevent a write; full-summary checks retain all saved information rather than silently truncating it. Increasing the configured comment limit requires corresponding native field capacity.

Validation: 41 targeted tests passed (requested handoff, native VICIdial integration and comment preservation); TypeScript passed. A held comment-sync promise cannot hold the transfer response. Native update/readback fixtures verify mapped name details and partial-handoff notes in comments. No production service was restarted and no live human-agent screen was inspected.
