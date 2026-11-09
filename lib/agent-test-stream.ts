import { speechText } from "../gateway/speech-text.cjs";
type Engine = (port: number, path: string, init?: RequestInit) => Promise<Response>;
type Options = { messages: unknown[]; voice: string; signal: AbortSignal; engine: Engine; send: (event: object) => Promise<void>; timing: (stage: string, details?: object) => Promise<void>; onText: (text: string) => void };

function sentenceBoundary(text: string) {
  for (const match of text.matchAll(/[.!?](?:["')\]]*)(?=\s|$)/g)) {
    const at = match.index! + match[0].length;
    if (!/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|e\.g|i\.e)|\b[A-Z])\.$/.test(text.slice(0, at))) return at;
  }
  return 0;
}

/** A single ordered synthesis worker runs independently of the Ollama reader. */
export async function streamAgentReply({ messages, voice, signal, engine, send, timing, onText }: Options) {
  const queue: string[] = [];
  let finished = false, failure: unknown, wake: (() => void) | undefined, space: (() => void) | undefined;
  let firstSentence = true, firstPCM = true, sentenceIndex = 0;
  const notify = () => { wake?.(); wake = undefined; space?.(); space = undefined; };
  const abort = () => notify(); signal.addEventListener("abort", abort);
  const worker = (async () => {
    try {
      while (!finished || queue.length) {
        signal.throwIfAborted();
        const text = queue.shift(); space?.(); space = undefined;
        if (!text) { await new Promise<void>(resolve => { wake = resolve; }); continue; }
        const index = sentenceIndex++;
        await timing("tts-request-started", { sentenceIndex: index, characters: text.length });
        const response = await engine(8767, "/stream", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: speechText(text), voice_id: voice }) });
        if (!response.ok || !response.body) throw Error("CosyVoice streaming synthesis failed");
        const rate = Number(response.headers.get("x-sample-rate"));
        if (response.headers.get("x-audio-format") !== "pcm_s16le" || rate !== 24000 || response.headers.get("x-channels") !== "1") { await response.body.cancel(); throw Error("Unexpected CosyVoice PCM format"); }
        let carry = Buffer.alloc(0), bytes = 0, audible = false;
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          signal.throwIfAborted(); bytes += chunk.length;
          if (bytes > 8_000_000) throw Error("Synthesis exceeds audio safety limit");
          carry = Buffer.concat([carry, chunk]);
          // Forward 40 ms frames instead of waiting for 100 ms of PCM.
          while (carry.length >= 1920) {
            signal.throwIfAborted();
            for (let i = 0; i < 1920 && !audible; i += 2) if (Math.abs(carry.readInt16LE(i)) > 3) audible = true;
            if (firstPCM) { firstPCM = false; await timing("first-pcm-received"); }
            await send({ type: "pcm", sampleRate: rate, data: carry.subarray(0, 1920).toString("base64") }); carry = carry.subarray(1920);
          }
        }
        if (carry.length % 2) throw Error("Malformed PCM stream");
        if (carry.length) {
          signal.throwIfAborted();
          for (let i = 0; i < carry.length && !audible; i += 2) if (Math.abs(carry.readInt16LE(i)) > 3) audible = true;
          if (firstPCM) { firstPCM = false; await timing("first-pcm-received"); }
          await send({ type: "pcm", sampleRate: rate, data: carry.toString("base64") });
        }
        if (!bytes || !audible) throw Error("CosyVoice returned empty or silent audio");
        await timing("sentence-synthesis-completed", { sentenceIndex: index, audioBytes: bytes });
      }
    } catch (error) { failure = error; notify(); }
  })();
  const enqueue = async (text: string) => {
    if (!text.trim()) return;
    if (firstSentence) { firstSentence = false; await timing("first-complete-sentence"); }
    let spoken = speechText(text).trim();
    while (spoken) {
      let at = spoken.length <= 480 ? spoken.length : spoken.lastIndexOf(" ", 450);
      if (at <= 0) at = 450;
      while (queue.length >= 32 && !failure) { signal.throwIfAborted(); await new Promise<void>(resolve => { space = resolve; }); }
      if (failure) throw failure; signal.throwIfAborted(); queue.push(spoken.slice(0, at).trim()); notify();
      spoken = spoken.slice(at).trim();
    }
  };
  let answer = "", phrase = "", pending = "", firstToken = true, done = false;
  try {
    const response = await engine(11434, "/api/chat", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.SHAHVEX_TEST_OLLAMA_MODEL || "qwen3:4b-instruct", messages, stream: true, think: false, keep_alive: "30m", options: { num_predict: -1 } }) });
    if (!response.ok || !response.body) throw Error("Ollama response unavailable");
    const decoder = new TextDecoder();
    const consume = async (line: string) => {
      if (!line.trim()) return;
      signal.throwIfAborted(); if (failure) throw failure;
      const data = JSON.parse(line); if (data.error) throw Error("Ollama inference failed");
      const delta = data.message?.content || "";
      if (typeof delta !== "string") throw Error("Invalid Ollama text");
      if (delta) {
        if (firstToken) { firstToken = false; await timing("llm-first-token"); }
        answer += delta; phrase += delta; onText(answer);
        if (answer.length > 64000) throw Error("Response exceeds session safety limit; ask for the remaining detail in a follow-up");
        await send({ type: "delta", text: delta });
        // Sentence terminators are usable even when Ollama ends a delta at punctuation.
        // Avoid splitting decimal numbers and common abbreviated titles.
        let boundary: number;
        while ((boundary = sentenceBoundary(phrase)) || phrase.length > 480) {
          let at = boundary || phrase.lastIndexOf(" ", 450);
          if (at <= 0 || at > 480) at = phrase.lastIndexOf(" ", 450) > 0 ? phrase.lastIndexOf(" ", 450) : 450;
          await enqueue(phrase.slice(0, at)); phrase = phrase.slice(at).trimStart();
        }
      }
      if (data.done) {
        if (data.done_reason === "length") throw Error("Ollama stopped before completing the answer");
        done = true; await timing("llm-completed", { characters: answer.length });
      }
    };
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      pending += decoder.decode(chunk, { stream: true }); if (pending.length > 128000) throw Error("Invalid model stream");
      let at; while ((at = pending.indexOf("\n")) >= 0) { const line = pending.slice(0, at); pending = pending.slice(at + 1); await consume(line); }
    }
    await consume(pending + decoder.decode()); if (!done) throw Error("Incomplete model response");
    await enqueue(phrase); finished = true; notify(); await worker;
    if (failure) throw failure;
    await timing("total-synthesis-completed");
  } finally { finished = true; queue.length = 0; notify(); await worker; signal.removeEventListener("abort", abort); }
}
