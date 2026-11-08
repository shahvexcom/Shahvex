import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'gateway'))
from analyze_streaming_session import correlate,percentile

class Tests(unittest.TestCase):
    def test_percentiles_are_explicit_linear_interpolation(self):
        self.assertEqual(percentile([3.86,5.62,5.08,7.74,7.6],.5),5.62)
        self.assertEqual(percentile([3.86,5.62,5.08,7.74,7.6],.95),7.712)
        self.assertIsNone(percentile([],.95))
    def test_completed_metrics_exclude_later_cancelled_response(self):
        browser={'relayId':'fixture','turns':[],'alignment':[]}
        gateway=[]
        for tid,cancel in [('one',False),('two',True)]:
            browser['turns'].append(dict(turnId=tid,endpointArrivalToPlaybackScheduledMs=1000,sttMs=100,llmFirstTokenMs=50,llmFirstTextChunkMs=100,ttsFirstPcmMs=600))
            browser['alignment'].append(dict(turnId=tid,deviceOutputEstimateSeconds=2,lastMicSpeechEstimateSeconds=1))
            gateway.extend([dict(turnId=tid,stage='stt-start',elapsedMs=1),dict(turnId=tid,stage='llm-first-text-chunk',characters=30),dict(turnId=tid,stage='tts-complete')])
            if cancel:gateway.append(dict(turnId=tid,stage='turn-cancelled'))
        wave={'durationSeconds':5,'rmsThreshold':500,'silenceIntervals':[dict(startSeconds=1,endSeconds=2,durationSeconds=1)]}
        result=correlate(browser,gateway,wave)
        self.assertEqual(result['completedTurns']['n'],1)
        self.assertEqual(result['allResponseStartsIncludingLaterCancelled']['n'],2)
        wave['silenceIntervals']*=2
        self.assertEqual(correlate(browser,gateway,wave)['completedTurns']['n'],0)

if __name__=='__main__':unittest.main()
