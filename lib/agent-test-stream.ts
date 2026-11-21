import { canonicalQuestion } from "../gateway/question-memory.cjs";
import { isTransferOffer } from "../gateway/handoff-intent.cjs";
import * as openingPcmCache from "../gateway/opening-pcm-cache.cjs";
import { recoveryReply, groundedReplyText, isCustomerQuestion } from "../gateway/conversation-recovery.cjs";
import { createReplayGuard } from "../gateway/reply-integrity.cjs";
import { shared as pcmCache } from "../gateway/tts-pcm-cache.cjs";
import { createSpeechRenderer } from "../gateway/speech-text.cjs";
import { speechBoundary } from "../gateway/speech-boundary.cjs";
import { createEmotionSelector, expressionCapabilityReply, identityVoiceReply } from "../gateway/voice-emotion.cjs";
type Engine = (port: number, path: string, init?: RequestInit) => Promise<Response>;
type Options = { allowQuestion?: (speech: string) => boolean; answerOnly?: boolean; requirePurpose?: boolean; responsePrefix?: string; allowRephrase?: boolean; openingAudio?: boolean; cacheAudio?: boolean; maxStatementSentences?: number; outbound?: boolean; completedQuestions?: string[]; introducedName?: string; repetitionRetry?: boolean; allowTimePermission?: boolean; customerText?: string; emotionState?: { turn: number; lastTurn?: number; total?: number }; messages: unknown[]; voice: string; signal: AbortSignal; engine: Engine; send: (event: object) => Promise<void>; timing: (stage: string, details?: object) => Promise<void>; onText: (text: string) => void; phraseStreaming?: boolean; fixedSpeech?: string };

// Runtime status is never model-authored dialogue, even when copied from history.
function withoutInterruptionMarkers(text: string) {
  return text.replace(/\[\s*(?:interrupted(?: by (?:user|customer))?|interupted|interrupt)\s*\]/gi, "");
}

