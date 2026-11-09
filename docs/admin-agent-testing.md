# Existing admin Agent Test modal

Open `/controler`, select **Agents**, then the global **Test Agent** button beside Create agent. Choose the existing agent in the modal. The tester remains inside the existing admin UI and uses its admin authentication, colors, typography, custom dropdowns, and agent avatar/name. No agent schema, model installation, or unrelated page is changed.

## Exact verification steps

1. Open **Agents > Test Agent**. The header shows the selected agent's saved name and picture/initial. The name is not editable or repeated in configuration.
2. Paste the complete business script into **Agent Script**. This is the single editable business source. Include any goals, instructions, tasks, knowledge, FAQs, conversation flow, and restrictions there.
3. Wait for extraction to finish. Open **Extracted Agent Details** items. Values are read-only excerpts from the script. Missing fields say **Not specified in script**. Change the original script to update them; Start stays disabled until the current script has been processed. Retry appears if extraction fails.
4. Choose a local male/female voice and click **Preview voice**. Select **AI Speaks First** or **Customer Speaks First** and one of the eight **Conversation Style** options. Style affects tone, not business facts.
5. Click **Start Test**, allow microphone access, and use headphones. The extra recording-consent checkbox was removed at the user?s request. The session records microphone and actual played AI audio automatically in the browser. Stop finalizes a preview/download; close safely finalizes too. Customer-first waits for input. AI-first opens once using the script. Speak one sentence and remain silent: one finalized customer message should appear.
6. Confirm the response text and audio. The speaking ripple starts only when the worklet renders non-silent PCM. During playback, speak to interrupt (automatic barge-in). Playback and ripple should stop and stale audio should not resume.
7. Ask a follow-up to check memory and verify the introduction is not repeated. **Clear Conversation** confirms during an active session, clears only displayed messages, and preserves recording/session memory. **End Session** stops and finalizes the test. Stop/restart before editing configuration.
8. Open all extracted-detail accordions; test long scripts, both scroll regions, and a narrow mobile viewport. The header, Start/Stop, and composer remain reachable. Close restores background scrolling and trigger focus.

## Why phantom customer messages were possible

The old browser capture accepted speech from a short fixed loudness threshold, without checking playback correlation or enough voiced duration. The server sent any uploaded WAV to STT, including silence, and the client appended every user event without a turn-ID/final-source check. The implementation did not use LLM-predicted customer messages; the missing guards could admit spurious STT or repeated callbacks. Historical audio was unavailable, so the exact origin of the reported incident cannot be proven retrospectively.

The current capture finalizes one recording per speech segment, resets buffers between segments, rejects short noise, and compares microphone frames against recent actual worklet output to reject correlated echo while allowing independent near-end barge-in. Browser echo cancellation and noise suppression remain enabled. Each finalized recording carries a unique turn ID. The server validates PCM16 mono 16 kHz WAV, duration, energy, and voiced frames before STT; silent/no-speech input never reaches STT. It deduplicates turn IDs and exact recording hashes and checks cancellation before committing text. Only finalized, source-marked STT/typed events for the active turn can add customer bubbles. Agent deltas update their own keyed message, never the last arbitrary row.

Development diagnostics log audio duration, VAD speech duration/energy, turn ID, STT text, and transcript commit state. Actual transcription text is logged server-side only in development. No transcripts are persisted by this feature.

## Extraction and secure endpoints

The existing `/api/admin/agent-test` route supports:

- `GET ?agentId=...`: real agent name, latest assigned script, local voices.
- `POST ?action=extract`: debounced script-only structured extraction; independent of any conversation.
- `POST ?action=preview`: selected local voice WAV preview through the existing local TTS service.
- `POST ?action=start`: revalidates the current script/extraction and saved agent name, warms an uncached local voice, starts an admin-owned session.
- `POST ?action=turn&id=...&turnId=...`: JSON text/opening or microphone WAV; NDJSON finalized transcript, text deltas, PCM, timings, errors, completion.
- `POST ?action=interrupt|stop&id=...`: cancellation and cleanup.

All actions use existing admin authorization; mutations require same origin. Browser clients never receive service endpoints or private credentials. The older `/api/voice/preview` is a cloud Groq agent API with a different cookie/voice system; it is preserved. Local previews reuse the existing tester proxy and CosyVoice `/synthesize` rather than mixing cloud voices with local selections.

Qwen3 returns JSON constrained by a strict Zod-derived schema. Every extracted item must be a verbatim script-supported excerpt after whitespace normalization; invented facts are filtered. Missing fields are empty arrays. Malformed JSON/schema results fail visibly. Requests debounce by 650 ms, abort on edits/close, reject stale results, and cache successful owner/script-hash results for ten minutes. Session creation derives goal/task/instructions/knowledge exclusively from the extraction of the current script; hidden/forged client fields are ignored. The complete original script remains in the conversation prompt.

## Audio path and state

