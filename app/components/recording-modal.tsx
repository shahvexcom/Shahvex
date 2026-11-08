"use client";

import { useRef, useState } from "react";
import { FiDownload, FiPause, FiPlay, FiVolume2, FiX } from "react-icons/fi";

type Recording = { id: string; agent_name?: string; lead_name?: string; lead_number?: string };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const bars = [38,62,45,78,55,88,48,70,42,82,58,92,52,75,44,68,86,50,72,40,80,56,90,48,66,84,54,74,46,64];

export function RecordingModal({ call, onClose }: { call: Recording | null; onClose: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false), [current, setCurrent] = useState(0), [total, setTotal] = useState(0);
  if (!call) return null;
  const src = `/api/admin/calls/${call.id}/recording?inline=1`;
  const toggle = async () => { if (!audio.current) return; if (audio.current.paused) await audio.current.play(); else audio.current.pause(); };
  return <div className="recording-modal-backdrop" onMouseDown={onClose}>
    <section className="recording-modal" role="dialog" aria-modal="true" aria-label="Call recording" onMouseDown={event => event.stopPropagation()}>
      <header><div><small>CALL RECORDING</small><h2>{call.agent_name || "Agent"} × {call.lead_name || call.lead_number || "Client"}</h2></div><button onClick={onClose} aria-label="Close player"><FiX /></button></header>
      <div className="modal-recording-player">
        <audio ref={audio} preload="metadata" src={src} onLoadedMetadata={e => { setCurrent(0); setTotal(e.currentTarget.duration || 0); }} onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
        <div className="modal-recording-cover"><FiVolume2 /></div>
        <div className="modal-recording-wave">{bars.map((height,index)=><i key={index} className={total && index/bars.length <= current/total ? "played" : ""} style={{height:`${height}%`}} />)}</div>
        <input aria-label="Recording progress" type="range" min="0" max={total || 0} step="0.1" value={Math.min(current,total || 0)} onChange={e=>{const value=Number(e.target.value);if(audio.current)audio.current.currentTime=value;setCurrent(value)}} />
        <div className="modal-recording-time"><span>{clock(current)}</span><span>{clock(total)}</span></div>
        <div className="modal-recording-actions"><FiVolume2/><button onClick={toggle} aria-label={playing?"Pause":"Play"}>{playing?<FiPause/>:<FiPlay/>}</button><a href={`/api/admin/calls/${call.id}/recording`} aria-label="Download recording"><FiDownload/></a></div>
      </div>
    </section>
  </div>;
}
