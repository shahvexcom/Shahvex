"""Offline metadata/waveform correlation; no inference, network, or service changes."""
import argparse
import json
from pathlib import Path
from analyze_recording import analyze

def percentile(values, probability):
    values=sorted(values)
    if not values:return None
    at=(len(values)-1)*probability;lo=int(at);hi=min(lo+1,len(values)-1)
    return round(values[lo]+(values[hi]-values[lo])*(at-lo),3)

def correlate(browser, gateway, wave):
    turns={t['turnId']:t for t in browser['turns']};rows=[]
    for alignment in browser['alignment']:
        output=alignment['deviceOutputEstimateSeconds']
        if output is None:continue
        candidates=[s for s in wave['silenceIntervals'] if abs(s['endSeconds']-output)<=.25 and abs(s['startSeconds']-alignment['lastMicSpeechEstimateSeconds'])<=.35]
        if len(candidates)!=1:continue
        interval=candidates[0];tid=alignment['turnId'];turn=turns[tid]
        events=[e for e in gateway if e.get('turnId')==tid]
        stages={e['stage']:e for e in events}
        complete='tts-complete' in stages and not any(s in stages for s in ('turn-error','turn-cancelled'))
        rows.append(dict(turnId=tid,completed=complete,recordedSpeechEnd=interval['startSeconds'],
            recordedResponseOnset=interval['endSeconds'],recordedLatencySeconds=interval['durationSeconds'],
            deviceEstimateSeconds=output,schedulingMs=turn['endpointArrivalToPlaybackScheduledMs'],
            queueMs=round(stages['stt-start']['elapsedMs'],2),sttMs=turn['sttMs'],tokenMs=turn['llmFirstTokenMs'],
            phraseMs=turn['llmFirstTextChunkMs'],phraseCharacters=stages['llm-first-text-chunk']['characters'],ttsAndWavMs=turn['ttsFirstPcmMs']))
    def stats(selected):
        values=[r['recordedLatencySeconds'] for r in selected]
        return dict(n=len(values),p50=percentile(values,.5),p95=percentile(values,.95),worst=max(values) if values else None)
    return dict(recordingSeconds=wave['durationSeconds'],relayId=browser['relayId'],rmsThreshold=wave['rmsThreshold'],
        measurement='20ms RMS boundaries in mixed digital recording, event-aligned; not calibrated physical speaker onset',
        completedTurns=stats([r for r in rows if r['completed']]),allResponseStartsIncludingLaterCancelled=stats(rows),turns=rows)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('recording');p.add_argument('browser');p.add_argument('gateway');p.add_argument('--output',required=True);args=p.parse_args()
    browser=json.loads(Path(args.browser).read_text(encoding='utf-8-sig'))
    gateway=[json.loads(line) for line in Path(args.gateway).read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    results=[correlate(browser,gateway,analyze(args.recording,threshold=t)) for t in (250,500,1000)]
    Path(args.output).write_text(json.dumps(results,indent=2),encoding='utf-8')
    for result in results:
        print(json.dumps({k:v for k,v in result.items() if k!='turns'}))