Only the Next.js server contacts Parakeet `127.0.0.1:8766/transcribe`, Ollama `127.0.0.1:11434/api/chat`, and CosyVoice `127.0.0.1:8767/stream`/`synthesize`/`voices`/`health`. Ollama streaming and ordered sentence synthesis run concurrently. PCM16 mono 24 kHz chunks stream directly to a bounded AudioWorklet ring and resample to the browser context rate. No complete-response WAV wait is introduced for conversations. Existing speaker-feature caching is reused; models are not reinstalled or replaced.

The browser resumes AudioContext inside the Start gesture. Preview uses its own AudioContext resumed in the Preview gesture before awaiting synthesis, avoiding lost autoplay activation. Context suspension, processor failures, malformed/empty PCM, empty/silent synthesis, and startup failures surface explicit errors. A playback watchdog detects buffered audio that never renders. Speaking state/ripple comes from non-silent rendered audio, not text or merely buffered samples. The worklet resets its fractional read cursor after drain to prevent stale samples from reappearing at a later buffer boundary. Clear/interrupt generations reject all stale audio. Reduced-motion users receive a static speaking halo.

## Tests and observed results

Commands:

- `npx tsc --noEmit`
- `npm run build`
- Targeted ESLint on modified TypeScript components/helpers/routes.
- `node --test tests/agent-test-input.test.cjs tests/agent-test-stream.test.cjs tests/agent-test.test.cjs`
- Optional live tests: `$env:SHAHVEX_LIVE_AGENT_TEST='1'; node --test tests/agent-test-input.test.cjs tests/agent-test-stream.test.cjs tests/agent-test.test.cjs`

Deterministic tests cover one recording followed by prolonged silence, short-noise/echo rejection, WAV inspection, no-speech rejection before STT, final transcript source, duplicate ID/audio suppression, cancellation before transcript commit, grounded extraction/schema rejection, current-script enforcement at session start, admin isolation, memory/opening, concurrent generation/synthesis, ordered PCM, resampling/clear, silent PCM not triggering speaking, and explicit silent-TTS errors. Live tests exercise real Parakeet/Ollama/CosyVoice and the requested three-sentence explanation with an example.

Browser checks in Edge at 1366x900 and 390x844 verified one editable textarea, all eight styles, current-script Goal/FAQ extraction updates, read-only accordions, custom selectors, independent scrolling, no modal horizontal overflow, preview audio decode/playback, and focus/body-scroll restoration. A recorded spoken sentence injected into the real browser microphone stream transcribed as "I would like to book a visit." Exactly one customer message remained after ten seconds of silence. The reply triggered the actual-playback ripple; Interrupt removed it and no second customer message appeared. AI-first generated a script-relevant opening with zero customer bubbles; a follow-up answered "You can visit Monday through Friday" without repeating the introduction.

## Limitations

No historical audio exists to diagnose the original phantom-message incident conclusively. Energy VAD and correlation guards reduce false turns but are not a learned speaker-separation system; a physical microphone/headphone check remains necessary for quiet speech, noisy rooms, delayed/reverberant echo, and hardware output/mute settings. Digital non-silent rendering is verified, not physical speaker sound pressure. Headless microphone tests use recorded speech and silence rather than a human in the room.

Extraction uses an LLM for classification and can misclassify an excerpt; it cannot introduce unsupported wording into derived facts. Inspect the read-only excerpts before testing. The original script and model behavior still determine response quality. Huge/incomplete upstream outputs fail explicitly instead of silently truncating. Sessions/settings are temporary in-memory state, expire after 30 minutes of inactivity, and target one Next.js process. Service loopback addresses refer to the Next.js host, so it must run where the local AI services are reachable. Native GPU inference may finish after the website cancels its fetch.

## Files for this polish

- `app/components/agent-test-panel.tsx` and `agent-test-panel.css`
- `app/api/admin/agent-test/route.ts`
- `lib/agent-test.ts`, `lib/agent-test-stream.ts`
- `lib/agent-script-details.ts`, `lib/agent-script-extraction.ts`
- `lib/agent-test-audio.ts`, `lib/browser-speech-capture.ts`
- `lib/browser-pcm-player.ts`, `public/shahvex-playback-worklet.js`
- `tests/agent-test-input.test.cjs`, `tests/agent-test-stream.test.cjs`, `tests/agent-test.test.cjs`
- This documentation.

Final verification: production build, standalone TypeScript, and targeted ESLint passed. All 16 targeted tests passed with both live service checks enabled. The full regression suite still has the pre-existing tests/gateway-integration.test.cjs backup-security SHA-256 evidence mismatch; its backup files were not modified.

See [Recording and VoIP implementation](admin-recording-voip.md) for recording consent/download behavior, tenant-scoped VICIdial configuration, ownership, and new endpoints.

Latest voice-only/global-tester and saved-settings workflow: [Agent creation and voice library](agent-creation-voice-library.md).
