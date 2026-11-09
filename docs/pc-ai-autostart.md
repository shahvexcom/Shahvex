# Installed PC AI automatic startup

Windows user: DESKTOP-IRGM7IC\Nazeer Ahmed. WSL distribution: Ubuntu-24.04. Repository location must remain E:\Shahvex.

## Installed components

- Windows task `Shahvex-PC-AI-Autostart`: boot trigger (30-second delay) and user-logon trigger; S4U under the WSL-owning user, no stored Windows password; unlimited duration, single instance, scheduler restart on failure. Registered using Windows administrator consent because the initial non-admin registration was denied.
- `deployment/Watch-PcAi.ps1`: hidden WSL keep-alive and a 15-second adapter recovery loop. The explicit WSL command matters because systemd services alone do not guarantee WSL remains running.
- Existing Cloudflared Windows service: Automatic, already configured to restart after failure (20-second delay). Its credentials and routes were not changed.
- Existing Ollama systemd service: enabled.
- Ubuntu system units `shahvex-port-8766.service` through `shahvex-port-8773.service`: enabled and active, Restart=always, five-second restart delay. Exact current executable, arguments, directory and private environment were captured; no guessed engine commands. TTS uses the approved cancellation-safe wrapper.
- PC adapter: loopback 8774, existing protected key and approved phrase-streaming configuration preserved. The watchdog launches it through the existing protected launcher when its listener disappears.

AI ports covered: 11434, 8766, 8767, 8768, 8769, 8770, 8771, 8772, 8773 and 8774. Local Next development/preview servers are not required for the Vercel website and were not added to startup.

## Preservation and verification

Existing Ubuntu terminal processes were not killed during installation. Each new systemd unit initially waits while its port is occupied; when that existing process exits, the unit takes over and then supervises its replacement. Private snapshots are in `/home/nazeer_ahmed/.config/shahvex-autostart` with directory 0700 and files 0600. They contain process environments: never print or commit them.

Verified: all eight Ubuntu units active; experimental gateway 8773 gracefully stopped and automatically recovered under systemd. Windows watchdog ran under the correct S4U user and started the WSL keep-alive. With zero active AI sessions, the old Windows adapter was stopped by its owning account; the watchdog created a different Node PID and authenticated health passed. This validates live recovery, not a full power-cycle. GPU engines/models were not restarted as part of recovery testing.

Actual reboot and pre-login startup remain to be checked during the user's next planned restart. Do not reboot an active call to test this. Initial model loading can take time after boot. Normal operation does not need visible terminals.

## Inspect status

```powershell
Get-ScheduledTask -TaskName Shahvex-PC-AI-Autostart
powershell.exe -NoProfile -File E:\Shahvex\deployment\Start-PcAiAdapter.ps1 -Action Status
wsl -d Ubuntu-24.04 -- systemctl is-active shahvex-port-8766 shahvex-port-8767 shahvex-port-8773
```

Watchdog status and errors live in the protected `.data/pc-ai` directory. Do not post its environment files or service credentials. Windows BIOS/UEFI automatic power-on after AC returns is a separate hardware setting; no BIOS, power plan, automatic Windows login or credential changes were made.

Reference: Microsoft WSL systemd documentation, https://learn.microsoft.com/en-us/windows/wsl/systemd ; Task Scheduler security contexts, https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks .
