# Live conversation corrections — 14 November 2026

The shared VICIdial/test conversation worker now retains completed question/answer evidence across side discussions. Both affirmative and negative factual answers count. Clear Medicaid responses count as speech and coverage answers; no insurance answers are substituted into an empty transcript. Unresolved questions remain pending. A side answer returns to that question once rather than restarting the call.

Before model-generated text reaches the transcript or synthesis, the stream removes matching completed questions, duplicate permission requests, and repeated self-introductions. If the entire generated reply is removed, there is one bounded model correction attempt. This is a conservative text guard, not a claim that every semantic paraphrase can be recognized deterministically. The model also receives the complete question/answer evidence.

Flexible AI-first openings go straight to existing synthesis without an LLM request or customer speech. The script supplies the identity/company when recognized; the saved agent name is the fallback. Explicit verbatim/mandatory openings remain with the configured model. No voice model, emotion settings, speech renderer, filler selection, or audio capture thresholds were changed.

Phoenix, Arizona, United States of America is the default confirmed office location. Local Arizona time uses America/Phoenix. Weather uses current NWS data and reports lookup failure instead of guessing. Greeting, wellbeing and smoking questions receive direct answers; the smoking response identifies the assistant honestly and gives brief general information, not a fabricated medical history.

Empty STT output gets one retry with 250 ms of silence on each end of the original waveform. Recognized words are preserved. Actual silence remains rejected before STT.

Validation:
- TypeScript check: `tsc --noEmit --incremental false`.
- Targeted conversation progress, contextual answers, streaming, greeting, input, speculative session and emotion tests.
- Actual local Ollama + Lissa multi-turn run: introduction → permission → Medicare answer → Medicaid question → office-location detour → Medicaid answer → next state question → closing. No external phone number was dialed. First opening PCM arrived in 1,250 ms; this excludes telephony admission/network/playback latency.
- Actual Lissa synthesis of “Medicaid.” was transcribed by the existing Parakeet service as “Medicaid.” This is a synthetic short-word check, not a claim about all caller accents or telephone audio.
- The adapter and both audio bridges were verified to have zero active/starting sessions before the adapter was restarted. Voice engines were not restarted.

A fresh call is needed to get the updated session prompt. Existing calls are not rewritten. Real customer telephone audio and end-to-end answer-to-playback latency still require a monitored call.
