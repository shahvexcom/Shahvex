"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiMic, FiMicOff, FiX, FiSquare } from "react-icons/fi";
import "./local-agent-voice-test.css";
import { ConversationRecorder } from "@/lib/browser-conversation-recorder";
export function LocalAgentVoiceTest({ agentId, agentName = "Agent", avatarUrl }: { agentId: string; agentName?: string; avatarUrl?: string }) {
  const [local, setLocal] = useState(false), [status, setStatus] = useState("");
  const [open,setOpen] = useState(false), [available,setAvailable] = useState(false), [checked,setChecked] = useState(false), [running,setRunning] = useState(false), [muted,setMuted] = useState(false), [level,setLevel] = useState(0);
  const [disabledReason,setDisabledReason]=useState("");
  const [assigned,setAssigned]=useState(''),[script,setScript]=useState(''),[scriptReady,setScriptReady]=useState(false),[scriptMode,setScriptMode]=useState('Assigned Script');
  const [consent,setConsent]=useState(false),[recording,setRecording]=useState(false),[recordSeconds,setRecordSeconds]=useState(0),[recordUrl,setRecordUrl]=useState(''),[recordExtension,setRecordExtension]=useState('webm'),[recordError,setRecordError]=useState(''),[speakerLevel,setSpeakerLevel]=useState(0);
  const [recordFinalizing,setRecordFinalizing]=useState(false);
  const recorderRef=useRef<ConversationRecorder | null>(null), recordStream=useRef<MediaStream | null>(null), recordUrlRef=useRef(''), recordingTimer=useRef<ReturnType<typeof setInterval> | null>(null), micGainRef=useRef<GainNode | null>(null), isRecording=useRef(false), recordOpen=useRef(false);
  const timingRef=useRef<(stage:string,details?:object)=>void>(()=>{});
  const muteRef=useRef(false), panel=useRef<HTMLDivElement>(null), trigger=useRef<HTMLButtonElement>(null);
  const stopRef = useRef<() => void>(() => {}), busy = useRef(false);
  useEffect(() => { setLocal(["localhost", "127.0.0.1"].includes(location.hostname)); return () => stopRef.current(); }, []);
  useEffect(() => {
    if(!local) return; let active=true;
    fetch('/api/admin/local-voice?status=1').then(async r => { const d=await r.json(); if(active){setAvailable(Boolean(r.ok && d?.enabled && d?.configured));setDisabledReason(d?.reasons?.join(' ') || d?.error || '');setChecked(true);} }).catch(()=>{if(active){setDisabledReason('Unable to reach the local availability endpoint.');setChecked(true);}});
    return ()=>{active=false;};
  },[local]);
  useEffect(()=>{
    if(!open)return;
    recordOpen.current=true;setScriptReady(false);setRecordUrl('');setRecordError('');setRecordSeconds(0);setRecordFinalizing(false);setConsent(false);setRecording(false);
    let active=true;
    fetch(`/api/admin/local-voice?scriptAgentId=${encodeURIComponent(agentId)}`).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error || 'Unable to load assigned script');if(active){setAssigned(d.script);setScript(d.script);setScriptReady(true);setScriptMode('Assigned Script');}}).catch(error=>{if(active)setStatus(error.message);});
    const prior=document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){stopRef.current();setOpen(false);}
      if(e.key==='Tab'){
        const buttons=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),a[href],audio[controls]'); if(!buttons?.length)return;
        const first=buttons[0],last=buttons[buttons.length-1];
        if(e.shiftKey && (document.activeElement===first || document.activeElement===panel.current)){e.preventDefault();last.focus();}
        else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown',key);return()=>{active=false;recordOpen.current=false;recorderRef.current?.discard();if(recordingTimer.current)clearInterval(recordingTimer.current);if(recordUrlRef.current)URL.revokeObjectURL(recordUrlRef.current);recordUrlRef.current='';document.removeEventListener('keydown',key);prior?.focus();};
  },[open,agentId]);
  if (!local) return null;
  const start = async () => {
    if (busy.current || !available) return; busy.current = true; setRunning(true);setMuted(false);muteRef.current=false;setStatus("Connecting");
    let mic: MediaStream | undefined, context: AudioContext | undefined, events: EventSource | undefined, id = "", ended = false;
    let output: AnalyserNode | undefined, mixed: MediaStreamAudioDestinationNode | undefined, visualFrame=0;
    const nodes = new Set<AudioBufferSourceNode>(); let next = 0, minGeneration = 0, pending = 0, thinkingTimer: ReturnType<typeof setTimeout> | undefined;
    let firstMic = true, speechEnd = 0; const measuredTurns = new Set<string>(); let currentTurn = "";
    const timingWindow=window as unknown as { __SHAHVEX_VOICE_TIMINGS__?: object[] };
    timingWindow.__SHAHVEX_VOICE_TIMINGS__=[];
    const metric = (stage: string, details: object = {}) => {
      const event={relayId:id,stage,atMs:performance.now(),...details};
      timingWindow.__SHAHVEX_VOICE_TIMINGS__?.push(event);
      if((timingWindow.__SHAHVEX_VOICE_TIMINGS__?.length || 0)>2000)timingWindow.__SHAHVEX_VOICE_TIMINGS__?.shift();
      console.info('[Shahvex voice timing]',event);
    };timingRef.current=metric;
    const clear = () => { nodes.forEach(n => { try { n.stop(); } catch {} }); nodes.clear(); next = 0; };
    const stop = () => {
      if (ended) return; ended = true; busy.current = false; events?.close();
      if(isRecording.current)setRecordFinalizing(true);
      recorderRef.current?.stop();mic?.getTracks().forEach(t => t.stop());clear();void context?.close();
      isRecording.current=false;setRecording(false);if(recordingTimer.current)clearInterval(recordingTimer.current);recordStream.current=null;micGainRef.current=null;cancelAnimationFrame(visualFrame);setSpeakerLevel(0);
      if (id) void fetch(`/api/admin/local-voice?id=${id}&stop=1`, { method: "POST", keepalive: true });
      clearTimeout(thinkingTimer);setRunning(false);setLevel(0);setStatus("Disconnected");
    }; stopRef.current = stop;
    try {
      context = new AudioContext({ sampleRate: 16000 }); await context.resume();
      if (context.sampleRate !== 16000) throw Error("Browser must support 16kHz audio for this local test");
      mixed=context.createMediaStreamDestination();output=context.createAnalyser();output.fftSize=256;output.connect(context.destination);output.connect(mixed);recordStream.current=mixed.stream;
      const levels=new Float32Array(output.fftSize);
      const visualize=()=>{if(ended || !output)return;output.getFloatTimeDomainData(levels);let power=0;for(const x of levels)power+=x*x;setSpeakerLevel(Math.min(1,Math.sqrt(power/levels.length)*5));visualFrame=requestAnimationFrame(visualize);};visualFrame=requestAnimationFrame(visualize);
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      if (ended) { mic.getTracks().forEach(t => t.stop()); return; }
      const custom=script!==assigned;setScriptMode(custom?'Custom Test Script':'Assigned Script');
      const response = await fetch(`/api/admin/local-voice?agentId=${encodeURIComponent(agentId)}`, { method: "POST",headers:{'Content-Type':'application/json'},body:JSON.stringify(custom ? {customScript:script} : {}) });
      const data = await response.json(); if (!response.ok) throw Error(data.error || "Unable to create test"); id = data.id;
      if (ended) { void fetch(`/api/admin/local-voice?id=${id}&stop=1`, { method: "POST" }); return; }
      events = new EventSource(`/api/admin/local-voice?id=${id}`);
      events.onmessage = message => {
        const event = JSON.parse(message.data);
        if (event.type === "timing") { currentTurn=event.turnId; metric(event.stage,{turnId:event.turnId,generation:event.generation,gatewayElapsedMs:event.elapsedMs,segmentIndex:event.segmentIndex,characters:event.characters}); }
        if (event.type === "speech-end") {speechEnd=performance.now();setStatus("Thinking");metric('speech-end',{turnId:event.turnId,vadDelayMs:event.vadDelayMs,lastSpeechOffsetMs:event.lastSpeechOffsetMs,inputOffsetMs:event.inputOffsetMs});}
        if (event.type === "timing" && event.stage==='stt-empty')setStatus('Listening');
        if (event.type === "clear") { minGeneration = event.generation; const wasSpeaking=nodes.size>0;clear();if(wasSpeaking)setStatus("Interrupted"); }
        if (event.type === "speech-start") {setStatus("Listening");metric('speech-start',{turnId:event.turnId,inputOffsetMs:event.inputOffsetMs});}
        if (event.type === "turn-end" && nodes.size===0) setStatus("Listening");
        if (event.type === "turn-error") {
          metric('engine-error',{turnId:event.turnId,code:event.code,httpStatus:event.httpStatus});
          // A failed utterance is not a transport disconnect. Keep the scoped
          // conversation alive; surface the failure and allow a fresh utterance.
          clear(); clearTimeout(thinkingTimer);
          setStatus(`Recovering: ${event.stage || "engine"}${event.code ? ` (${event.code})` : ''}. Pause, then speak again; Stop ends the session.`);
        }
        if (event.type === "closed") stop();
        if (event.type === "audio" && event.generation >= minGeneration && context && !ended) {
          const raw = atob(event.pcm), bytes = Uint8Array.from(raw, c => c.charCodeAt(0)), view = new DataView(bytes.buffer);
          const buffer = context.createBuffer(1, bytes.length / 2, 16000), samples = buffer.getChannelData(0);
          for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
          setStatus("Speaking");
          const node = context.createBufferSource(); node.buffer = buffer; node.connect(output!); nodes.add(node); node.onended = () => {nodes.delete(node);if(!ended && nodes.size===0)setStatus("Listening");};
          next = Math.max(next, context.currentTime + 0.03); if (next - context.currentTime > 120) { stop(); setStatus("Playback limit reached"); return; }
          node.start(next); next += buffer.duration;
          if(currentTurn && !measuredTurns.has(currentTurn)){
            measuredTurns.add(currentTurn);
            const scheduled=next-buffer.duration, stamp=context.getOutputTimestamp?.();
            metric('first-playback-scheduled',{turnId:currentTurn,sinceSpeechEndMs:speechEnd ? performance.now()-speechEnd : null,scheduledDelayMs:(scheduled-context.currentTime)*1000,
              estimatedOutputAtMs:stamp?.performanceTime && stamp.contextTime !== undefined ? stamp.performanceTime+(scheduled-stamp.contextTime)*1000 : null});
          }
        }
      };
      events.onerror = () => { stop(); setStatus("Voice stream disconnected"); };
      await context.audioWorklet.addModule("/shahvex-microphone-worklet.js");
      if (ended) return;
      const source = context.createMediaStreamSource(mic), worklet = new AudioWorkletNode(context, "shahvex-microphone");
      const captureGain=context.createGain();micGainRef.current=captureGain;source.connect(captureGain);captureGain.connect(mixed!);
      const muted = context.createGain(); muted.gain.value = 0; source.connect(worklet); worklet.connect(muted); muted.connect(context.destination);
      let chain = Promise.resolve();
      let batch: ArrayBuffer[] = [];
      worklet.port.onmessage = message => {
        if (ended) return;
        if(firstMic){firstMic=false;metric('microphone-first-frame');}
        const input=new Int16Array(message.data);let energy=0;for(const sample of input)energy+=sample*sample;
        const rms=Math.sqrt(energy/input.length);setLevel(muteRef.current ? 0 : Math.min(1,rms/5000));
        if(!muteRef.current && rms>=500){clearTimeout(thinkingTimer);thinkingTimer=setTimeout(()=>{if(!ended && nodes.size===0)setStatus("Thinking");},250);}
        batch.push(muteRef.current ? new ArrayBuffer(640) : message.data);
        if (batch.length < 5) return;
        const pcm = new Uint8Array(3200);
        batch.forEach((frame, index) => pcm.set(new Uint8Array(frame), index * 640)); batch = [];
        if (++pending > 25) { stop(); setStatus("Microphone upload too slow"); return; }
        chain = chain.then(async () => {
          if (ended) return;
          const r = await fetch(`/api/admin/local-voice?id=${id}`, { method: "POST", body: pcm });
          if (!r.ok) throw Error("Microphone upload failed");
        }).catch(error => { stop(); setStatus(error.message); }).finally(() => { pending--; });
      };
      setStatus("Listening");
    } catch (error) { stop(); setStatus(error instanceof Error ? error.message : "Voice test failed"); }
  };
  const stopRecording=()=>{if(isRecording.current){setRecordFinalizing(true);timingRef.current('recording-stop');}recorderRef.current?.stop();isRecording.current=false;setRecording(false);if(recordingTimer.current)clearInterval(recordingTimer.current);};
  const beginRecording=()=>{
    if(!consent || !recordStream.current || isRecording.current || recordFinalizing)return;
    try{
      if(recordUrlRef.current){URL.revokeObjectURL(recordUrlRef.current);recordUrlRef.current='';setRecordUrl('');}
      setRecordError('');setRecordSeconds(0);const recorder=new ConversationRecorder();recorderRef.current=recorder;
      recorder.start(recordStream.current,blob=>{setRecordFinalizing(false);if(!recordOpen.current)return;const url=URL.createObjectURL(blob);recordUrlRef.current=url;setRecordUrl(url);setRecordExtension(blob.type.includes('mp4')?'m4a':'webm');},message=>{setRecordError(message);stopRecording();setRecordFinalizing(false);});
      isRecording.current=true;setRecording(true);timingRef.current('recording-start');const started=performance.now();recordingTimer.current=setInterval(()=>setRecordSeconds(Math.floor((performance.now()-started)/1000)),500);
    }catch(error){setRecordError(error instanceof Error?error.message:'Recording failed');}
  };
  const close=()=>{recordOpen.current=false;recorderRef.current?.discard();stopRef.current();if(recordUrlRef.current)URL.revokeObjectURL(recordUrlRef.current);recordUrlRef.current='';setRecordUrl('');setRecording(false);setOpen(false);trigger.current?.focus();};
  const error=Boolean(status && !['Connecting','Listening','Thinking','Speaking','Interrupted','Disconnected'].includes(status));
  return <><button ref={trigger} type="button" className="sv-voice-trigger" disabled={!checked} aria-label={`Open local voice test for ${agentName}`} title={!available ? disabledReason : 'Local microphone conversation'} onClick={()=>{setStatus('Disconnected');setOpen(true);}}><FiMic/>{!checked ? 'Checking…' : available ? 'Voice test' : 'Local test disabled'}</button>
    {open && createPortal(<div className="sv-voice-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><div className="sv-voice-modal" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`voice-title-${agentId}`}>
      <button className="sv-voice-close" aria-label="Close conversation" onClick={close}><FiX/></button>
      <div className="sv-voice-avatar">{avatarUrl ? <img src={avatarUrl} alt=""/> : <span>{agentName.slice(0,1)}</span>}</div>
      <p className="sv-voice-eyebrow">LOCAL VOICE STUDIO</p><h2 id={`voice-title-${agentId}`}>{agentName}</h2><p className="sv-voice-subtitle">Your assigned script. Your verified voice.</p>
      <div className={`sv-voice-status ${error?'is-error':''}`} role="status">{status.startsWith('Recovering:') ? 'Recovering' : error ? 'Error' : status || 'Disconnected'}</div>
      <div className="sv-voice-wave" aria-label={`Microphone level ${Math.round(level*100)} percent`}>{Array.from({length:17},(_,i)=><i key={i} style={{height:`${8+level*60*(1-Math.abs(i-8)/12)}px`}}/>)}</div>
      <meter min="0" max="1" value={speakerLevel} aria-label="Actual AI playback level"/> <small>Speaker level</small>
      <p className="sv-voice-feedback">{!available ? disabledReason : error ? status : muted ? 'Microphone muted' : 'Use headphones. Speak naturally, then pause for a reply.'}</p>
      <div className="sv-voice-transcript" aria-label="Conversation transcript">Live transcript is unavailable from the current Gateway event protocol. No conversation text is recorded here.</div>
      <section className="sv-voice-script"><label htmlFor={`script-${agentId}`}>Session instructions — {scriptMode}</label><textarea id={`script-${agentId}`} rows={7} maxLength={16000} disabled={running || !scriptReady} value={script} onChange={e=>{setScript(e.target.value);setScriptMode(e.target.value===assigned?'Assigned Script':'Custom Test Script');}}/><button disabled={running || !scriptReady} onClick={()=>{setScript(assigned);setScriptMode('Assigned Script');}}>Reset to Assigned Script</button><small>Test only. Approved disclosures and restrictions remain mandatory. Stop and restart to apply edits.</small></section>
      <div className="sv-voice-controls"><button disabled={!running} aria-label={muted?'Unmute microphone':'Mute microphone'} aria-pressed={muted} onClick={()=>{muteRef.current=!muteRef.current;setMuted(muteRef.current);if(micGainRef.current)micGainRef.current.gain.value=muteRef.current?0:1;}}>{muted?<FiMicOff/>:<FiMic/>}{muted?'Unmute':'Mute'}</button>
      {!running ? <button className="sv-voice-start" disabled={!available || !scriptReady || !script.trim()} onClick={()=>void start()}><FiMic/>Start Conversation</button> : <button className="sv-voice-stop" onClick={()=>stopRef.current()}><FiSquare/>Stop Conversation</button>}</div>
      <section className="sv-voice-record"><label><input type="checkbox" checked={consent} disabled={recording} onChange={e=>setConsent(e.target.checked)}/> I consent to local recording and have permission from all participants.</label><button disabled={!running || !consent || recordFinalizing} onClick={recording?stopRecording:beginRecording}>{recordFinalizing?'Finishing recording…':recording?'Stop Recording':'Start Recording'}</button><p role="status">{recording?'● Recording — ':''}{recordSeconds}s · Mixed microphone + played AI audio</p>{recordError && <p role="alert">{recordError}</p>}{recordUrl && <><audio controls src={recordUrl}/><a download={`${agentName.replace(/[^a-z0-9_-]/gi,'-')}-${new Date().toISOString().replace(/[:.]/g,'-')}.${recordExtension}`} href={recordUrl}>Download Recording</a></>}<small>Browser only. Download before closing; closing discards this recording.</small></section>
    </div></div>,document.body)}
  </>;
}
