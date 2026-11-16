"""Cached rendering of human-approved Lissa expressions only."""
import json,re
from pathlib import Path
DEFINITIONS={
 'reassure':{'prefix':'','instruction':'You are a helpful assistant. Speak in a calm, matter-of-fact conversational tone.<|endofprompt|>','warm':'I understand. We can take this one step at a time.'},
 'laugh':{'prefix':'[laughter] ','instruction':None,'warm':'That really made me smile. Thank you for sharing that.'},
 'sad':{'prefix':'[sigh] ','instruction':'You are a helpful assistant. Speak with gentle sadness and sincere empathy. Keep a natural conversational pace.<|endofprompt|>','warm':"I'm really sorry to hear that. Take your time; I'm listening."},
 'surprise':{'prefix':'[quick_breath] ','instruction':'You are a helpful assistant. Speak with gentle, natural surprise, not alarm or fear.<|endofprompt|>','warm':"Oh, really? I wasn't expecting that."},
}
class LissaEmotions:
 def __init__(self,existing,policy_path=None):
  self.existing=existing;self.enabled={}
  path=Path(policy_path or Path(__file__).with_name('lissa-emotions-approved.json'))
  if path.exists():
   p=json.loads(path.read_text())
   if p.get('status')=='approved' and p.get('voiceId')=='lissa':
    self.enabled={k:DEFINITIONS[k] for k in p.get('approved',[]) if k in DEFINITIONS}
 def effective(self,voice,emotion):return emotion if voice['id']=='lissa' and emotion in self.enabled else 'neutral'
 def prepare(self):
  if not self.enabled:return
  e=self.existing;voice=e.get_voice('lissa');base=e.ensure_cached(voice);frontend=e.model.frontend
  for name,d in self.enabled.items():
   if not d['instruction']:continue
   entry=dict(frontend.spk2info[base]);tokens,length=frontend._extract_text_token(d['instruction']);entry['prompt_text']=tokens;entry['prompt_text_len']=length
   frontend.spk2info['shahvex_lissa_emotion_'+name]=entry
 def to_pcm(self,output):
  t=output.get('tts_speech')
  if t is None or t.numel()==0:return b''
  return t.detach().float().clamp(-1,1).cpu().reshape(-1).mul(32767).to(self.existing.torch.int16).numpy().astype('<i2',copy=False).tobytes()
 def pcm(self,text,voice,emotion='neutral'):
  e=self.existing;emotion=self.effective(voice,emotion)
  if emotion=='neutral':yield from e.stream_pcm(text,voice);return
  d=self.enabled[emotion];clean=re.sub(r'\[(?:laughter|sigh|quick_breath|breath)\]',' ',text,flags=re.I).strip();spoken=d['prefix']+clean
  if not d['instruction']:yield from e.stream_pcm(spoken,voice);return
  for output in e.model.inference_instruct2(spoken,d['instruction'],'',zero_shot_spk_id='shahvex_lissa_emotion_'+emotion,stream=True,speed=1.0):
   pcm=self.to_pcm(output)
   if pcm:yield pcm
