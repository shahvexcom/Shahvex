# Short answers and one time objection

The second supplied Max WAV was automatically transcribed through local STT;
private transcript: `.data/max-recording-1-transcript.json`. It shows repeated
introductions around definition questions, a duration question answered with an
unsupported free-consultation claim, and conflicting human/AI identity wording.

The shared tester now supplies fixed, brief replies for narrow definition,
human/AI and duration questions. A company-definition request matching the company
in the previous introduction gets only “That's the company I'm calling on behalf
of.” It does not invent the company's business model. These replies use the same
selected voice and cancellable stream as other turns. They do not prepend a name,
company, pitch or transfer claim. AI identity remains truthful.

A first soft time objection gets one request: “Would you have five minutes for a
few quick questions?” This requests permission, without promising total duration.
A second time objection gets a courteous closing. Explicit refusals and opt-outs
stay on the existing refusal path. Already offering a few minutes is not treated
as having no time. The once-per-session flag is copied only with committed
speculative session state, so discarded drafts do not consume the opportunity.

TypeScript and 32 automated checks passed. A six-turn local service audit, using
real model inference for the normal follow-up and mocked TTS, verified the offer,
yes-to-next-step progression, short virtual definition, truthful identity, unknown
duration and second-objection closing. Results: `.data/brief-reply-audit.log`.
This is not an acoustic listening test or a live telephone verification.

The persistent adapter must be reloaded to load these new changes, even if it was
reloaded for the previous fix. Its existing restart script requires Administrator
PowerShell and refuses to stop active sessions:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "E:\Shahvex\deployment\Restart-PcAiAdapter.ps1"
```

Start a fresh test afterward. No website publication or adapter restart was
performed for this revision.
