# VICIdial call-answer detection

The classifier reads inbound 8 kHz PCM and existing recognition results in the production AudioSocket bridge. One worker thread per bridge runs Silero ONNX with the CPU execution provider and independent recurrent state per call. The tap drops the classifier input and preserves the call if its queue fills. Recognition, speech synthesis, and agent playback continue through their existing paths. The classifier makes no voice-engine requests.

## Configure the bridge

Deploy the bridge and website callback together. Keep `call-answer.cjs`, `call-answer-worker.cjs`, and `call-answer.json` alongside the updated `server.cjs` in the bridge's deployed source layout. The worker uses the same dual-rate Silero model format as `initial-audio.cjs`. Configure the bridge environment for its next normal rollout.

```bash
DETECTION_MODE=shadow
DETECTION_SILERO_MODEL=/absolute/path/to/silero_vad.onnx
DETECTION_ONNX_RUNTIME=/absolute/path/to/isolated/node_modules/onnxruntime-node
```

The runtime path is optional when the bridge can already resolve `onnxruntime-node`. Verify the model and runtime are readable by the bridge service user. Local verification reused ONNX Runtime Node 1.21.0 from an existing isolated runtime. No packages or models were installed. For overrides, set `DETECTION_CONFIG` to an absolute path to a JSON file. See [the defaults](../deployment/vicidial-bridge/call-answer.json) for thresholds, keywords, and dispositions.

The default mode is `shadow`. It writes signals, candidate classifications, final decisions, and proposed actions to `call-answer.jsonl` in `SHAHVEX_VICIDIAL_SPOOL`. Shadow leaves existing call handling in place. An existing deadline or caller disconnect can therefore end a call before the shadow decision. The log records those calls as preserved, with any candidate observed so far.

Set `DETECTION_MODE=live` in the bridge environment for the next bridge rollout to enable actions. For calls admitted to the live classifier, it takes over automatic silence and machine decisions. Confirmed human calls stop classification. Unconfirmed speech resets the 25-second silence window. The default mappings are `AA` for voicemail and `NA` for silence or background audio. `NA` reflects the absence of an interactive answer, and deployments with a dedicated background status can set it in `dispositions`. The callback submits the status to the existing exact-ID VICIdial hangup API and writes the acknowledged result to the website's existing Outcome field. [VICIdial Agent API](https://www.vicidial.org/docs/AGENT_API.txt#:~:text=ra_call_control%20%2D)

### Stop detection

Set `DETECTION_DISABLED=1` to disable detection at process start. To stop an already running detector without restarting, create the marker in the bridge's active spool directory. The example uses the default spool and service user.

```bash
sudo -u asterisk touch /var/lib/shahvex-vicidial/events/call-answer.disabled
```

The bridge suppresses new actions and drops active classifier state on its next check, within about 500 ms. Actions already committed to the existing hangup queue can still finish. Remove the marker to resume classification on new calls.

```bash
sudo -u asterisk rm -f /var/lib/shahvex-vicidial/events/call-answer.disabled
```

## Run verification

From the repository root, with Node 22, FFmpeg with the Flite filter, and an existing CPU Silero runtime:

```bash
export DETECTION_SILERO_MODEL=/absolute/path/to/silero_vad.onnx
export DETECTION_ONNX_RUNTIME=/absolute/path/to/isolated/node_modules/onnxruntime-node
bash scripts/test-call-answer.sh
node --test tests/three-second-hangup.test.cjs tests/voicemail-detection.test.cjs
node_modules/.bin/tsc --noEmit --incremental false
```

The test runner creates speech fixtures with offline Flite and uses isolated Node processes for ONNX Runtime 1.21's native binding. It uses an in-memory AudioSocket connection, fake voice callbacks, and a dry run of the actual hangup method with fake database and VICIdial calls.

For the supervised real test, use a test campaign with approved numbers and existing Remote Agent routes. In shadow, dial a silent handset, a voicemail greeting followed by a sustained beep, music or TV from another device, and a caller who says hello and responds to the agent. Inspect the detector log and distinguish any existing hangups from the classifier's proposed action. In live mode, repeat the cases. Record the answer time, decision time, provider-end time, exact native caller code, native call-log disposition, and website Outcome. Silence should reach a detector decision after about 25 seconds, machine prompts should show `AA`, and the interactive conversation should proceed. At the default threshold background music should show a candidate and remain connected.

Capture `nvidia-smi` and the bridge's existing recognition, first-PCM, and first-AudioSocket-write timings for the same test utterance before and after the rollout. The local synthetic benchmark measures CPU and tap cost. Production voice-engine latency requires the real host.

## Detection limits

A long utterance or tonal background alone produces a lower-confidence decision. Both can be present when a human answers. These signals stay below the default live threshold. Speech-only television, accents or languages outside the reviewed prompts, and mixed human and background audio can remain undetermined. The configured confidence scores are heuristics. The synthetic fixtures do not establish a field false-hangup rate.
