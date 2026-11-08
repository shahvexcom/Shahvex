'use strict';
// Use from trusted backend processes through the authenticated SSH tunnel only.
const http = require('node:http');
const { localUrl } = require('./services.cjs');
function backendClient({ baseUrl = 'http://127.0.0.1:18787', token, timeoutMs = 120000 }) {
  localUrl(baseUrl);
  if (!token || token.length < 32) throw Error('Service token required');
  async function create(config) {
    const response = await fetch(new URL('/sessions', baseUrl), { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(config), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error(`Gateway HTTP ${response.status}`); return response.json();
  }
  function stream(session, onEvent) {
    const request = http.request(new URL(`/sessions/${encodeURIComponent(session.id)}/stream`, baseUrl), { method: 'POST', headers: { Authorization: `Bearer ${session.sessionToken}`, 'Content-Type': 'audio/pcm;rate=16000;channels=1' } });
    const deadline = setTimeout(() => request.destroy(Error('Gateway stream deadline exceeded')), timeoutMs);
    const done = new Promise((resolve, reject) => {
      request.on('error', reject);
      request.on('response', response => {
        if (response.statusCode !== 200) { response.resume(); return reject(Error(`Gateway HTTP ${response.statusCode}`)); }
        response.setEncoding('utf8'); let pending = '';
        response.on('data', chunk => {
          try {
            pending += chunk; if (pending.length > 200000) throw Error('Gateway frame exceeds limit');
            let index; while ((index = pending.indexOf('\n')) >= 0) { onEvent(JSON.parse(pending.slice(0, index))); pending = pending.slice(index + 1); }
          } catch (error) { request.destroy(error); reject(error); }
        });
        response.on('error', reject); response.on('end', () => pending ? reject(Error('Incomplete gateway event')) : resolve());
      });
    }).finally(() => clearTimeout(deadline));
    request.setTimeout(30000, () => request.destroy(Error('Gateway stream idle timeout')));
    return { request, done }; // request.write honors Node stream backpressure; end input to finish.
  }
  async function close(session) {
    const response = await fetch(new URL(`/sessions/${encodeURIComponent(session.id)}`, baseUrl), { method: 'DELETE', redirect: 'error', headers: { Authorization: `Bearer ${session.sessionToken}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error(`Gateway HTTP ${response.status}`);
  }
  return { create, stream, close };
}
module.exports = { backendClient };
