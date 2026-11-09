# Local phrase-streaming review

User approved the local candidate for live rollout after listening/testing. Production PC adapter activation uses `SHAHVEX_PHRASE_STREAM=1`; setting it to 0 and restarting an idle adapter restores sentence mode. Local test override remains available. Approval does not change the mixed benchmark results below.

Local preview: http://127.0.0.1:3001/controler. Dedicated production-build process bound to loopback, with SHAHVEX_TEST_PHRASE_STREAM=1. No Git push, Vercel deployment or production PC adapter restart was performed for this experiment. Keep the flag unset in production.

The candidate splits substantial clauses at comma/semicolon/colon boundaries after observing following whitespace. It preserves currency amounts, decimal punctuation, times and abbreviations. Existing sentence mode remains the default. Conversation transcript/history keep original model text; speech currency normalization is unchanged.

Verification: 19 targeted tests passed, 2 live checks skipped; production build/TypeScript passed. A real Ollama stream was captured once, then replayed with identical token timing into real warm Adam/CosyVoice inference in alternating A/B order. Files and results are in the Git-ignored .data/pc-ai/phrase-compare directory. WAV files include observed inter-phrase playback gaps; do not judge continuity from text alone.

| Mode | First TTS request | First PCM |
| --- | --- | --- |
| Sentence run 1 | 521 ms | 3276 ms |
| Phrase run 1 | 355 ms | 3087 ms |
| Sentence run 2 | 574 ms | 3301 ms |
| Phrase run 2 | 372 ms | 3604 ms |

Interpretation: TTS requests begin earlier, but time to first audio did not consistently improve in this small comparison. Do not promote this as a proven latency reduction. Voice/prosody/continuity and real microphone behavior still need listening tests. This is not a browser-to-Cloudflare benchmark. Larger gains require investigation of the TTS initial inference delay; changing the segmentation alone does not remove it.

Suggested local prompt: “Tell me the consultation fee, clinic opening hours, and how appointments are confirmed.” Compare numeric pronunciation, phrase joins, and interruption against baseline. Do not deploy the candidate until local acceptance.
