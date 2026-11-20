# V10 — intro courtesy must include the calling purpose

Apply over V9. This small update contains three complete runtime/verification files and two test files. Preserve paths and replace only the included files.

The wellbeing parser missed “I'm good, and you?” and similar replies, allowing courtesy handling to fall through to the first script question before the purpose was delivered. The new explicit intro-response branch recognizes those phrases and routes them through the existing purpose reply. A meaningful wellbeing answer also resolves the race where the caller's reply arrives before the intro playback acknowledgment. A bare Hello still uses the existing intro recovery; a bare Okay does not incorrectly bypass an interrupted intro.

Expected sequence:

1. Agent introduction and wellbeing question.
2. Customer: “I'm good, and you?” / “How about you?” / equivalent.
3. Agent: “I'm doing well, thank you for asking.” + the ACTUAL configured script/goal calling purpose + the existing brief permission question.
4. Customer acknowledges: first business question, followed by normal V9 progression. The purpose is not repeated automatically.

When the caller only answers “Fine” without asking about the agent, the purpose is still delivered without an unnecessary reciprocal courtesy sentence. The fix uses the existing deterministic script-purpose path where available; it does not add a new speech-recognition or model round trip.

No bridge timing, audio capture, voice/model settings, transfer commands, hangup policy, database schema or UI files are changed by V10.

## Install

Finish active calls and copy the files into the existing V9 project, then run:

```bash
cd /home/syed-nazeer-ahmad/shahvex/restore/website/Shahvex
npm run build
```

After a successful build, restart the website, shared tester and campaign bridge with the existing launcher. Then run:

```bash
python3 deployment/vicidial-bridge/verify-live-flow.py
```

Expected revision: REC409-purpose-v10. Verify tester/build and the actual voice-worker revision during a fresh call; tester/build alone cannot identify which worker handled the call.

## Validation

67 focused tests passed. The new regression checks six wellbeing phrases, each with and without the playback acknowledgment already received, then verifies that the next Okay yields the first business question without repeating the purpose. The routine script path makes no LLM call in these fixtures. Existing V9 intro interruption, customer-first, streaming latency, health reply and transfer acceptance checks also pass in the focused suite.

TypeScript/CJS syntax checks and verifier Python compilation passed. Tests use fixture STT/TTS/model responses and local bridge sockets. No production Next build, device restart or live VICIdial call was performed here; perform the build and fresh-call check on your device.
