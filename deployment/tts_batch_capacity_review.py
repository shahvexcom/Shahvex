"""Isolated batch capacity probe; original weights, ten steps and FP32 only."""
import inspect,textwrap,time,json,os,wave
import numpy as np
from types import MethodType

def rewrite(obj,name,replacements):
 method=getattr(obj,name);base=inspect.unwrap(method.__func__);source=textwrap.dedent(inspect.getsource(base));scope=dict(base.__globals__)
 for old,new in replacements:
  if old not in source:raise RuntimeError('Unsupported installed '+name+' implementation')
  source=source.replace(old,new)
 exec(compile(source,'<isolated-batch-'+name+'>','exec'),scope)
 setattr(obj,name,MethodType(scope[method.__name__],obj))

def review(existing,voice,cases,folder):
 import torch
 native=existing.model.model;flow=native.flow;decoder=flow.decoder;captured=[];original=flow.inference;first=[True]
 def capture(*args,**kwargs):
  if first[0]:captured.append({k:v.detach().clone() if isinstance(v,torch.Tensor) else v for k,v in kwargs.items()});first[0]=False
  return original(*args,**kwargs)
 flow.inference=capture
 for text in cases:
  first[0]=True;native.token_hop_len=25
  for _ in existing.stream_pcm(text,voice):pass
 flow.inference=original
 expected=[]
 for kwargs in captured:expected.append(original(**kwargs)[0].detach().clone())
 tf32=os.environ.get('SHAHVEX_BATCH_TF32_REVIEW')=='1';baseline_waves=[]
 if tf32:
  for mel in expected:
   torch.manual_seed(1729);baseline_waves.append(native.hift.inference(speech_feat=mel,finalize=False)[0].detach().clone())
  torch.backends.cuda.matmul.allow_tf32=True
  torch.set_float32_matmul_precision('high')
 rewrite(flow,'inference',[
  ('assert token.shape[0] == 1','assert token.shape[0] >= 1'),
  ('torch.zeros([1, mel_len1 + mel_len2, self.output_size]','torch.zeros([token.shape[0], mel_len1 + mel_len2, self.output_size]'),
  ('torch.tensor([mel_len1 + mel_len2])','torch.full((token.shape[0],), mel_len1 + mel_len2, dtype=torch.long)')])
 rewrite(decoder,'forward',[('self.rand_noise[:, :, :mu.size(2)].to(mu.device).to(mu.dtype) * temperature','self.rand_noise[:, :, :mu.size(2)].to(mu.device).to(mu.dtype).expand(mu.shape[0], -1, -1).clone() * temperature')])
 rewrite(decoder,'solve_euler',[
  ('torch.zeros([2,','torch.zeros([2 * x.shape[0],'),
  ('torch.zeros([2],','torch.zeros([2 * x.shape[0]],'),
  ('x_in[:] = x','x_in[:x.shape[0]] = x\n        x_in[x.shape[0]:] = x'),
  ('mask_in[:] = mask','mask_in[:x.shape[0]] = mask\n        mask_in[x.shape[0]:] = mask'),
  ('mu_in[0] = mu','mu_in[:x.shape[0]] = mu'),
  ('spks_in[0] = spks','spks_in[:x.shape[0]] = spks'),
  ('cond_in[0] = cond','cond_in[:x.shape[0]] = cond')])
 out={'scope':'first-chunk flow-decoder capacity only; not full speech response','fp32Storage':True,'tf32MatmulTrial':tf32,'flowSteps':10,'cases':[],'rows':[]}
 for i,kwargs in enumerate(captured):
  actual=flow.inference(**kwargs)[0]
  err=(actual-expected[i]).abs().max().item();out['cases'].append({'index':i,'singleMaxAbsMelError':err})
  if not tf32 and not torch.equal(actual,expected[i]):raise RuntimeError('Single-item native equivalence failed')
 for batch in [1,2,5,10]:
  try:
   kwargs={}
   for key,value in captured[0].items():kwargs[key]=torch.cat([captured[i%len(captured)][key] for i in range(batch)],dim=0) if isinstance(value,torch.Tensor) else value
   flow.inference(**kwargs);torch.cuda.synchronize();samples=[]
   for _ in range(3):
    start=time.perf_counter();actual=flow.inference(**kwargs)[0];torch.cuda.synchronize();samples.append(round((time.perf_counter()-start)*1000))
   errors=[(actual[i:i+1]-expected[i%len(expected)]).abs().max().item() for i in range(batch)]
   row={'batch':batch,'firstFlowChunkMs':samples,'maxAbsMelError':max(errors),'peakGpuMiB':round(torch.cuda.max_memory_allocated()/2**20)}
   if tf32:
    metrics=[]
    for j in range(min(batch,len(expected))):
     torch.manual_seed(1729);audio=native.hift.inference(speech_feat=actual[j:j+1],finalize=False)[0].detach().float()
     ref=baseline_waves[j%len(expected)].float();delta=(audio-ref).pow(2).mean();signal=ref.pow(2).mean();snr=float((10*torch.log10(signal/(delta+1e-20))).item());corr=float(torch.nn.functional.cosine_similarity(audio.reshape(1,-1),ref.reshape(1,-1)).item());metrics.append({'case':j,'snrDb':round(snr,2),'waveformCosine':corr})
     if batch==1:
      for label,tensor in [('original',ref),('tf32-trial',audio)]:
       pcm=tensor.clamp(-1,1).cpu().numpy().reshape(-1);pcm=(pcm*32767).astype('<i2')
       with wave.open(str(folder/(label+'-first-chunk.wav')),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(24000);w.writeframes(pcm.tobytes())
    row['waveformComparisons']=metrics
    row['qualityGate']='not approved; requires waveform and listening evaluation'
   elif max(errors)>1e-3:row['qualityGate']='REJECTED'
   else:row['qualityGate']='mel-only tolerance passed; waveform quality still unverified'
   out['rows'].append(row)
  except Exception as e:out['rows'].append({'batch':batch,'error':str(e)[:240]});break
 (folder/'results.json').write_text(json.dumps(out,indent=2));print('BATCH_CAPACITY '+json.dumps(out),flush=True)
