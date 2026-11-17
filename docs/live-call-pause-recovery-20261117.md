# Live call pause and recovery — 17 November 2026

Source changes in this checkout:

- Admin Live calls exposes Pause new calls. Authenticated pause-all disables controller campaign assignments and uses existing native remote-agent INACTIVE control, leaving connected calls alone. BPO agents are excluded. Errors are reported, never described as confirmed pause. Existing Start actions resume intake.
- Native bridge submits opening immediately after media activation for either speaks-first setting. Opening remains session-initial only; metadata retry remains independent.
- Shared conversation recovery asks “Please repeat your last question.” once per session history. Further failures resume a complete prior factual sentence once, or remain silent if no grounded statement is available. Unknown audio is never treated as a customer answer. Recovery speech is retained in session history, including empty-transcription paths.
- Remove the hard-coded lost-track response and suppress model-generated lost-track/didn't-catch stock lines before speech. Keep call-wide clarification history across successfully recognized turns.
- Mid-call hello receives a brief presence acknowledgment without restarting the intro or automatically repeating a screening question. Prompt directs the model to answer the actual latest customer question using supported facts before progression.

Validation: TypeScript no-emit check passed. Two recovery/presence regressions and nine reply-integrity regressions passed. VICIdial suite: 26 passed; three network tests cannot listen on 127.0.0.1 in this sandbox (EPERM). No deployment, native call, or measured first-audio latency verification was performed. Removing the customer-first wait does not establish a subsecond synthesis/admission latency guarantee. Model semantic answer quality and production timing require call evaluation.
