'use strict';
const fs = require('node:fs');
const { once } = require('node:events');
const { backendClient } = require('./backend-client.cjs');
const { localUrl } = require('./services.cjs');

async function run({ baseUrl = 'http://127.0.0.1:18787', token, config, pcm, timeoutMs = 120000, cancelOnAudio = false }) {
  localUrl(baseUrl);
  if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 640 || pcm.length > 288000) throw Error('Input must be 20ms-aligned mono PCM16 16kHz, at most 9 seconds');
  const unauthorized = await fetch(new URL('/health', baseUrl), { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (unauthorized.status !== 401) throw Error('Gateway accepted unauthenticated health request');
  const healthResponse = await fetch(new URL('/health', baseUrl), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!healthResponse.ok) throw Error(`Health authentication failed: ${healthResponse.status}`);
  const health = await healthResponse.json();
  const client = backendClient({ baseUrl, token, timeoutMs });
  const session = await client.create(config); let stream; let cleanup = false;
  const audio = []; let bytes = 0, completed = false, cancelled = false, sawAudio = false;
  try {
    stream = client.stream(session, event => {
      if (cancelled) return;
      if (event.type === 'turn-error') throw Error(`Engine pipeline failed at ${event.stage || 'unknown stage'} before expected cancellation; inspect gateway stage logs`);
      // VAD can cancel an earlier speech segment before this test cancels playback.
      if (event.type === 'cancelled') return;
      if (event.type === 'audio') {
        sawAudio = true;
        if (cancelOnAudio) { cancelled = true; stream.request.destroy(Error('Expected test cancellation')); return; }
        const chunk = Buffer.from(event.pcm, 'base64'); bytes += chunk.length;
        if (bytes > 4000000 || chunk.length % 2) throw Error('Invalid or excessive returned PCM'); audio.push(chunk);
      }
      if (event.type === 'turn-end') completed = true;
    });
    // Install rejection handling before upload begins.
    const outcome = stream.done.then(() => null, error => error);
    for (let offset = 0; offset < pcm.length; offset += 640) {
      if (!stream.request.write(pcm.subarray(offset, offset + 640))) await once(stream.request, 'drain');
    }
    stream.request.end(Buffer.alloc(6400)); // 200ms trailing silence finalizes VAD.
    const error = await outcome;
    if (error && !cancelled) throw error;
    if (!sawAudio || (!cancelOnAudio && (!completed || !bytes))) throw Error('No completed returned audio');
  } finally {
    stream?.request.destroy();
    await client.close(session); cleanup = true;
    const response = await fetch(new URL(`/sessions/${session.id}`, baseUrl), { method: 'DELETE', headers: { Authorization: `Bearer ${session.sessionToken}` }, signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (response.status !== 401) throw Error('Closed session token remains usable');
  }
  return { passed: true, authenticated: true, cleanup, cancelled, bytes, engineHealthReady: health.ready, audio: Buffer.concat(audio) };
}
if (require.main === module) {
  const [configPath, pcmPath, outputPath] = process.argv.slice(2);
  if (!configPath || !pcmPath || !outputPath) { process.stderr.write('Usage: node gateway/e2e.cjs agent.json input.pcm output.pcm [--cancel]\n'); process.exitCode = 1; }
  else run({ baseUrl: process.env.SHAHVEX_GATEWAY_URL, token: process.env.SHAHVEX_GATEWAY_TOKEN, config: JSON.parse(fs.readFileSync(configPath)), pcm: fs.readFileSync(pcmPath), cancelOnAudio: process.argv.includes('--cancel') })
    .then(({ audio, ...result }) => { if (!result.cancelled) fs.writeFileSync(outputPath, audio, { flag: 'wx' }); process.stdout.write(`${JSON.stringify(result)}\n`); })
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
module.exports = { run };
