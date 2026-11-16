# Local live conversation monitor

Run the website and open http://localhost:3000/controler/live-monitor (admin) or http://localhost:3000/bpo/live-monitor (BPO). Sign in with VoIP access.

The monitor has a simple **Localhost connection** form, without the existing VoIP/campaign manager:

1. Optionally edit and save **Initial script**.
2. Enter the local manual bridge control URL, normally `http://127.0.0.1:8792`, its shared secret, agent name, a Call voice choice (Lissa, Emma or Olivia), and first speaker.
3. Click **Connect localhost**. It authenticates with the manual bridge, applies the saved initial script and checks its monitor endpoint before saving the connection.
4. Dial the configured Asterisk extension (use the extension configured for your PBX). Customer transcription and generated agent text appear automatically, refreshing about every second.

Localhost means the machine running Next.js. Only HTTP loopback origins are accepted. No API username, VICIdial campaign or remote agent user is needed for this isolated local test. Asterisk, the manual AudioSocket bridge and shared tester must already be running; the form does not install these services or originate a telephone call.

Deploy the updated `deployment/vicidial-bridge/server.cjs` and `manual-test-server.cjs` beside the local manual bridge's `ai-recording.cjs`, then restart the manual bridge. Older bridges lack `/local-monitor` and will show an update/restart error. The existing local test window still expires after its configured duration.

The script and encrypted connection secret are saved per authenticated owner in `live_monitor_settings`. Credentials are never returned to the browser. Script/agent changes apply to subsequent calls: save the script, then click Connect localhost while no call is active. Changes are rejected during an active call. Active call history and up to 20 ended calls are kept only in bridge memory and cleared on bridge restart. Local tests do not submit VICIdial leads or transfer calls.

The production VICIdial monitor API remains available separately, but this page now displays local manual bridge calls. Generated agent text can run ahead of playback or include speech interrupted before it played.

## Three-voice incoming test selection — 13 November 2026

The deployed monitor now offers **Lissa, Emma and Olivia** under
**Localhost connection → Call voice**. Select one and click **Connect localhost**;
the next incoming call on the existing AudioSocket route uses that choice. The
current local route uses audio port 9020 and control port 8792. This is a website
selection for subsequent calls, not an IVR menu played to a telephone caller.

The native persistent bridge imports the current repository bridge modules,
exposes the signed monitor endpoint, validates the same three voice IDs, and
atomically saves voice/name/script settings in its existing private configuration.
A failed save restores the prior in-memory settings. Active/starting calls reject
changes. No call is interrupted just because someone changes the dropdown.
The website verifies the authenticated owner's approved voice catalog before
applying a selection and requires a same-origin POST. Credentials are not returned
to the browser. The actual saved selection is displayed without disguising legacy
voice IDs as Lissa.

The previous Jennifer/af_heart native test default was migrated to Lissa. A generic
configured-name instruction replaces the former hardcoded Jennifer introduction
in that native test configuration. User-saved initial scripts remain authoritative;
avoid hardcoding a different speaker name when switching voice names automatically.

Validation: 23 focused tests passed, TypeScript and the isolated production build
passed, staging and live monitor pages returned HTTP 200 with all three options,
and an unauthenticated staging request redirected to login. All three selections
were applied through the live authenticated website API and verified in the private
configuration. Olivia remained selected after a bridge restart; the final selection
was then returned to Lissa. No real telephone/customer call was originated.

An additional 129-test regression run returned 120 passed, 4 failed, 5 skipped. The
failures concern an existing agent-creation fixture and AI identity expectations,
not the voice-selection checks. They were not changed to force a passing result.
A pre-existing Next.js build error was fixed by importing the existing credential
crypto helper directly rather than re-exporting it from an API route; encryption
logic is unchanged.

The previous production build is retained privately under
`.data/recovery/website-before-three-voices-20261113`; the native configuration
backup is `restore/private-native/vicidial-manual.before-three-voices-20261113.json`
in the workspace. Live verification is recorded in
`.data/recovery/local-three-voice-verification.json`. Website and native local-test
services were reloaded; the voice inference services and reference recordings were
not replaced by this change.

## Campaign/local source selector — 14 November 2026

The monitor now defaults to **Campaign calls**, using the existing authenticated `/api/{portal}/live-monitor` endpoint. **Local test calls** selects the existing isolated `/local` endpoint and shows local setup controls. Switching sources aborts the previous polling request and clears its calls/selection. Campaign cards show the assigned AI profile and native campaign/remote-user metadata. Local conversations are not inserted into production agent call records. Build and TypeScript passed.

The current DIALER campaign remains paused with no production runtime lines, pending the remote registration/audio route. The three planned user accounts 78601/78602/78603 were verified active by read-only user_details API. A matching Remote Agent entry and remote dialplan still need provisioning.
