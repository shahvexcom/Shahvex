import unittest,tempfile,json,sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).parents[1]/'deployment'))
from lissa_emotions import LissaEmotions
class EmotionTest(unittest.TestCase):
 def setUp(self):
  self.folder=tempfile.TemporaryDirectory();self.addCleanup(self.folder.cleanup);self.path=Path(self.folder.name)/'policy.json'
  self.path.write_text(json.dumps({'status':'approved','voiceId':'lissa','approved':['laugh','sad','surprise','happy','reassure']}))
  self.embedding=object();self.base={'prompt_text':'original','prompt_text_len':1,'flow_embedding':self.embedding,'llm_prompt_speech_token':object()}
  self.calls=[];frontend=SimpleNamespace(spk2info={'lissa-base':self.base},_extract_text_token=lambda text:(text,len(text)))
  def inference(*args,**kwargs):self.calls.append((args,kwargs));yield {'tts_speech':b'candidate'}
  def neutral(text,voice):self.calls.append(('neutral',text,voice['id']));yield text.encode()
  self.existing=SimpleNamespace(model=SimpleNamespace(frontend=frontend,inference_instruct2=inference),get_voice=lambda _: {'id':'lissa'},ensure_cached=lambda _: 'lissa-base',stream_pcm=neutral)
  self.renderer=LissaEmotions(self.existing,self.path);self.renderer.to_pcm=lambda output:output['tts_speech']
 def test_only_approved_allowlist_and_neutral_other_voices(self):
  self.assertEqual(set(self.renderer.enabled),{'laugh','sad','surprise','reassure'})
  self.assertEqual(list(self.renderer.pcm('Hello',{'id':'jennifer'},'sad')),[b'Hello'])
  self.assertEqual(list(self.renderer.pcm('Hello',{'id':'lissa'},'happy')),[b'Hello'])
 def test_cached_instruction_preserves_original_reference_features(self):
  self.renderer.prepare();entry=self.existing.model.frontend.spk2info['shahvex_lissa_emotion_sad']
  self.assertIs(entry['flow_embedding'],self.embedding);self.assertEqual(self.base['prompt_text'],'original');self.assertNotEqual(entry['prompt_text'],self.base['prompt_text'])
  self.assertEqual(list(self.renderer.pcm('Sorry to hear that.',{'id':'lissa'},'sad')),[b'candidate'])
  args,kwargs=self.calls[-1];self.assertEqual(args[0],'[sigh] Sorry to hear that.');self.assertEqual(kwargs['zero_shot_spk_id'],'shahvex_lissa_emotion_sad');self.assertTrue(kwargs['stream']);self.assertEqual(kwargs['speed'],1.0)
 def test_laughter_uses_existing_zero_shot_path_once(self):
  self.assertEqual(list(self.renderer.pcm('[laughter] That was funny.',{'id':'lissa'},'laugh')),[b'[laughter] That was funny.'])
  self.assertEqual(self.calls[-1][0],'neutral')
 def test_approved_calm_reassurance_uses_reviewed_instruction_without_breath_prefix(self):
  self.renderer.prepare()
  entry=self.existing.model.frontend.spk2info['shahvex_lissa_emotion_reassure']
  self.assertEqual(entry['prompt_text'],'You are a helpful assistant. Speak in a calm, matter-of-fact conversational tone.<|endofprompt|>')
  self.assertIs(entry['flow_embedding'],self.embedding)
  self.assertEqual(list(self.renderer.pcm('I understand.',{'id':'lissa'},'reassure')),[b'candidate'])
  args,kwargs=self.calls[-1];self.assertEqual(args[0],'I understand.');self.assertEqual(kwargs['speed'],1.0)
 def test_unapproved_policy_stays_neutral(self):
  self.path.write_text(json.dumps({'status':'pending','voiceId':'lissa','approved':['sad']}));r=LissaEmotions(self.existing,self.path)
  self.assertFalse(r.enabled);self.assertEqual(list(r.pcm('Hello',{'id':'lissa'},'sad')),[b'Hello'])
if __name__=='__main__':unittest.main()
