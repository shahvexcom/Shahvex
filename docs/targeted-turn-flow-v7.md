# V7: targeted conversation and caller turn completion update

Apply over the installed V6 project. This is not a full repository. Included runtime files are complete replacements and include the new gateway/turn-completion.cjs dependency. Keep unrelated files and deployment configuration as installed.

## Requested behavior

An interruption anywhere before native introduction playback completion restarts the complete flexible introduction: Hi, this is [configured name] from [configured company]. How are you doing today? This preserves the wording requested in the supplied edited session excerpt and removes the speaking-with rotation. Stop/human requests retain priority. Mandatory exact/disclosure openings retain their existing model path.

Who are you later in the call returns identity plus the pending question, or the next applicable unanswered question. If the purpose has not yet been delivered, identity is joined with purpose recovery. If script questions are exhausted, use the configured handoff step or pending transfer confirmation rather than inventing another qualification question.

A hearing-confirmation state consumes Yes I am / Yes I am here and resumes the pending point. Once positively confirmed, scheduled silence recovery skips repeated Can you hear me checks and advances to the warning instead. The original question-first quiet recovery remains.

Question aliases are registered for uniquely identifiable, high-overlap script rewordings, including ordinary model output. The completed-question guard recognizes those rewordings. Numbers, Part A/B alternatives, temporal qualifiers and negation are preserved conservatively. This reduces the repeated rebate-question pattern without treating different eligibility conditions as identical. Uncertain semantic matches remain unmatched; this is not a guarantee that every possible paraphrase is recognized.

First ordinary hangup/end requests get the existing addressed two-minute invitation. A repeated request/refusal while that invitation is pending ends silently/immediately. Do-not-call/removal requests still end immediately.

The first routine handoff statement is Let me connect you with [configured role]..., without a Would you like permission question in that first statement. Subsequent clarification/confirmation can ask a connection permission question. Contextual Yes/Yep/Okay/Hmm/Mm-hmm after the actual offer grants consent and the conversation handler returns no extra spoken line. A listening signal before any offer never grants consent. Native transfer submission remains in the existing VICIdial result/control implementation; those files were not modified. Actual native connection still depends on human availability, routing and API response.

## Dynamic caller turn handling

The bridge uses 350 ms as an initial recognition candidate boundary, not an unconditional final turn boundary. Recognition probes do not commit a user transcript. Clear short answers/greetings/end requests take a fast path. Unfinished phrases and explicit wait requests hold the original waveform. Ambiguous speech is classified by the existing configured local Ollama model as COMPLETE, INCOMPLETE or WAIT, with a 900 ms inference timeout. No new model or external speech API is required.

When more speech arrives during recognition or during an incomplete hold, buffered waveforms are joined and recognized again. Only the resulting complete turn enters the conversation. A TCP test retains I have across a 1.5-second pause and commits only I have Medicaid after the continuation. The authenticated final-probe flag is forwarded through both website/PC and manual-test transports. Early interruption probes stay lightweight.

This is bounded turn detection, not perfect knowledge of intent. Incomplete/wait states allow a 30-second quiet grace before the existing final warning/closure sequence. On classifier failure, an uncertain result receives a 1.5-second extra grace before normal conversation processing; if more speech arrives it is joined instead. The existing waveform cap remains 20 seconds of captured audio. Longer silences and recognition errors cannot be interpreted perfectly. Inference latency, classification quality and caller-side timing need physical-server validation.

## Install and verify

1. Finish existing calls. Back up the matching files and extract this package into:

       /home/syed-nazeer-ahmad/shahvex/restore/website/Shahvex

2. Run npm run build in that directory; proceed only after success.
3. Restart the website, shared tester and campaign bridge using the existing normal launcher. The native-campaign-bridge wrapper imports the updated server.cjs. Keep saved agents, native config, credentials and .env files unchanged.
4. Run python3 deployment/vicidial-bridge/verify-live-flow.py. Expected tester revision: REC399-400-v7, with website build revision True. The diagnostic can inspect the protected local bridge when its launcher config exposes the standard secret/controlPort fields. Otherwise it reports that check unavailable without printing credentials.
5. During a fresh real call, inspect Active call worker revision / the bridge log Active call voice flow revision. It must be REC399-400-v7. Tester status alone does not prove which worker handled that call.
6. Test interruption mid-intro with both Hello and Who are you; Okay after the completed intro; Who are you after a qualification answer; Yes I am here after a hearing check; an interrupted incomplete sentence with a pause above one second; first/repeated hangup; and a contextual transfer acceptance.

## Runtime file list

- lib/agent-test-session.ts
- lib/agent-test-stream.ts
- lib/agent-test.ts
- lib/agent-test-speculative.ts
- lib/vicidial-callback.ts
- lib/pc-ai-engine.ts
- gateway/conversation-resume.cjs
- gateway/customer-conduct.cjs
- gateway/handoff-intent.cjs
- gateway/question-memory.cjs
- gateway/tester-service.cjs
- gateway/turn-completion.cjs (new)
- deployment/vicidial-bridge/server.cjs
- deployment/vicidial-bridge/manual-test-server.cjs
- deployment/vicidial-bridge/verify-live-flow.py

## Validation

57 focused recovery, question-memory, transport, manual-bridge and local TCP checks passed with zero failures. Three selected existing native transfer checks passed separately. The final run includes identity, qualifier and explicit factual-answer recovery refinements. Changed TypeScript/CommonJS files passed syntax/transpile checks and the diagnostic Python compiled. Tests use simulated STT/model/TTS/native replies, plus actual local TCP connections; they do not certify real model wording or carrier behavior. No complete installed Next.js production build or live customer call was executed from this environment.

The supplied markdown export was read to inspect the user's intro wording; its escaped formatting was not copied into executable TypeScript. The WAV recordings were reviewed through local transcription-assisted output, not a word-perfect human-audited transcript. No recorded audio was sent to a new external transcription service.
