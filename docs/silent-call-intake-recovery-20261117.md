# Silent-call intake recovery — 17 November 2026

User reported no voice on a call described as 3548. Actual router/bridge entries at 17:31:31 and 17:36:17 PKT carried prefix 3531 and were rejected three times with HTTP 409: “The assigned audio-line agent is not ready.” No corresponding 3548 audio arrival was present in the inspected logs.

Readback showed every campaign assignment disabled and no pool queue rows. Thus those calls were rejected before voice synthesis; the audio services themselves remained healthy. The connection has manage_remote_agents=false, so application pause does not control native remote-agent activation. Native dialing must also be paused when application intake is paused; otherwise externally routed calls can arrive at a disabled app route.

Restored only Olivia / 3548 / 78618 and Zulekha / 3531 / 78601 using the existing startVicidialAgent path. Existing campaign mappings were retained; native ACTIVE flags were not changed. Other assignments remain paused. Signed read-only resolve-prefix checks afterward returned HTTP 200 for both 3548 and 3531. Bridge/adapter health was 200 with capacity 101 and zero active/starting calls. Opening-only synthetic voice checks still produced PCM.

No actual customer call was originated. These checks confirm routing admission and voice engine function separately; a fresh caller retry is required to verify audio at the customer handset. Do not describe the prior rejected call as an accepted silent TTS session.
