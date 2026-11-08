let context: AudioContext | undefined;

/** A quiet, filtered tap with a short fade, rather than a pitched notification beep. */
export function playUiSound(kind: "click" | "success" = "click") {
  if (typeof window === "undefined") return;
  try {
    const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    if (!context || context.state === "closed") context = new Context();
    if (context.state === "suspended") void context.resume().catch(() => {});
    const duration = kind === "success" ? .045 : .025;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = 1500;
    filter.Q.value = .5;
    const now = context.currentTime;
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.linearRampToValueAtTime(.075, now + .002);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(now);
  } catch { /* Optional interface audio must never interrupt an action. */ }
}
