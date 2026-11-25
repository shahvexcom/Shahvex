#!/usr/bin/env bash
set -euo pipefail

: "${DETECTION_SILERO_MODEL:?Set DETECTION_SILERO_MODEL to the existing Silero ONNX file}"
export DETECTION_TEST_PCM_DIR
DETECTION_TEST_PCM_DIR=$(mktemp -d)
trap 'rm -rf "$DETECTION_TEST_PCM_DIR"' EXIT

synthesize() {
  ffmpeg -v error -f lavfi -i "flite=text='$2':voice=slt" -ar 8000 -f s16le "$DETECTION_TEST_PCM_DIR/$1.pcm"
}

synthesize greeting 'Hello. This is a recorded greeting. I am away from the telephone right now. Please leave your name and telephone number and I will get back to you as soon as possible.'
synthesize hello 'Hello'
synthesize reply 'Yes I can hear you'
# ONNX Runtime 1.21 loads its native binding once per process.
tests=$(sed -n "s/^test('\([^']*\)'.*/\1/p" tests/call-answer.integration.cjs)
failures=0
while IFS= read -r name; do
  node --test --experimental-test-isolation=none --test-name-pattern="${name%%(*}" tests/call-answer.integration.cjs || failures=$((failures + 1))
done <<< "$tests
digital silence yields
quiet 60 Hz hum yields
existing transcript keywords in live
existing transcript keywords in shadow"
exit "$failures"
