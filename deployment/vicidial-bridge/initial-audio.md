# Campaign initial audio guard

The campaign launcher accepts the existing protected campaign configuration file
as its first argument. Set `SHAHVEX_INITIAL_SILENCE_GUARD=1` in the campaign
service environment to enable the guard. Keep the manual bridge on its existing
launcher. The guard uses AudioSocket acceptance as its 10-second clock.

Provision the CPU-only runtime and the official dual-rate model locally before
enabling the option. From the application root:

```sh
mkdir -p .silero-runtime
npm install --prefix .silero-runtime --onnxruntime-node-install-cuda=skip onnxruntime-node@1.21.0
curl --fail --location https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.1/src/silero_vad/data/silero_vad.onnx --output .silero-runtime/silero_vad.onnx
node campaign-bridge.cjs /path/to/protected-campaign.json
```

Keep the configuration, runtime, and model outside version control. The signed
bridge health endpoint exposes `initialSilenceGuard` and `initialSilenceClock`.
Deploy the website callback schema before enabling the campaign guard. Apply
the same idle checks when enabling or disabling it in production.

Run `node --test tests/initial-audio.test.cjs` for the deterministic guard
regressions. Suspected background media and unvalidated greetings remain
eligible for ordinary conversation unless the existing machine detector
confirms a voicemail greeting.