/** Remove the unwanted stock filler before text, memory and speech. */
function withoutPatienceFiller(text:string){
 return text.replace(/[^.!?]*\b(?:I lost track|I (?:did not|didn't) catch|I(?:'m| am) not sure I (?:caught|understood)|could you (?:please )?clarify what|could you tell me what you(?:'d| would) like to know)[^.!?]*[.!?]?/gi, '').replace(/\b(?:got it[,! .]+)?thank(?:s| you) for your patience[.! ,]*/gi,'');
}

/** Block availability-to-talk questions before transcript, memory, or TTS. */
function isTimePermission(text: string) {
  return /\b(?:(?:is|would|will)\s+(?:it|this|that|now|right now|this time|the time)\b[^.!?]{0,100}\b(?:good|okay|ok|convenient|right|bad)\b[^.!?]{0,40}\btime|(?:is|would)\s+(?:now|this|that|it)\b[^.!?]{0,60}\b(?:okay|ok|convenient)\b|(?:do|would|can|could|may|have|are)\s+(?:you|I|we)\b[^.!?]{0,60}\b(?:minute|moment|time to (?:talk|chat|speak)|time for (?:a|this)|time right now|time now|have (?:the |some |any |a little )?time|free to (?:talk|chat)|available to (?:talk|chat))|(?:can|may|could)\s+(?:I|we)\s+(?:talk|speak|chat)|is\s+(?:the\s+)?time\s+(?:good|okay|ok|convenient))\b/i.test(text);
}

function isIdleReply(text: string) {
  return /\b(?:my last point was|can you hear me|are you (?:still )?there)\b/i.test(text) || /^(?:yes[, ]+)?I(?:'m| am) (?:here(?: and listening)?|with you)[.! ]*$|^please go ahead[.! ]*$|^let me know if you have (?:any )?(?:other |more )?questions[.! ]*$/i.test(text.trim());
}

function purposeStatement(text: string) {
  const value=text.trim();
  return !value.includes("?") && !/^(?:got it|okay|ok|thanks|thank you|I(?:'m| am) (?:doing|feeling|fine|good|well))/i.test(value) && (/\b(?:call|calling|contacting|reaching out|reviewing|following up)\b/i.test(value) || value.split(/\s+/).length>=7);
}

/** A single ordered synthesis worker runs independently of the Ollama reader. */
export async function streamAgentReply({ allowQuestion, answerOnly = false, requirePurpose = false, responsePrefix, allowRephrase = false, messages, voice, signal: turnSignal, engine, send, timing, onText, fixedSpeech, customerText, emotionState, allowTimePermission = true, completedQuestions = [], maxStatementSentences, outbound=false, introducedName, repetitionRetry = false, openingAudio = false, cacheAudio = process.env.SHAHVEX_TTS_PCM_CACHE === "1", phraseStreaming = (process.env.SHAHVEX_PHRASE_STREAM ?? process.env.SHAHVEX_TEST_PHRASE_STREAM) === "1" }: Options) {
  const speechAbort = new AbortController();
  const signal = AbortSignal.any([turnSignal, speechAbort.signal]);
  const questionAllowed = (speech: string) => !allowQuestion ||
    (!speech.includes("?") && !/^\s*(?:(?:please|and|so|now)[, ]+)*(?:tell me|give me|share|provide|confirm|what|which|where|when|who|how|do you|are you|have you|can you|could you|would you)\b/i.test(speech)) ||
    allowQuestion(speech);
  const audioCache = openingAudio ? openingPcmCache : pcmCache;
  if (openingAudio) cacheAudio = true;
  // Inspect complete questions before either transcript or audio is emitted.
  const key=(text:string)=>text.toLowerCase().replace(/^(?:\s*(?:mm[ -]?hmm|okay|ok|got it|thank you|thanks|so|and|coming back to (?:your|the) question)[,:.! ]+)+/i,'').replace(/\b(?:please|currently|at the moment)\b/g,'').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
  const questionKey=(text:string)=>/\b(?:may|can|could|mind if)\b.*\b(?:I|we) ask\b/i.test(text)?'permission-to-ask':key(text);
  const completed=new Set(completedQuestions.map(questionKey));
  const introduced=introducedName?.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const repeatedIntroduction=(text:string)=>Boolean(introduced&&new RegExp("\\b(?:this is|my name is|I(?:'m| am))\\s+"+introduced+"\\b",'i').test(text));
  const wellbeingQuestion=/\bhow (?:are you(?: doing| feeling)?|(?:is|was) your day)(?: today)?\s*\?/i;
  const wellbeingAsked=(messages as {role:string;content:string}[]).some(m=>m.role==='assistant'&&wellbeingQuestion.test(m.content));
  const allowClarification = isCustomerQuestion(customerText || (messages as {role:string;content:string}[]).findLast(m=>m.role==="user")?.content);
  const incompleteQuestion = (text: string) => /^\s*(?:(?:sir|ma['’]?am|okay|so|and)[, ]+)*(?:(?:are|is|am|do|does|did|have|has|can|could|would|will|should)\s+(?:you|I|it|this|that|they|we|your)|what|where|who|when|why|how|which)\b/i.test(text) &&
    (!text.includes("?") || /\b(?:based|located|calling)\s*\?$/i.test(text) && /^(?:are|is)\b/i.test(text.trim()));
  const rejectedSpeech = (text: string) => incompleteQuestion(text) || !allowClarification && /\brepeat your last question\b/i.test(text);
  const alreadyAnswered=(text:string)=>text.includes('?')&&(completed.has(questionKey(text))||Boolean(canonicalQuestion(text,completedQuestions))||(wellbeingAsked&&wellbeingQuestion.test(text)));

  const firstTransferWording=(text:string)=>!(messages as {role:string;content:string}[]).some(isTransferOffer)?text.replace(/Would you like me to connect you([^?]*)\?/gi,"Let me connect you$1."):text;
  const replayGuard=createReplayGuard(messages as {role:string;content:string}[],customerText);
  let statementSentences=0,statementWords=0;
  const overStatementBudget=(text:string)=>{if(text.includes("?")||maxStatementSentences===undefined)return false;statementWords+=text.trim().split(/\s+/).length;return ++statementSentences>maxStatementSentences||statementWords>60;};
  const queue: string[] = [];
  const selectEmotion = createEmotionSelector({ voice, customerText, state: emotionState, enabled: process.env.SHAHVEX_LISSA_EMOTIONS === "1" && (fixedSpeech === undefined || expressionCapabilityReply(customerText || "") === fixedSpeech || identityVoiceReply(customerText || "", fixedSpeech)) });
  const renderSpeech = createSpeechRenderer({ voice, expressive: process.env.SHAHVEX_LISSA_EXPRESSIVE === "1" && process.env.SHAHVEX_LISSA_EMOTIONS !== "1" });
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
        const emotion = selectEmotion(text);
        await timing("tts-request-started", { sentenceIndex: index, characters: text.length, ...(emotion !== "neutral" ? { emotion } : {}) });
        // Lissa occasionally returns a valid PCM header followed by only a few
        // milliseconds of a multiword sentence. Wait for a small playable
        // prefix before forwarding, including when reading existing caches.
        const wordCount = (text.match(/[\p{L}\p{N}]+/gu) || []).length;
        const minimumBytes = voice === "lissa" && wordCount > 1
          ? Math.min(700, wordCount * 70) * 48
          : /^how are you doing today[?!.]*$/i.test(text.trim()) ? 3840 : 2;
        for (let attempt = 0; attempt < 3; attempt++) {
          const cacheKey=audioCache.key({text,voice,emotion});
          const cachedPcm=cacheAudio?audioCache.get(cacheKey):undefined;
          const cached=attempt===0 && cachedPcm && cachedPcm.length>=minimumBytes ? cachedPcm : undefined;
          const synthesisSignal = AbortSignal.any([signal, AbortSignal.timeout(25000)]);
          const response = cached ? new Response(cached,{headers:{'x-audio-format':'pcm_s16le','x-sample-rate':'24000','x-channels':'1'}}) : await engine(8767, "/stream", { method: "POST", signal: synthesisSignal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice_id: voice, ...(emotion !== "neutral" ? { emotion } : {}) }) });
          const captured:Uint8Array[]=[];let captureBytes=0;
          await timing(cached?'tts-cache-hit':'tts-cache-miss',{sentenceIndex:index});
          if (!response.ok || !response.body) throw Error("CosyVoice streaming synthesis failed");
          const rate = Number(response.headers.get("x-sample-rate"));
          if (response.headers.get("x-audio-format") !== "pcm_s16le" || rate !== 24000 || response.headers.get("x-channels") !== "1") { await response.body.cancel(); throw Error("Unexpected CosyVoice PCM format"); }
          let carry = Buffer.alloc(0), bytes = 0, audible = false;
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            signal.throwIfAborted(); bytes += chunk.length;
            if(cacheAudio&&!cached){captureBytes+=chunk.length;if(captureBytes<=audioCache.maxEntryBytes)captured.push(Buffer.from(chunk));else captured.length=0;}
            if (bytes > 8_000_000) throw Error("Synthesis exceeds audio safety limit");
            carry = Buffer.concat([carry, chunk]);
            // Forward 40 ms frames instead of waiting for 100 ms of PCM.
            while (carry.length >= 1920 && bytes >= minimumBytes) {
              signal.throwIfAborted();
              for (let i = 0; i < 1920 && !audible; i += 2) if (Math.abs(carry.readInt16LE(i)) > 3) audible = true;
              if (firstPCM) { firstPCM = false; await timing("first-pcm-received"); }
              await send({ type: "pcm", sampleRate: rate, data: carry.subarray(0, 1920).toString("base64") }); carry = carry.subarray(1920);
            }
          }
          if (bytes > 0 && bytes < minimumBytes && attempt < 2) {
            await timing("tts-truncated-retry", { sentenceIndex: index, audioBytes: bytes, attempt: attempt + 1 });
            continue;
          }
          if (bytes < minimumBytes) throw Error("CosyVoice returned empty or truncated audio");
          if (carry.length % 2) throw Error("Malformed PCM stream");
          if (carry.length) {
            signal.throwIfAborted();
            for (let i = 0; i < carry.length && !audible; i += 2) if (Math.abs(carry.readInt16LE(i)) > 3) audible = true;
            if (firstPCM) { firstPCM = false; await timing("first-pcm-received"); }
            await send({ type: "pcm", sampleRate: rate, data: carry.toString("base64") });
          }
          if (!bytes || !audible) throw Error("CosyVoice returned empty or silent audio");
          if(cacheAudio&&!cached&&captureBytes<=audioCache.maxEntryBytes){signal.throwIfAborted();audioCache.put(cacheKey,Buffer.concat(captured));}
          await timing("sentence-synthesis-completed", { sentenceIndex: index, audioBytes: bytes });
          break;
        }
      }
    } catch (error) { failure = error; speechAbort.abort(error); notify(); }
  })();
  const enqueue = async (text: string) => {
    let spoken = renderSpeech(text).trim();
    if (!spoken || !/[\p{L}\p{N}]/u.test(spoken.replace(/\[[^\]]*\]/g, ""))) return;
    if (firstSentence) { firstSentence = false; await timing(phraseStreaming ? "first-speakable-phrase" : "first-complete-sentence"); }
    while (spoken) {
      let at = spoken.length <= 480 ? spoken.length : spoken.lastIndexOf(" ", 450);
      if (at <= 0) at = 450;
      while (queue.length >= 32 && !failure) { signal.throwIfAborted(); await new Promise<void>(resolve => { space = resolve; }); }
      if (failure) throw failure; signal.throwIfAborted(); queue.push(spoken.slice(0, at).trim()); notify();
      spoken = spoken.slice(at).trim();
    }
  };
  let answer = "", phrase = "", pending = "", fillerPrefix = "", firstToken = true, done = false, handoffSpokenInTurn=false;
  try {
    // Trusted server-selected presence checks use the same ordered, cancellable
    // voice path, without inventing a customer utterance or invoking the LLM.
    if (fixedSpeech !== undefined) {
      signal.throwIfAborted(); onText(fixedSpeech);
      await send({ type: "delta", text: fixedSpeech });
      // Start the short introduction as soon as its first sentence is ready.
      let remaining=fixedSpeech;
      let boundary:number;
      while((boundary=speechBoundary(remaining, false, true))){await enqueue(remaining.slice(0,boundary));remaining=remaining.slice(boundary).trimStart();}
      if(remaining)await enqueue(remaining);
      finished = true; notify(); await worker;
      if (failure) throw failure;
      await timing("total-synthesis-completed");
      return;
    }
    const response = await engine(11434, "/api/chat", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.SHAHVEX_TEST_OLLAMA_MODEL || "qwen3:4b-instruct", messages:(messages as {role:string;content:string}[]).map(({role,content})=>({role,content})), stream: true, think: false, keep_alive: "30m", options: { num_predict: -1, temperature: 0 } }) });
    if (!response.ok || !response.body) throw Error("Ollama response unavailable");
    const decoder = new TextDecoder();
    const consume = async (line: string) => {
      if (!line.trim()) return;
      signal.throwIfAborted(); if (failure) throw failure;
      const data = JSON.parse(line); if (data.error) throw Error("Ollama inference failed");
      if (done) throw Error("Unexpected data after Ollama completion");
      if (data.message?.tool_calls?.length) throw Error("Unexpected tool call in spoken response");
      if (data.done && data.done_reason === "length") throw Error("Ollama stopped before completing the answer");
      const delta = data.message?.content || "";
      if (typeof delta !== "string") throw Error("Invalid Ollama text");
      if (delta) {
        if (firstToken) { firstToken = false; await timing("llm-first-token"); }
        phrase += delta;
        if (/<\/?(?:think|analysis|tool(?:_call)?|function)(?=[\s>/]|$)|```|^\s*(?:\{|\[\s*["{])/i.test(phrase)) {
          throw Error("Unexpected structured content in spoken response");
        }
        if (answer.length + phrase.length > 64000) throw Error("Response exceeds session safety limit; ask for the remaining detail in a follow-up");
        let boundary: number;
        // Hold questions until complete so split tokens cannot leak into text or audio.
        const phraseAllowed = () => maxStatementSentences===undefined && !(messages as {role:string}[]).some(m=>m.role==='assistant') && !completedQuestions.length && !repeatedIntroduction(phrase) && phraseStreaming && !/^\s*(?:got it\b|thank(?:s| you)\b)/i.test(phrase) && !/^\s*(?:is|are|do|would|will|can|could|may|have)\b/i.test(phrase);
        while ((boundary = phraseAllowed() ? speechBoundary(phrase, true) : speechBoundary(phrase))) {
          let part = firstTransferWording(groundedReplyText(withoutPatienceFiller(withoutInterruptionMarkers(phrase.slice(0, boundary))),customerText));
          phrase = phrase.slice(boundary);
          if(answerOnly&&part.includes("?"))continue;
          if (isTransferOffer({role:"assistant",content:part}) && handoffSpokenInTurn) continue;
          if (requirePurpose && !answer.trim() && !purposeStatement(part)) continue;
          if (!part.trim() || outbound && rejectedSpeech(part) || outbound&&isIdleReply(part) || outbound&&/\bhow can I (?:help|assist|support)\b/i.test(part) || overStatementBudget(part) || repeatedIntroduction(part) || alreadyAnswered(part) || !(allowRephrase || replayGuard.allow(part)) || !allowTimePermission && isTimePermission(part) || !questionAllowed(part)) continue;
          if(/^(?:mm[ -]?hmm|okay|ok|got it|thank you|thanks)[.! ,]*$/i.test(part.trim())){fillerPrefix=part;continue;}
          if(fillerPrefix){part=fillerPrefix+' '+part.trimStart();fillerPrefix='';}
          if (!answer && responsePrefix) part = responsePrefix + part.replace(/^\s*(?:sir|ma['’]?am|madam)[, .!]+/i, '');
          if(isTransferOffer({role:"assistant",content:part}))handoffSpokenInTurn=true;
          answer += part; onText(answer);
          await send({ type: "delta", text: part });
          await enqueue(part);
        }
      }
      if (data.done) {
        done = true; await timing("llm-completed", { characters: answer.length });
      }
    };
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      pending += decoder.decode(chunk, { stream: true }); if (pending.length > 128000) throw Error("Invalid model stream");
      let at; while ((at = pending.indexOf("\n")) >= 0) { const line = pending.slice(0, at); pending = pending.slice(at + 1); await consume(line); }
    }
    await consume(pending + decoder.decode()); if (!done) throw Error("Incomplete model response");
    phrase = firstTransferWording(groundedReplyText(withoutPatienceFiller(withoutInterruptionMarkers(phrase)),customerText));
    if(/^(?:mm[ -]?hmm|okay|ok|got it|thank you|thanks)[.! ,]*$/i.test(phrase.trim())){fillerPrefix=phrase;phrase='';}
    if (phrase && !(outbound && rejectedSpeech(phrase)) && !(answerOnly&&phrase.includes("?")) && !(handoffSpokenInTurn && isTransferOffer({role:"assistant",content:phrase})) && !(requirePurpose && !answer.trim() && !purposeStatement(phrase)) && !(outbound&&isIdleReply(phrase)) && !(outbound&&/\bhow can I (?:help|assist|support)\b/i.test(phrase)) && !overStatementBudget(phrase) && !repeatedIntroduction(phrase) && !alreadyAnswered(phrase) && (allowRephrase || replayGuard.allow(phrase)) && (allowTimePermission || !isTimePermission(phrase)) && questionAllowed(phrase)) {
      if(fillerPrefix){phrase=fillerPrefix+' '+phrase.trimStart();fillerPrefix='';}
      if (!answer && responsePrefix) phrase = responsePrefix + phrase.replace(/^\s*(?:sir|ma['’]?am|madam)[, .!]+/i, '');
      answer += phrase; onText(answer);
      await send({ type: "delta", text: phrase });
      await enqueue(phrase);
    }
    finished = true; notify(); await worker;
    if (failure) throw failure;
    await timing("total-synthesis-completed");
    if (!answer.trim() && !repetitionRetry) {
      const retryMessages=(messages as {role:string;content:string}[]).map((m,i)=>i===0&&m.role==='system'?{...m,content:m.content+"\nYour previous response replayed conversation history or contained only an acknowledgment and was not spoken. Answer ONLY the latest customer message. Do not copy earlier assistant statements or customer dialogue. Give a substantive response to the customer and continue the unresolved script step. Continue from the next applicable unanswered script step, respecting branches and refusals. If no questions remain, close or follow the supported consented handoff. Never re-ask these answered questions: "+JSON.stringify(completedQuestions)}:m);
      await streamAgentReply({allowQuestion,answerOnly,requirePurpose,messages:retryMessages,allowRephrase,responsePrefix,voice,signal,engine,send,timing,onText,customerText,emotionState,allowTimePermission,completedQuestions,maxStatementSentences,outbound,introducedName,repetitionRetry:true,phraseStreaming,cacheAudio});
    } else if (!answer.trim() && repetitionRetry) {
      const recovery = answerOnly ? "" : recoveryReply(messages);
      if (recovery) await streamAgentReply({messages:[],fixedSpeech:recovery,voice,signal,engine,send,timing,onText,customerText,emotionState,phraseStreaming,cacheAudio});
    }
  } finally { speechAbort.abort(); finished = true; queue.length = 0; notify(); await worker; signal.removeEventListener("abort", abort); }
}

