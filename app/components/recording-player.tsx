"use client";

import { useRef, useState } from "react";
import { FiPause, FiPlay, FiVolume2, FiVolumeX } from "react-icons/fi";

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function RecordingPlayer({ src, durationHint }: { src: string; durationHint: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false), [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(durationHint), [muted, setMuted] = useState(false), [error, setError] = useState("");
  const updateDuration = () => {
    const value = audio.current?.duration;
    if (value && Number.isFinite(value)) setDuration(value);
  };
  const toggle = async () => {
    if (!audio.current) return;
    setError("");
    if (playing) audio.current.pause();
    else try { await audio.current.play(); } catch { setError("Unable to play this recording. Download it to listen."); }
  };
  return <div className="sv-record-player">
    <audio ref={audio} src={src} preload="metadata" onLoadedMetadata={updateDuration} onDurationChange={updateDuration}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onTimeUpdate={() => setPosition(audio.current?.currentTime || 0)} onError={() => setError("Recording playback is unavailable. You can still download it.")}/>
    <button type="button" className="sv-record-play" aria-label={playing ? "Pause recording" : "Play recording"} onClick={() => void toggle()}>{playing ? <FiPause/> : <FiPlay/>}</button>
    <div className="sv-record-track"><span>Conversation playback <small>{time(position)} / {time(duration)}</small></span>
      <input aria-label="Seek recording" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 1)} disabled={!duration}
        onChange={e => { const value = Number(e.target.value); if (audio.current) audio.current.currentTime = value; setPosition(value); }}/>
    </div>
    <button type="button" className="sv-record-mute" aria-label={muted ? "Unmute recording" : "Mute recording"} onClick={() => { if (audio.current) audio.current.muted = !muted; setMuted(!muted); }}>{muted ? <FiVolumeX/> : <FiVolume2/>}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
