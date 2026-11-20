# V6: requested conversation parts only

Prerequisite: the confirmed V5 installation. This ZIP is a focused update over V5, not a new full project. Every source file included is complete and ready to replace at its matching relative path.

Changed runtime files (8):
- lib/agent-test-session.ts
- lib/agent-test-stream.ts
- lib/agent-context-answer.ts
- lib/agent-test-audio.ts
- gateway/conversation-resume.cjs
- gateway/customer-conduct.cjs
- deployment/vicidial-bridge/server.cjs
- deployment/vicidial-bridge/verify-live-flow.py

## Changes

Rephrased flexible intros now begin with Hi/Hello, preserve configured name/company, and finish with a wellbeing question. They retain the existing interruption/playback tracking.

The purpose turn rejects a model response that contains only a question or acknowledgment. It retries once, retaining the purpose requirement. If no usable purpose is generated, it uses the grounded configured script-purpose sentence and the next applicable question. Normal successful purpose generation remains model-authored. Required exact opening/disclosure handling is retained.

Rephrased-question aliases are preserved through cancellation and passed into the model progress ledger. An explicit No/Nope after a generated complete recovery question retains that negative screening answer, even if the final audio was cancelled; this exception is excluded for transfer/permission/time questions. The screenshot's answered rebate question followed by a Medicaid answer now advances to the age question in the regression fixture.

Configured representative questions are answered using the actual team/company and an explicitly assigned representative role. This avoids the blanket denial shown in the screenshots. It never asserts a government affiliation or licensed status. Multi-part purpose questions are instructed to answer the company/department/role parts too.

First ordinary end requests, including End call please, Cut the call, and That's all, receive the existing addressed two-minute invitation. A repeated end request is silent/immediate. A factual No after accepting that invitation no longer becomes a later refusal just because the invitation happened earlier. Do-not-call handling is retained.

The AudioSocket end-of-speech default increases from 350 to 1000 ms. A 600 ms pause within a sentence is retained as one waveform in the TCP regression fixture. Speech decisions await the corresponding turn rather than launching detached overlapping turns. Existing short-utterance barge-in classification is retained. If a custom launcher explicitly supplies endOfSpeechMs, that setting overrides the default and should be inspected when testing continued fragmentation. Capture remains bounded to the existing 20-second waveform limit.

A usable short STT result such as Yes is no longer replaced by a longer second decode. Empty recognition can still retry with quiet margins. This does not change the installed speech-recognition model or certify that every transcript word is accurate. Actual endpoint/STT confidence settings require the installed backend source/logs if extra words persist.

Transfer-intent and transfer-execution implementations, website layout, saved scripts, environments, credentials and dialplan are not changed in this focused update.

## Install

1. Finish existing calls. Back up the eight matching runtime files listed above, then extract the ZIP into the current project, preserving paths:

       /home/syed-nazeer-ahmad/shahvex/restore/website/Shahvex

2. In that project run `npm run build` and wait for successful completion.
3. Restart website, shared tester and campaign bridge through the existing normal launcher. The actual native-campaign-bridge launcher imports the packaged server.cjs; keep its private config unchanged.
4. Run `python3 deployment/vicidial-bridge/verify-live-flow.py`. Expected tester revision: REC397-398-v6. Website build revision check should be True. During a fresh call, the bridge's existing active-call voice revision/log must identify that revision too.
5. Test intro interruption -> full rephrased intro/wellbeing -> Okay -> purpose/question; a 600 ms mid-sentence pause; the previously answered rebate question followed by Medicaid; representative identity; first end request, invitation acceptance then factual No; repeated end request during the invitation.

## Validation and limits

42 focused recovery/memory/bridge tests and 3 selected existing transfer tests passed. After the final purpose guard refinement, its 3 requested-parts tests passed again. Four changed TypeScript files passed syntax/transpile diagnostics; three CommonJS files passed Node syntax checks; the diagnostic Python compiled. A full installed Next.js production build was not run here. Models, STT/TTS/native replies in regression tests are simulated; bridge tests use real local TCP. No service on the user's device was changed from this environment, and live-call performance remains unverified.

The recordings were reviewed using local transcription-assisted output alongside the supplied conversation screenshots. This is not a word-perfect human-audited transcript. The audio/model process also encountered a blocked external telemetry request; it was not retried.
