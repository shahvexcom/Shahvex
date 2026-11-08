'use strict';
const fs = require('node:fs');
const fields = new Set(['sessionId','turnId','generation','stage','elapsedMs','milliseconds','httpStatus','errorName','engineStage','inputOffsetMs','lastSpeechOffsetMs','vadDelayMs','audioMs','bytes','scriptVersion','scriptCharacters','category','host','port','segmentIndex','characters']);
function createTelemetry(file, consoleOutput = line => process.stdout.write(line)) {
  // Exclusive creation avoids overwriting earlier evidence or private config.
  const fd = file ? fs.openSync(file, 'wx', 0o600) : null;
  let closed = false;
  return {
    log(event) {
      const safe = { at: new Date().toISOString() };
      for (const [key,value] of Object.entries(event)) if (fields.has(key) && (typeof value === 'number' || typeof value === 'string' && value.length <= 160)) safe[key] = value;
      const line = JSON.stringify(safe) + '\n'; consoleOutput(line);
      if (fd !== null && !closed) fs.writeSync(fd, line);
    },
    close() { if(fd !== null && !closed){closed=true;fs.closeSync(fd);} },
  };
}
module.exports={createTelemetry};
