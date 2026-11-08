"""Read-only waveform analysis. Requires existing PyAV; no STT or model loading."""
import argparse
import array
import json
import math
import sys


def analyze(path, threshold=500, min_silence_ms=500):
    import av
    samples = array.array('h')
    with av.open(path) as container:
        stream = container.streams.audio[0]
        original_channels = stream.codec_context.channels
        original_rate = stream.codec_context.sample_rate
        resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
        for frame in container.decode(stream):
            for converted in resampler.resample(frame):
                samples.frombytes(bytes(converted.planes[0])[:converted.samples * 2])
        for converted in resampler.resample(None):
            samples.frombytes(bytes(converted.planes[0])[:converted.samples * 2])
    if sys.byteorder != 'little':
        samples.byteswap()
    intervals = []
    start = None
    for offset in range(0, len(samples), 320):
        chunk = samples[offset:offset + 320]
        quiet = math.sqrt(sum(x * x for x in chunk) / len(chunk)) < threshold
        at = offset / 16000
        if quiet and start is None:
            start = at
        if not quiet and start is not None:
            if (at - start) * 1000 >= min_silence_ms:
                intervals.append({'startSeconds': round(start, 3), 'endSeconds': round(at, 3), 'durationSeconds': round(at - start, 3)})
            start = None
    duration = len(samples) / 16000
    if start is not None and (duration - start) * 1000 >= min_silence_ms:
        intervals.append({'startSeconds': round(start, 3), 'endSeconds': round(duration, 3), 'durationSeconds': round(duration - start, 3)})
    return {'durationSeconds': round(duration, 3), 'originalChannels': original_channels,
            'originalSampleRate': original_rate, 'analysisRate': 16000, 'rmsThreshold': threshold,
            'silenceIntervals': intervals, 'speakerAttribution': 'unknown; no diarization/transcripts performed',
            'processingLatency': 'unmeasurable without synchronized events and speaker attribution'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('recording')
    args = parser.parse_args()
    print(json.dumps(analyze(args.recording), indent=2))
