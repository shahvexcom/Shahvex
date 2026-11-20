# Install V5 on your restored Shahvex setup

1. Back up the current matching files. Extract this ZIP into /home/syed-nazeer-ahmad/shahvex/restore/website/Shahvex, preserving the ZIP folder paths. These are complete cumulative replacement files.
2. Finish existing calls. In that project run `npm run build`. Wait for successful completion. A reboot alone does not rebuild the website.
3. Restart website, shared tester and native campaign bridge using your normal existing startup launcher. Its actual bridge imports the packaged server.cjs. Keep private-native/vicidial-campaign.json and all environments unchanged.
4. Run `python3 deployment/vicidial-bridge/verify-live-flow.py`. Tester revision must be REC390-392-393-394-v5 and the website production build must contain it.
5. Make a fresh call. Confirm the bridge log says `Active call voice flow revision: REC390-392-393-394-v5`, or inspect authenticated health for the active stream's voiceFlowRevision. PC tester status alone is insufficient because website callbacks can run their own conversation worker.
6. Test Hello before/during introduction, listening after completed introduction, interruption of an unanswered question, Yes I am here after a hearing check, and the full quiet progression. Verify answered questions stay complete. Recheck a consented transfer and the repeated hangup path.

Expected silence order: first rephrase the pending question, then hearing check, then final presence warning, then goodbye/closure. Each three-second quiet window starts after playback; inference and TTS add latency. A listening reply resumes the pending step directly.

38 focused checks and 3 selected transfer checks passed using simulated model/native responses and local TCP fixtures. This is not a production build or live-call certification. See docs/call-recovery-validation.md for scope and limitations. The VICIdial live-status warning shown in the screenshot is a separate unresolved API observation.
