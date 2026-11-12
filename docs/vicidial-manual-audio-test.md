# Manually dial an extension to test the AI audio connection

This is an isolated diagnostic mode, not a VICIdial campaign call. It accepts a phone CallerID name such as `ext 78660`, generates its own UUID, and uses the existing authenticated tester engine. It does not read/write website call rows, reserve production AI agents, update Native leads/comments or transfer to humans. It records test audio only in the manual bridge's private state directory.

Local automated tests exercise real HTTP/TCP AudioSocket transport and PCM response playback with a mocked tester. A real Asterisk/phone call has not yet been verified.

## Requirements

- The actual Asterisk server must show `AudioSocket` in `core show application AudioSocket`. The supplied dialplan requires that application.
- Node.js with `fetch`, `AbortSignal.any` and `AbortSignal.timeout` support (use the supported Node version already selected for the bridge), and Python 3 on the Asterisk server.
- A running shared tester service exposing authenticated `POST /tester/start`, `/tester/turn`, `/tester/interrupt` and `/tester/stop`. Use the configured secure PC AI adapter, not an arbitrary model HTTP endpoint. See [PC AI adapter deployment](pc-ai-adapter-deployment.md).
- Deploy the updated `gateway/tester-service.cjs` and existing `lib/agent-script-details.ts` on the AI host and restart only its tester adapter through its existing deployment procedure. Manual startup requires the new `derivedFromScript` capability. Existing ordinary tester requests keep their behavior.
- An existing approved voice ID and the script you want to test. Shared script extraction and voice warming must be available. Shared tester capacity must be free; a manual call does not evict another user's test.

## 1. Install the isolated bridge files

Have the server administrator copy these files into `/opt/shahvex-vicidial/`:

- `manual-test-server.cjs`
- Updated `server.cjs`
- `ai-recording.cjs`

Back up the existing AGI script and install the updated `register-call.py` at the actual dialplan path, `/var/lib/asterisk/agi-bin/register-call.py`. Keep its execute permission. Its production behavior remains the default; manual mode requires the explicit `--manual-test` argument and a separate enabled configuration.

The existing production AudioSocket process and production extension (reported as `3523`) can remain unchanged. The manual process uses separate ports: **8792 for control and 9020 for AudioSocket**, bound to loopback by default.

## 2. Fill the protected manual configuration

Copy [manual-test.json.example](../deployment/vicidial-bridge/manual-test.json.example) to `/etc/shahvex-vicidial-manual.json` on the Asterisk server. Fill:

| Setting | Value |
| --- | --- |
| `enabled` | Explicitly set `true` when ready to test |
| `secret` | A separate random secret of at least 32 characters; do not reuse the production bridge secret |
| `tester.url` | The existing secure tester adapter origin, with `/tester/*` routing available |
| `tester.secret` | That adapter's configured `SHAHVEX_PC_AI_SECRET` |
| `tester.cfClientId` / `cfClientSecret` | Existing Cloudflare Access service credentials when required; both blank for a direct HTTPS adapter |
| `agent.voice` | Actual approved voice ID from the tester |
| `agent.script` | Your actual test script |
| `agent.name`, `first`, `style` | The test profile; `first` is `ai` or `customer` |

Do not paste secrets into chat, screenshots, dialplan arguments or shell history. Let the administrator edit the protected file on the server. Restrict ownership/permissions so the Asterisk service account can read it:

```bash
sudo chown root:asterisk /etc/shahvex-vicidial-manual.json
sudo chmod 0640 /etc/shahvex-vicidial-manual.json
```

For a tester running on the same machine, a loopback HTTP origin such as `http://127.0.0.1:8774/` is supported. Remote tester connections require HTTPS. `ai.shahvex.com` is usable only if its deployment actually exposes these authenticated tester routes; a hostname alone does not prove that routing exists.

## 3. Start the temporary manual bridge

For a foreground diagnostic run, from the Linux server terminal:

```bash
cd /opt/shahvex-vicidial
sudo -u asterisk node manual-test-server.cjs /etc/shahvex-vicidial-manual.json
```

Keep that terminal open. The process must print:

```text
Isolated manual AudioSocket test ready; no VICIdial campaign calls are enabled.
```

Alternatively, install the supplied `shahvex-vicidial-manual.service` unit, adjusting Node path/service account if necessary, then run:

```bash
sudo systemctl daemon-reload
sudo systemctl start shahvex-vicidial-manual
sudo journalctl -u shahvex-vicidial-manual -n 30 --no-pager
```

The service does not automatically restart or enable itself at boot. The test window closes after 600 seconds by default (configurable 30–900 seconds), with one concurrent test call and a default 120-second per-call limit.

## 4. Add a separate manual extension

Use [extensions-manual-test.conf.example](../deployment/vicidial-bridge/extensions-manual-test.conf.example). Verify that **3524 is unused** before installing it. Include the new context in the real dialing context of the test phone; do not replace the existing `default` context or production route.

```asterisk
[shahvex-ai-manual-test]
exten => 3524,1,Answer()
 same => n,AGI(/var/lib/asterisk/agi-bin/register-call.py,manual-test,--manual-test)
 same => n,GotoIf($["${SHAHVEX_AUDIO_UUID}" = ""]?failed)
 same => n,AudioSocket(${SHAHVEX_AUDIO_UUID},127.0.0.1:9020)
 same => n,Hangup()
 same => n(failed),Hangup()
```

The administrator must add `include => shahvex-ai-manual-test` to the phone's actual context. After reviewing the resulting configuration, reload the dialplan and verify the route in the Asterisk CLI:

```text
dialplan reload
dialplan show 3524@default
```

Use the phone's actual context instead of `default` if different. No Asterisk restart is needed merely to load a new dialplan route.

## 5. Dial the manual test

Dial **3524** from your existing phone/extension. No VICIdial Remote Agent, campaign activation or fabricated VICIdial call ID is needed for this isolated test. The AGI generates a UUID, verifies that the destination is a manual-only bridge, registers the `manual-...` session and then starts AudioSocket.

If `first` is `ai`, wait for the greeting. If `customer`, speak first. Test two-way audio and interruption, then hang up. Confirm the log now reaches `Executing ... AudioSocket(...)` instead of the registration failure branch.

If it fails, provide only sanitized Asterisk and manual-service logs. Common causes are a disabled/manual JSON config, unavailable shared tester routes/credentials/voice, occupied tester capacity, wrong control/audio ports, or a missing AudioSocket application.

## Stop after testing

Stop the foreground process with Ctrl+C, or run:

```bash
sudo systemctl stop shahvex-vicidial-manual
```

Set `enabled` back to `false` in the manual JSON configuration when finished. Production registration still rejects manual mode; do not point the production `3523` route at the manual service. Passing this diagnostic test proves the tested audio path only, not VICIdial campaign routing, lead synchronization or human transfer.
