'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const defaults = require('./call-answer.json');
const hangupSwitch = {
  VOICEMAIL: 'HANGUP_ON_VOICEMAIL',
  SILENCE: 'HANGUP_ON_SILENCE',
  'TV/BACKGROUND': 'HANGUP_ON_TV',
};

function shouldHangUp(config, { classification, confidence, signal }) {
  return Boolean(config[hangupSwitch[classification]] && config.dispositions[classification] &&
    confidence >= config.hangupConfidence &&
    (classification !== 'SILENCE' || signal !== 'inactive_after_speech' || config.HANGUP_ON_SILENCE_AFTER_SPEECH));
}

function createCallAnswer({ spoolDir, env = process.env, overrides = {} }) {
  const entries = new Map();
  let worker;
  let disabled = env.DETECTION_DISABLED === '1';
  const marker = path.join(spoolDir, 'call-answer.disabled');
  const logFile = path.join(spoolDir, 'call-answer.jsonl');
  let writing = false;
  const lines = [];
  function flush() {
    if (writing || !lines.length) return;
    writing = true;
    fs.appendFile(logFile, lines.splice(0).join(''), { mode: 0o600 }, error => {
      writing = false;
      if (error) process.emitWarning('Could not write call-answer log', { code: error.code });
      flush();
    });
  }
  function log(callId, event, fields = {}) {
    if (lines.length >= 1024) return;
    lines.push(JSON.stringify({ at: new Date().toISOString(), callId, event, ...fields }) + '\n');
    flush();
  }

  let config;
  try {
    const custom = env.DETECTION_CONFIG ? JSON.parse(fs.readFileSync(env.DETECTION_CONFIG, 'utf8')) : {};
    config = { ...defaults, ...custom, ...overrides, mode: env.DETECTION_MODE || overrides.mode || custom.mode || defaults.mode };
    if (!['shadow', 'live'].includes(config.mode)) throw Error('Invalid DETECTION_MODE');
    for (const key of [...Object.values(hangupSwitch), 'HANGUP_ON_SILENCE_AFTER_SPEECH']) {
      if (typeof config[key] !== 'boolean') throw Error(`Invalid ${key}`);
    }
    for (const [name, value] of Object.entries(defaults)) {
      if (typeof value === 'number' && (!Number.isFinite(config[name]) || config[name] <= 0)) throw Error(`Invalid ${name}`);
    }
    if (config.hangupConfidence > 1 || config.vadProbability >= 1 || config.queueFrames < 1 ||
        !Array.isArray(config.keywords) || config.keywords.some(word => typeof word !== 'string' || !word.trim()) ||
        Object.keys(defaults.dispositions).some(key => !/^[A-Z0-9]{1,6}$/.test(config.dispositions?.[key] || ''))) {
      throw Error('Invalid call-answer configuration');
    }
  } catch (error) {
    disabled = true;
    log(null, 'error', { reason: error.message });
  }

  const mode = config?.mode;
  const shadowFile = path.join(spoolDir, 'call-answer-shadow.jsonl');
  const shadowCalls = new Map();
  function audit(entry, fields = {}, reason) {
    if (mode !== 'shadow' || !shadowCalls.delete(entry.id)) return;
    const classifierWouldHangup = shouldHangUp(config, fields);
    const row = {
      call_id: entry.id,
      started_at: entry.startedAt,
      answered_at: entry.answeredAt,
      recorded_at: new Date().toISOString(),
      decision_latency_ms: fields.latencyMs ?? Math.round(performance.now() - entry.start),
      class: fields.classification || 'UNDETERMINED',
      confidence: fields.confidence ?? 0,
      signals: [...new Set([...entry.signals, ...(fields.signals || [])])],
      transcript_so_far: entry.transcripts,
      would_hangup: classifierWouldHangup && entry.canHangup(fields),
      classifier_would_hangup: classifierWouldHangup,
      reason: reason || fields.signal,
      final_status: null,
    };
    fs.appendFile(shadowFile, JSON.stringify(row) + '\n', { mode: 0o600 }, error => {
      if (error) log(entry.id, 'shadow_write_failed', { reason: error.code });
    });
  }
  function stop(entry, reason) {
    if (!entries.delete(entry.id)) return;
    try { worker?.postMessage({ id: entry.id, type: 'stop' }); } catch { /* The worker has stopped. */ }
    if (reason && reason !== 'call_ended') entry.auditReason = reason;
    if (reason) log(entry.id, 'preserved', {
      classification: 'UNDETERMINED', confidence: 0, signals: [],
      ...entry.candidate, latencyMs: Math.round(performance.now() - entry.start),
      reason, wouldHangup: false,
    });
  }
  function fail(reason, detail) {
    for (const entry of entries.values()) stop(entry, reason);
    log(null, 'error', { reason, detail });
    worker = undefined;
  }
  function message({ id, event, ...fields }) {
    if (event === 'ready') return log(null, 'ready', { mode });
    if (id === undefined && event === 'error') return fail(fields.reason, fields.detail);
    const entry = entries.get(id);
    if (!entry) return;
    if (event === 'ack') { entry.queued -= fields.weight; return; }
    if (event === 'error') return stop(entry, fields.reason);
    if (event === 'candidate') entry.candidate = fields;
    if (event === 'signal' && mode === 'shadow') entry.signals.add(fields.signal);
    if (event !== 'decision') return log(id, event, fields);
    entry.candidate = fields;
    const disposition = config.dispositions[fields.classification];
    const wouldHangup = shouldHangUp(config, fields);
    log(id, 'decision', { ...fields, mode, wouldHangup, disposition });
    audit(entry, fields);
    stop(entry);
    if (!wouldHangup || mode !== 'live' || disabled || entry.pendingLive) return;
    // Check the kill switch again immediately before committing a new action.
    entry.pendingLive = true;
    fs.stat(marker, error => {
      if (!error || error.code !== 'ENOENT' || disabled || entry.closed) {
        return log(id, 'hangup_result', { result: 'suppressed' });
      }
      try {
        const submitted = entry.hangup(fields, disposition);
        log(id, 'hangup_result', { result: submitted ? 'queued' : 'suppressed' });
      } catch {
        log(id, 'hangup_result', { result: 'callback_error' });
      }
    });
  }
  if (!disabled && env.DETECTION_SILERO_MODEL) {
    disabled = fs.existsSync(marker);
    try {
      worker = new Worker(path.join(__dirname, 'call-answer-worker.cjs'), {
        workerData: {
          config,
          model: path.resolve(env.DETECTION_SILERO_MODEL),
          runtime: env.DETECTION_ONNX_RUNTIME && path.resolve(env.DETECTION_ONNX_RUNTIME),
        },
      });
      worker.on('message', message);
      worker.on('error', () => fail('worker_error'));
      worker.on('exit', code => { if (worker) fail(`worker_exit_${code}`); });
      worker.unref();
    } catch {
      fail('worker_start_failed');
    }
  } else if (!disabled) {
    log(null, 'error', { reason: 'DETECTION_SILERO_MODEL_missing' });
  }
  const check = worker && setInterval(() => {
    fs.stat(marker, error => {
      disabled = !error || error.code !== 'ENOENT';
      if (disabled) for (const entry of entries.values()) stop(entry, 'disabled');
    });
  }, 500);
  check?.unref();

  return {
    start(id, connectedAt, hangup, canHangup = () => true) {
      const active = !disabled && Boolean(worker) && !entries.has(id);
      if ((!active && mode !== 'shadow') || shadowCalls.has(id)) return;
      const start = performance.now() - Math.max(0, Date.now() - connectedAt);
      const entry = {
        id, start, hangup, canHangup, queued: 0, signals: new Set(), transcripts: [],
        startedAt: new Date().toISOString(), answeredAt: new Date(connectedAt).toISOString(),
        auditReason: active ? undefined : 'detector_unavailable',
      };
      if (mode === 'shadow') shadowCalls.set(id, entry);
      if (active) {
        entries.set(id, entry);
        try { worker.postMessage({ id, type: 'start', start }); }
        catch { stop(entry, 'worker_send_failed'); }
      }
      log(id, 'start', { mode });
      function send(type, data = {}, frames = 1) {
        if (!entries.has(id) || disabled) return;
        if (entry.queued + frames > config.queueFrames) return stop(entry, 'queue_overflow');
        entry.queued += frames;
        try { worker.postMessage({ id, type, at: performance.now(), weight: frames, ...data }); }
        catch { stop(entry, 'worker_send_failed'); }
      }
      return {
        get ownsSilence() { return active && mode === 'live'; },
        get ownsVoicemail() { return active && mode === 'live'; },
        connectedAt(value) { entry.answeredAt = new Date(value).toISOString(); send('connected', { at: performance.now() - Math.max(0, Date.now() - value) }); },
        playback() {
          if (!entry.masked) send('masked');
          entry.masked = true;
        },
        audio(pcm, masked) {
          if (!entries.has(id) || disabled) return;
          if (masked !== entry.masked) {
            if (masked || entry.masked !== undefined) send(masked ? 'masked' : 'unmasked');
            entry.masked = masked;
          }
          if (masked || !entries.has(id)) return;
          const frames = Math.ceil(pcm.length / 320);
          if (entry.queued + frames > config.queueFrames) return stop(entry, 'queue_overflow');
          send('audio', { pcm: Uint8Array.from(pcm) }, frames);
        },
        transcript(text, classify = true) {
          if (typeof text !== 'string' || !text.trim()) return;
          const fragment = text.slice(0, 2048);
          if (mode === 'shadow' && shadowCalls.has(id) && entry.transcripts.length < 24 &&
              entry.transcripts.at(-1)?.text !== fragment) {
            entry.transcripts.push({ at: new Date().toISOString(), text: fragment });
          }
          if (classify) send('transcript', { text: fragment });
          else if (mode === 'shadow' && !entry.sentTranscriptEvidence) {
            entry.sentTranscriptEvidence = true;
            send('transcript_evidence');
          }
        },
        close() {
          entry.closed = true;
          audit(entry, undefined, entry.auditReason || 'call_ended_before_decision');
          stop(entry, 'call_ended');
        },
      };
    },
    recordUnavailable(id, connectedAt, reason) {
      if (mode !== 'shadow' || shadowCalls.has(id)) return;
      const entry = {
        id, start: performance.now(), signals: new Set(), transcripts: [],
        startedAt: new Date().toISOString(), answeredAt: new Date(connectedAt).toISOString(),
        canHangup: () => false,
      };
      shadowCalls.set(id, entry);
      audit(entry, undefined, reason);
    },
    log,
    close() {
      disabled = true;
      clearInterval(check);
      const active = worker;
      worker = undefined;
      for (const entry of entries.values()) stop(entry, 'bridge_closed');
      for (const entry of shadowCalls.values()) audit(entry, undefined, entry.auditReason || 'bridge_closed');
      void active?.terminate();
    },
  };
}

module.exports = { createCallAnswer, shouldHangUp };
