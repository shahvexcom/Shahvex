"""Opt-in isolated FP32 review; never changes the serving model or voice files."""
import os,sys,json,time,asyncio,hashlib,wave
import numpy as np
from pathlib import Path
if os.environ.get('SHAHVEX_EXACT_LATENCY_REVIEW')!='1':raise SystemExit('Explicit isolated benchmark opt-in required')
root=Path(__file__).resolve().parent
saved=json.loads(Path('/home/nazeer_ahmed/.config/shahvex-autostart/port-8767.json').read_text())['env']
for name in ('CUDA_HOME','CUDA_PATH','PATH','LD_LIBRARY_PATH','CONDA_PREFIX'):
 if name in saved:os.environ[name]=saved[name]
sys.path.insert(0,str(root))
# Resolve legacy installed-model paths inside this isolated module copy;
# do not change HOME or any serving source file.
import types
ai_root=Path('/home/nazeer_ahmed/shahvex-ai')
for entry in (ai_root,ai_root/'CosyVoice',ai_root/'CosyVoice/third_party/Matcha-TTS'):sys.path.insert(0,str(entry))
module_name='gateway.services.cosyvoice_api'
module_path=ai_root/'gateway/services/cosyvoice_api.py'
module=types.ModuleType(module_name);module.__file__=str(module_path)
source=module_path.read_text().replace('ROOT = Path.home() / "shahvex-ai"',f'ROOT = Path({str(ai_root)!r})')
sys.modules[module_name]=module
exec(compile(source,str(module_path),'exec'),module.__dict__)
wrapper=types.ModuleType('isolated_cosyvoice_safe_api');wrapper.__file__=str(root/'cosyvoice_safe_api.py')
source=(root/'cosyvoice_safe_api.py').read_text().replace('root = Path.home() / "shahvex-ai"',f'root = Path({str(ai_root)!r})').replace('from gateway.services import cosyvoice_api as existing',f'existing = sys.modules[{module_name!r}]')
exec(compile(source,wrapper.__file__,'exec'),wrapper.__dict__)
existing=wrapper.existing
from tts_polling import configure_stream_polling
from tts_native_lifecycle import configure_native_lifecycle
from tts_sampling_sync import configure_sampling_sync
import torch
folder=Path(os.environ['SHAHVEX_EXACT_REVIEW_DIR']);folder.mkdir(parents=True,exist_ok=True)
torch.cuda.set_per_process_memory_fraction(.35)
cases=['The appointment is at ten thirty on Monday morning.','Could you repeat the last part? I did not catch that.','Which day would you prefer for your appointment?']
def sample(text,voice):
 torch.manual_seed(1729);torch.cuda.synchronize();existing.model.model.token_hop_len=25
 start=time.perf_counter();pieces=[];arrivals=[]
 for pcm in existing.stream_pcm(text,voice):pieces.append(pcm);arrivals.append({'ms':round((time.perf_counter()-start)*1000),'seconds':len(pcm)/48000})
 return b''.join(pieces),arrivals

def save(name,pcm):
 with wave.open(str(folder/(name+'.wav')),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(24000);w.writeframes(pcm)

def gaps(arrivals):
 cursor=arrivals[0]['ms']+120;worst=0
 for c in arrivals:worst=max(worst,c['ms']-cursor);cursor=max(cursor,c['ms'])+c['seconds']*1000
 return round(max(0,worst))

async def main():
 out={'mode':os.environ.get('SHAHVEX_EXACT_REVIEW_MODE','sampler'),'fp32':True,'hop':25,'flowStepsUnchanged':True,'baseline':[],'candidate':[]}
 async with existing.lifespan(existing.app):
  native=existing.model.model;configure_stream_polling(native);configure_native_lifecycle(native);voice=existing.get_voice('lissa')
  if out['mode']=='batch-capacity':
   from tts_batch_capacity_review import review
   review(existing,voice,cases,folder);return
  for _ in range(2):sample(cases[0],voice)
  for i,text in enumerate(cases):
   pcm,a=sample(text,voice);save('baseline-'+str(i),pcm);out['baseline'].append({'text':text,'firstPcmMs':a[0]['ms'],'arrivals':a,'predictedGapMs':gaps(a)})
  original_inference=native.llm.inference;tokens=[]
  def record(*args,**kwargs):
   for token in original_inference(*args,**kwargs):tokens.append(token);yield token
  native.llm.inference=record;sample(cases[0],voice)
  native.llm.inference=lambda *args,**kwargs:iter(tokens)
  expected=sample(cases[0],voice)[0]
  original_sampler=native.llm.sampling;configure_sampling_sync(native.llm)
  for seed in range(100):
   torch.manual_seed(seed);scores=torch.randn(6761,device='cuda')*(1+seed%8);history=list(range(seed%11))
   torch.manual_seed(seed+1000);a=original_sampler(scores.clone(),history,25)
   torch.manual_seed(seed+1000);b=native.llm.sampling(scores.clone(),history,25)
   if a!=b:raise RuntimeError('Sampling/RNG equivalence failed')
  if out['mode']=='sampler-graph':
   from tts_decoder_graph import configure_decoder_graph
   configure_decoder_graph(native.flow.decoder)
  elif out['mode']=='working-reference':
   from tts_reference_cache_review import configure_reference_cache
   info=existing.model.frontend.spk2info[existing.ensure_cached(voice)]
   configure_reference_cache(native,info['prompt_speech_feat'].shape[1])
  elif out['mode']=='sampler-reference':
   from tts_reference_cache import configure_reference_cache
   info=existing.model.frontend.spk2info[existing.ensure_cached(voice)]
   configure_reference_cache(native,info['prompt_speech_feat'].shape[1])
  sample(cases[0],voice);actual=sample(cases[0],voice)[0]
  out['fixedTokenPcmIdentical']=expected==actual
  out['baselinePcmSha256']=hashlib.sha256(expected).hexdigest();out['candidatePcmSha256']=hashlib.sha256(actual).hexdigest()
  if expected!=actual:
   if out['mode']!='working-reference':raise RuntimeError('Original PCM differs; candidate rejected')
   save('fixed-native-original',expected);save('fixed-reference-trial',actual)
   if len(expected)!=len(actual):raise RuntimeError('Candidate changed audio length')
   a=np.frombuffer(expected,dtype='<i2').astype(np.float64);b=np.frombuffer(actual,dtype='<i2').astype(np.float64)
   out['fixedTokenWaveformSnrDb']=float(10*np.log10(np.mean(a*a)/(np.mean((a-b)**2)+1e-20)))
   out['fixedTokenWaveformCosine']=float(np.dot(a,b)/(np.linalg.norm(a)*np.linalg.norm(b)+1e-20))
   out['qualityGate']='Not deployed; waveform differs and requires listening review'

  native.llm.inference=original_inference
  for _ in range(2):sample(cases[0],voice)
  for i,text in enumerate(cases):
   pcm,a=sample(text,voice);save('candidate-'+str(i),pcm);out['candidate'].append({'text':text,'firstPcmMs':a[0]['ms'],'arrivals':a,'predictedGapMs':gaps(a)})
  if out['mode']=='working-reference':out['referenceStats']=dict(native.flow.decoder.estimator._shahvex_reference_stats)
  (folder/'results.json').write_text(json.dumps(out,indent=2));print('EXACT_REVIEW_RESULT '+json.dumps(out),flush=True)
asyncio.run(main())
