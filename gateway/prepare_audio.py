"""Convert an existing mono PCM16 WAV recording into gateway test PCM; no dependencies."""
import argparse
import wave
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()
    with wave.open(args.input, "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 16000):
            raise ValueError("Recording must be mono PCM16 WAV at 16000 Hz")
        pcm = wav.readframes(wav.getnframes())
    if not pcm or len(pcm) > 288000:
        raise ValueError("Use a spoken recording of at most 9 seconds")
    pcm += bytes((-len(pcm)) % 640)
    with Path(args.output).open("xb") as output:
        output.write(pcm)


if __name__ == "__main__":
    main()
