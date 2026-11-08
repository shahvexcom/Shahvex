'use strict';
const fs = require('node:fs');

function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.hash) throw Error('Engine URLs must use loopback HTTP without embedded credentials');
  return url.href;
}
async function limited(response, max = 4000000) {
  if (!response.ok) { await response.body?.cancel(); const error = Error(`Engine HTTP ${response.status}`); error.httpStatus = response.status; throw error; }
  const parts = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > max) throw Error('Engine response exceeds limit'); parts.push(Buffer.from(chunk)); }
  return Buffer.concat(parts);
}
function createServices(contract, fetcher = fetch) {
  const ollama = localUrl(contract.ollamaUrl || 'http://127.0.0.1:11434');
  const stt = contract.stt; const tts = contract.tts;
  if (stt && stt.protocol !== 'pcm16-json-text') throw Error('STT contract must be confirmed as pcm16-json-text');
  if (tts && !['json-pcm16', 'chatterbox-wav'].includes(tts.protocol)) throw Error('Unsupported TTS contract');
  if (tts?.protocol === 'json-pcm16' && ![8000, 16000].includes(tts.sampleRate)) throw Error('TTS contract must confirm raw PCM16 sample rate');
  if (stt) localUrl(stt.url); if (tts) localUrl(tts.url);
  const request = (url, options, signal) => fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
  return {
    voices: (contract.voices || []).filter(v => v.verified === true),
    async stt(audio, signal) {
      if (!stt) throw Error('Whisper contract not configured');
      let response;
      // 429 explicitly means the single native worker rejected admission. Never retry
      // timeouts/uncertain submissions or overlap accepted transcriptions.
      for (let attempt = 0; attempt < 26; attempt++) {
        signal.throwIfAborted();
        // Native faster-whisper cannot preempt inference when HTTP is aborted.
        // Drain accepted requests before releasing the queue worker, so a new
        // generation cannot overlap the still-busy native transcription.
        response = await fetcher(stt.url, { method: 'POST', headers: { 'Content-Type': 'audio/pcm;rate=16000;channels=1', ...(stt.token ? { Authorization: `Bearer ${stt.token}` } : {}) }, body: audio, redirect:'error', signal:AbortSignal.timeout(60000) });
        if(signal.aborted){await response.body?.cancel();signal.throwIfAborted();}
        if (response.status !== 429 || attempt === 25) break;
        await response.body?.cancel();
        await new Promise((resolve, reject) => {
          const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(signal.reason || Error('Cancelled')); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 200);
          signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
        });
      }
      const data = JSON.parse((await limited(response, 32000)).toString());
      signal.throwIfAborted();
      if (typeof data.text !== 'string') throw Error('STT response requires text'); return data.text;
    },
    async llm(messages, signal, timing = () => {}, onDelta = () => {}) {
      const response = await request(new URL('/api/chat', ollama), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'shahvex-natural', messages, stream: contract.ollamaStreaming === true }) }, signal);
      if (contract.ollamaStreaming) {
        if (!response.ok) { await response.body?.cancel(); throw Error(`Ollama HTTP ${response.status}`); }
        const decoder = new TextDecoder(); let pending = '', content = '', bytes = 0, done = false;
        let first = true;
        const consume = line => {
          if (!line.trim()) return;
          if(done)throw Error('Ollama data after completion');
          const data=JSON.parse(line);if(data.error)throw Error('Ollama inference failed');
          const delta=data.message?.content ?? '';if(typeof delta!=='string')throw Error('Invalid Ollama delta');
          if(content.length+delta.length>16000)throw Error('Model response exceeds limit');
          if(first&&delta){first=false;timing('llm-first-token');}
          content+=delta;if(delta)onDelta(delta);if(data.done)done=true;
        };
        for await (const chunk of response.body) {
          signal.throwIfAborted(); bytes += chunk.length; if (bytes > 128000) throw Error('Ollama response exceeds limit');
          pending += decoder.decode(chunk, { stream: true }); let index;
          while ((index = pending.indexOf('\n')) >= 0) { consume(pending.slice(0, index)); pending = pending.slice(index + 1); }
        }
        pending += decoder.decode(); consume(pending); if (!done) throw Error('Incomplete Ollama stream'); return content;
      }
      const data = JSON.parse((await limited(response, 128000)).toString());
      if (typeof data.message?.content !== 'string' || data.message.content.length>16000) throw Error('Invalid Ollama response');
      onDelta(data.message.content);return data.message.content;
    },
    async *tts(text, voiceId, signal) {
      if (!tts) throw Error('Chatterbox contract not configured');
      if (tts.protocol === 'chatterbox-wav') {
        const { decodeWav, resample } = require('./wav.cjs');
        const { textChunks } = require('./text-chunks.cjs');
        // Sequential native synthesis: no concurrent LLM/TTS GPU scheduling guessed.
        let total = 0;
        for (const part of textChunks(text)) {
          signal.throwIfAborted();
          // Like native Whisper, this wrapper cannot preempt accepted GPU work.
          // Keep the queue worker until its bounded HTTP response drains; cancellation
          // still clears browser playback immediately, and drained audio is discarded.
          const response = await fetcher(tts.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tts.token ? { Authorization: `Bearer ${tts.token}` } : {}) }, body: JSON.stringify({ text: part }), redirect: 'error', signal: AbortSignal.timeout(60000) });
          const body = await limited(response); signal.throwIfAborted();
          const wav = decodeWav(body); const pcm = resample(wav.audio, wav.sampleRate, 16000);
          total += pcm.length; if (total > 4000000) throw Error('TTS audio exceeds limit');
          for (let offset = 0; offset < pcm.length; offset += 640) { signal.throwIfAborted(); yield pcm.subarray(offset, offset + 640); }
        }
        return;
      }
      const response = await request(tts.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tts.token ? { Authorization: `Bearer ${tts.token}` } : {}) }, body: JSON.stringify(tts.protocol === 'chatterbox-wav' ? { text } : { text, voice: voiceId }) }, signal);
      if (!response.ok) { await response.body?.cancel(); throw Error(`TTS HTTP ${response.status}`); }
      if (!response.headers.get('content-type')?.startsWith('audio/pcm')) { await response.body?.cancel(); throw Error('TTS must return raw audio/pcm'); }
      let bytes = 0; let carry = Buffer.alloc(0);
      const { pcm16 } = require('./core.cjs');
      for await (const chunk of response.body) {
        signal.throwIfAborted(); bytes += chunk.length; if (bytes > 4000000) throw Error('TTS audio exceeds limit');
        carry = Buffer.concat([carry, chunk]); const frameBytes = tts.sampleRate === 16000 ? 640 : 320;
        while (carry.length >= frameBytes) { yield pcm16(carry.subarray(0, frameBytes), tts.sampleRate, 16000); carry = carry.subarray(frameBytes); }
      }
      if (carry.length % 2) throw Error('Malformed PCM response');
      if (carry.length) yield pcm16(carry, tts.sampleRate, 16000);
    },
    async health() {
      const checks = await Promise.all(['ollama', 'stt', 'tts'].map(async name => {
        const url = name === 'ollama' ? new URL('/api/tags', ollama).href : contract[name]?.healthUrl;
        if (!url) return [name, { ready: false, reason: 'Health URL not configured' }];
        try {
          localUrl(url);
          const token = contract[name]?.token;
          const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(2000), headers: token ? { Authorization: `Bearer ${token}` } : {} });
          const body = await limited(response, 128000);
          const data = JSON.parse(body.toString());
          const modelReady = name === 'ollama' ? data.models?.some(m => ['shahvex-natural', 'shahvex-natural:latest'].includes(m.name)) : data.ready === true;
          return [name, { ready: Boolean(modelReady), ...(modelReady ? {} : { reason: 'Required model not installed' }) }];
        } catch { return [name, { ready: false, reason: 'Unreachable or invalid engine health response' }]; }
      }));
      const services = Object.fromEntries(checks);
      return { ready: Boolean(stt && tts && this.voices.length && checks.every(([, v]) => v.ready)), services };
    },
  };
}
function loadContract(env = process.env) {
  return env.SHAHVEX_ENGINE_CONTRACT ? JSON.parse(fs.readFileSync(env.SHAHVEX_ENGINE_CONTRACT, 'utf8')) : {};
}
module.exports = { createServices, loadContract, localUrl, limited };
