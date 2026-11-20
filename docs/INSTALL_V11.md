# V11 — recording 412: filler wellbeing, purpose and complete question order

Apply over V10. This ZIP contains five complete runtime/verification files, one updated regression-test file and this guide. Replace the same paths only.

## What changed

“Uh, I'm good”, “Um, I am good”, “Umm, I'm good, and you?” and similar greetings now pass the intro-wellbeing recognizer. A reply without a reciprocal question receives “Great, Sir, ” (or the existing explicitly known Ma'am address) followed by the actual configured calling purpose and the existing brief permission question. A reciprocal wellbeing question still receives the courtesy answer before the address and purpose. The business question follows the next acknowledgment, rather than replacing the purpose.

Initial flexible introductions now finish with exactly “How are you doing today?”, matching the interrupted-intro line. Name/company handling and required-verbatim exceptions are retained.

The recording's coverage question sits under a No branch. Previously a Yes to the rebate question could mark it not applicable. As requested, this voice-session flow now includes business questions under both Yes/No headings in their written order. It does not require the customer to say No before asking the coverage question. This is a conversation policy change: business questions are asked across branch headings, while other callers of the branch-progress helper retain their prior default behavior. It does not rewrite separate transfer commands, stop instructions or FAQs.

The question cursor no longer counts a marked interrupted assistant question as a completed asking. Question alias matching now uses the full business-question inventory, including branch questions. Intro wellbeing questions are excluded from that business inventory, so “How are you doing today?” cannot consume a screening step.

V9 native speech timing/playback and transfer execution code are unchanged. Existing silence, hangup and health-side-topic behavior is retained.

## Install

Finish active calls and copy the files into the existing V10 project. Then:

```bash
cd /home/syed-nazeer-ahmad/shahvex/restore/website/Shahvex
npm run build
```

After a successful build, restart the website, shared tester and campaign bridge using the existing launcher. A build does not restart running processes. Then:

```bash
python3 deployment/vicidial-bridge/verify-live-flow.py
```

Expected revision: REC412-v11. Verify tester/build, then the actual active voice-worker revision during a fresh call. Tester/build alone do not identify which worker handled the call.

## Fresh call

- Both initial and Hello-interrupted intros should end with “How are you doing today?”
- Say “Uh, I'm good.” Expect Great + one address + configured purpose, then wait for your acknowledgment before screening.
- Acknowledge, then answer the rebate question Yes: coverage Part A/B/Medicaid must come next, then age after its answer. Repeat once with No/Okay to verify the same business-question order.
- Confirm the existing transfer still works.

## Evidence and limits

Local transcription-assisted review of both channels of recording 412 found the intro wellbeing exchange, the rebate question and a Yes response followed by the age question; the calling purpose and Part A/B/Medicaid question were absent from that sequence. ASR wording/timing is approximate and is not a calibrated latency measurement.

68 focused tests passed, including filler-prefixed wellbeing and Yes/No/Okay branch-order regression checks, plus three existing native handoff tests. TypeScript/CJS syntax checks and Python verifier compilation passed. Recognition/model/voice responses in tests are fixtures and bridge transport uses local sockets. No full production Next build, device restart or live VICIdial call was run here. Complete installation and fresh-call verification on your device.
