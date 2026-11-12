# Local Asterisk test on this Windows machine

Asterisk runs in the existing Ubuntu-24.04 WSL distribution. Guest SIP calls use
the `public` context, which includes extension `3524` from
`/etc/asterisk/extensions-shahvex-manual.conf`.

From a Windows SIP softphone in direct IP mode, dial:

```text
sip:3524@172.21.245.2:5060
```

The WSL address can change. Check it with:

```powershell
wsl -d Ubuntu-24.04 -- hostname -I
```

The extension answers, runs the registration AGI to obtain a UUID, then connects
to the isolated AudioSocket bridge on the WSL private address `172.21.245.2:9020`. The bridge uses the shared
AI tester on `127.0.0.1:8774`. The test profile is Jennifer with a sample two-way
audio test script. This mode does not update VICIdial leads or transfer to humans.

The bridge accepts one test call at a time, up to two minutes per call, within a
15-minute test window. Restart the window from Windows PowerShell:

The installed test configuration explicitly enables `allowUnregisteredAudio`.
For direct AudioSocket tests, send a fresh standard UUID as the first protocol
packet; no HTTP registration or SIP credentials are needed on this test port.
This option only applies to the isolated manual bridge, never the production bridge.

```powershell
wsl -d Ubuntu-24.04 -u root -- systemctl restart shahvex-local-audio-test
```

Open the Asterisk console:

```powershell
wsl -d Ubuntu-24.04 -u root -- asterisk -rvvv
```

Stop the isolated test services:

```powershell
wsl -d Ubuntu-24.04 -u root -- systemctl stop shahvex-local-audio-test shahvex-local-tester
```

The private script/voice configuration is `/etc/shahvex-vicidial-manual.json` in
WSL; it contains generated credentials and must not be published. Example files
in the repository contain no credentials. Local installation can be repeated
with `bash /mnt/e/Shahvex/deployment/vicidial-bridge/setup-local-test.sh` as WSL root.
