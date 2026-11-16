import { createPublicKey, randomUUID, verify } from "node:crypto";
import { db } from "@/lib/database";
import { decryptCredential } from "@/lib/credential-crypto";

export const runtime = "nodejs";

function verifiedTelnyxWebhook(request: Request, body: string) {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  const signature = request.headers.get("telnyx-signature-ed25519");
  const timestamp = request.headers.get("telnyx-timestamp");
  if (!publicKey || !signature || !timestamp || !/^\d+$/.test(timestamp)) return false;

  const rawKey = Buffer.from(publicKey, "base64");
  if (rawKey.length !== 32 || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  try {
    return verify(null, Buffer.from(`${timestamp}|${body}`), createPublicKey({ key: Buffer.concat([spkiPrefix, rawKey]), format: "der", type: "spki" }), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

async function recordingSize(url: string) {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(5_000) });
    const size = Number(response.headers.get("content-length") || 0);
    return Number.isFinite(size) && size > 0 ? size : 0;
  } catch {
    return 0;
  }
}

const CALL_STATES = { INITIALIZING: "INITIALIZING", AI_GREETING: "AI_GREETING", LISTENING: "LISTENING", THINKING: "THINKING", SPEAKING: "SPEAKING", INTERRUPTED: "INTERRUPTED", ENDING: "ENDING", COMPLETED: "COMPLETED", FAILED: "FAILED" } as const;

function normalizeGender(value: unknown) {
  const gender = String(value ?? "").trim().toUpperCase();
  if (gender === "MALE") return "MALE";
  if (gender === "FEMALE") return "FEMALE";
  return "OTHER";
}

function agentVoiceProfile(gender: unknown) {
  const normalized = normalizeGender(gender);
  return {
    gender: normalized,
    // Telnyx documents these stable Ultra voice identifiers for AI Assistant
    // and Call Control use.
    voice: normalized === "MALE"
      ? "Telnyx.Ultra.Asher"
      : normalized === "FEMALE"
        ? "Telnyx.Ultra.Callie"
        : "Telnyx.Ultra.Callie",
  };
}

function voiceLog(label: string, details: Record<string, unknown> = {}) {
  // Keep operational logs structured: provider webhooks are the only reliable
  // way to diagnose a live call that cannot be reproduced in a browser.
  console.info(label, details);
}

async function startInboundTranscription(controlId: string, client: Awaited<ReturnType<typeof db>>) {
  const result = await client.query(`SELECT c.id,t.secret_ciphertext telnyx_secret
    FROM agent_calls c JOIN agents a ON a.id=c.agent_id
    JOIN agent_credentials ta ON ta.agent_id=c.agent_id AND ta.provider='TELNYX' JOIN ai_credentials t ON t.id=ta.credential_id
    WHERE c.telnyx_call_control_id=$1 AND c.status='ANSWERED' LIMIT 1`, [controlId]);
  const row = result.rows[0] as { id: string; telnyx_secret: string } | undefined;
  if (!row) return false;
  try {
    const endpoint = `https://api.telnyx.com/v2/calls/${encodeURIComponent(controlId)}/actions/transcription_start`;
    const headers = { Authorization: `Bearer ${decryptCredential(String(row.telnyx_secret))}`, "Content-Type": "application/json", Accept: "application/json" };
    const baseRequest = { transcription_engine: "Deepgram", transcription_tracks: "inbound", client_state: Buffer.from(String(row.id)).toString("base64"), command_id: randomUUID() };
    let response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...baseRequest,
        transcription_engine_config: {
          transcription_engine: "Deepgram",
          model: "nova-3",
          language: "en",
          interim_results: true,
          endpointing: 500,
          smart_format: true,
          numerals: true,
          keyterm: "tenancy,landlord,council house,damp,mould,leakage,housing disrepair,rent,tenancy start date",
        },
      }),
    });
    // Provider accounts can temporarily expose an older Call Control schema.
    // Keep speech recognition available if an optional Nova-3 tuning field is rejected.
    if (!response.ok && (response.status === 400 || response.status === 422)) response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ ...baseRequest, command_id: randomUUID() }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.errors?.[0]?.detail || data?.error?.message || `Telnyx transcription could not start (${response.status}).`);
    voiceLog("[STT] Inbound transcription started", { controlId, callId: row.id });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Telnyx transcription could not start.";
    await addCallNote(client, row.id, `Transcription unavailable after greeting. ${reason}`);
    voiceLog("[STT] Start failed after greeting", { controlId, callId: row.id, reason });
    return false;
  }
}

async function startManagedConversation(controlId: string, client: Awaited<ReturnType<typeof db>>) {
  // Prefer the configured Telnyx AI Assistant when an Assistant ID is saved.
  // The manual Groq conversation remains the safe fallback if Telnyx rejects
  // the assistant start command or the credential has no Assistant ID.
  const assistant = await client.query(`SELECT c.id,c.lead_name,c.lead_number,a.name agent_name,a.gender,sa.lead_headers,sa.lead_rows,
    COALESCE(sa.script_text,'') script_text,t.secret_ciphertext,t.config
    FROM agent_calls c
    JOIN agents a ON a.id=c.agent_id
    JOIN agent_credentials ta ON ta.agent_id=c.agent_id AND ta.provider='TELNYX'
    JOIN ai_credentials t ON t.id=ta.credential_id
    LEFT JOIN LATERAL (SELECT script_text,lead_headers,lead_rows FROM script_assignments WHERE agent_id=c.agent_id ORDER BY created_at DESC LIMIT 1) sa ON TRUE
    WHERE c.telnyx_call_control_id=$1 AND c.status='ANSWERED' LIMIT 1`, [controlId]);
  const assistantRow = assistant.rows[0] as { id:string; lead_name:string; lead_number:string; agent_name:string; gender:string; lead_headers:unknown; lead_rows:unknown; script_text:string; secret_ciphertext:string; config?:{assistantId?:string} } | undefined;
  const assistantId = assistantRow?.config?.assistantId?.trim();
  if (assistantRow && assistantId) {
    try {
      const lead = leadData(assistantRow.lead_headers, assistantRow.lead_rows, assistantRow.lead_number);
      const dynamicInstructions = `You are the Shahvex agent named ${assistantRow.agent_name}. Your configured gender/persona is ${String(assistantRow.gender).toLowerCase()}. Use the assigned Shahvex agent script below as your primary script. Do not use a generic assistant script in its place, do not invent facts, and follow the script's qualification order and wording intent. Start with only the greeting; do not ask for lead information in the opening. After the client responds, answer their question fully. Only when the situation requires lead collection, ask politely for permission and wait for a clear yes before collecting details. Assigned Shahvex agent script:\n${String(assistantRow.script_text || "").slice(0, 12000)}\nCurrent lead record for context only (do not reveal or assume any value; confirm details with the client): ${JSON.stringify(lead)}`;
      const response = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(controlId)}/actions/ai_assistant_start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${decryptCredential(assistantRow.secret_ciphertext)}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ assistant: { id: assistantId, message_history: [
          { role: "system", content: dynamicInstructions }
        ], instructions: dynamicInstructions, greeting: `Hello, this is ${assistantRow.agent_name}. I’m calling from the team today. How are you?`, voice: agentVoiceProfile(assistantRow.gender).voice, send_message_history_updates: true, client_state: Buffer.from(String(assistantRow.id)).toString("base64") }, command_id: randomUUID() })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.errors?.[0]?.detail || data?.error?.message || `Telnyx AI Assistant could not start (${response.status}).`);
      await client.query("UPDATE agent_calls SET telnyx_ai_conversation_id=$1,conversation_state=$2,updated_at=NOW() WHERE id=$3", [data?.data?.conversation_id || null, CALL_STATES.AI_GREETING, assistantRow.id]);
      voiceLog("[TELNYX AI] Assistant conversation started", { controlId, callId: assistantRow.id, assistantId });
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Telnyx AI Assistant start failed.";
      await addCallNote(client, assistantRow.id, `Telnyx AI Assistant unavailable; using existing conversation fallback. ${reason}`);
      voiceLog("[TELNYX AI] Assistant start failed; using manual fallback", { controlId, reason });
    }
  }
  // Start the opening line before STT. A caller saying "hello" while the
  // greeting was being prepared used to cancel TTS before it became audible.
  const greetingQueued = await generateReply(controlId, client, true);
  if (!greetingQueued) {
    await startInboundTranscription(controlId, client);
    await client.query("UPDATE agent_calls SET conversation_state=$1,updated_at=NOW() WHERE telnyx_call_control_id=$2 AND status='ANSWERED'", [CALL_STATES.LISTENING, controlId]);
  }
  voiceLog("[VOICE] Managed agent conversation started", { controlId });
}

async function startAutomaticRecording(controlId: string, client: Awaited<ReturnType<typeof db>>) {
  const result = await client.query("SELECT c.id,t.secret_ciphertext FROM agent_calls c JOIN agent_credentials a ON a.agent_id=c.agent_id AND a.provider='TELNYX' JOIN ai_credentials t ON t.id=a.credential_id WHERE c.telnyx_call_control_id=$1 LIMIT 1", [controlId]);
  const row = result.rows[0];
  if (!row?.secret_ciphertext) return;
  const response = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(controlId)}/actions/record_start`, { method: "POST", headers: { Authorization: `Bearer ${decryptCredential(row.secret_ciphertext)}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ format: "mp3", channels: "dual", recording_track: "both", play_beep: false, custom_file_name: `max7-${String(row.id).slice(0, 8)}`, command_id: randomUUID() }) });
  if (!response.ok) throw new Error(`Automatic recording could not start (${response.status}).`);
  await client.query("UPDATE agent_calls SET recording_active=TRUE,updated_at=NOW() WHERE id=$1", [row.id]);
  voiceLog("[RECORDING] Automatic recording started", { controlId, callId: row.id });
}

const smallNumbers = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
function numberWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n < 20) return smallNumbers[n];
  if (n < 100) return ["twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"][Math.floor(n / 10) - 2] + (n % 10 ? ` ${numberWords(n % 10)}` : "");
  if (n < 1000) return `${numberWords(Math.floor(n / 100))} hundred${n % 100 ? ` and ${numberWords(n % 100)}` : ""}`;
  if (n < 1_000_000) return `${numberWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberWords(n % 1000)}` : ""}`;
  return String(n).split("").map(digit => smallNumbers[Number(digit)]).join(" ");
}
function yearWords(year: number) { return year >= 2000 && year <= 2009 ? `two thousand${year > 2000 ? ` and ${numberWords(year - 2000)}` : ""}` : year >= 2010 && year <= 2099 ? `twenty ${numberWords(year - 2000)}` : numberWords(year); }
const ordinals = ["","first","second","third","fourth","fifth","sixth","seventh","eighth","ninth","tenth","eleventh","twelfth","thirteenth","fourteenth","fifteenth","sixteenth","seventeenth","eighteenth","nineteenth","twentieth","twenty-first","twenty-second","twenty-third","twenty-fourth","twenty-fifth","twenty-sixth","twenty-seventh","twenty-eighth","twenty-ninth","thirtieth","thirty-first"];
function prepareSpeechText(input: string) {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return input
    .replace(/£\s*([\d,]+)(?:\.(\d{1,2}))?/g, (_, pounds, pence) => `${numberWords(Number(String(pounds).replace(/,/g,"")))} pounds${pence ? ` and ${numberWords(Number(String(pence).padEnd(2,"0")))} pence` : ""}`)
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (raw, day, month, year) => { const d=Number(day),m=Number(month),y=Number(year); return d>=1&&d<=31&&m>=1&&m<=12 ? `the ${ordinals[d]} of ${months[m-1]}, ${yearWords(y)}` : raw; })
    .replace(/\b(\d+(?:\.\d+)?)%/g, (_, value) => `${String(value).split(".").map((part:string,index:number)=>index?part.split("").map(d=>smallNumbers[Number(d)]).join(" "):numberWords(Number(part))).join(" point ")} percent`)
    .replace(/\b([\w.-]+)@([\w.-]+)\.([a-z]{2,})\b/gi, (_, user, domain, suffix) => `${String(user).replace(/[._-]/g," ")}, at ${String(domain).replace(/[.-]/g," dot ")}, dot ${suffix}`)
    .replace(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.([a-z]{2,})(?:\.([a-z]{2}))?\b/gi, (_, name, domain, country) => `${String(name).replace(/7/g," seven ").replace(/-/g," ")}, dot ${domain}${country ? ` dot ${String(country).toUpperCase().split("").join(" ")}` : ""}`)
    .replace(/\b(?:\+?\d[\d ()-]{8,}\d)\b/g, value => value.replace(/\D/g,"").split("").map(digit => smallNumbers[Number(digit)]).join(" "));
}

async function speak(controlId: string, key: string, text: string, gender: unknown, responseId: string, basicFallback = false, speakingRate = 0.94) {
  try {
    // Select the actual in-call TTS voice from the agent record. Telnyx Ultra
    // publishes Asher as male and Callie as female, so the provider cannot
    // silently reuse a generic/default female voice for male agents.
    const profile = agentVoiceProfile(gender);
    const payload = prepareSpeechText(text).slice(0, 900);
    const voice = basicFallback ? (profile.gender === "MALE" ? "male" : "female") : profile.voice;
    voiceLog("[TTS] Generation started", { controlId, responseId, gender: profile.gender, voice, basicFallback });
    const response = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(controlId)}/actions/speak`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      // The control ID returned by Dial belongs to the called PSTN leg. Target
      // that leg directly; a simple outbound call has no bridged opposite leg.
      body: JSON.stringify({
        payload,
        payload_type: "text",
        voice,
        ...(basicFallback
          ? { service_level: "basic", language: "en-US" }
          : {
              service_level: "premium",
              language: "en-GB",
              voice_settings: { voice_speed: Math.max(0.90, Math.min(0.95, speakingRate)), volume: 1, language_boost: "English" },
            }),
        target_legs: "self",
        client_state: Buffer.from(responseId).toString("base64"),
        command_id: randomUUID(),
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    // A 2xx only means Telnyx queued the command. `call.speak.started` is the
    // confirmation that synthesis succeeded and audio actually began.
    voiceLog("[TTS] Speak command queued", { controlId, responseId, gender: profile.gender, voice, basicFallback });
    return true;
  } catch (error) {
    console.error("Telnyx could not play the agent response.", error);
    return false;
  }
}

async function handleSpeakFailure(controlId: string, payload: Record<string, unknown>, client: Awaited<ReturnType<typeof db>>) {
  const responseId = typeof payload.client_state === "string" ? Buffer.from(payload.client_state, "base64").toString("utf8") : "";
  const reason = String(payload.status_detail || `Telnyx speech failed (${String(payload.status || "unknown status")}).`).slice(0, 1000);
  const result = await client.query(`SELECT c.id,c.conversation_state,c.conversation_history,a.gender,t.secret_ciphertext
    FROM agent_calls c JOIN agents a ON a.id=c.agent_id
    JOIN agent_credentials ta ON ta.agent_id=c.agent_id AND ta.provider='TELNYX' JOIN ai_credentials t ON t.id=ta.credential_id
    WHERE c.telnyx_call_control_id=$1 AND c.status='ANSWERED' AND c.current_response_id=$2 LIMIT 1`, [controlId, responseId]);
  const row = result.rows[0];
  if (!row) {
    voiceLog("[TTS] Ignored stale speech failure", { controlId, responseId, reason });
    return;
  }

  await addCallNote(client, row.id, `Telnyx speech failed. ${reason}`);
  voiceLog("[TTS] Speech failed", { controlId, responseId, reason });
  const wasGreeting = row.conversation_state === CALL_STATES.AI_GREETING;

  // Basic Telnyx speech is deliberately retained as a last-resort path. It is
  // less expressive, but it has no provider voice UUID and is known to play on
  // the PSTN leg if a premium voice becomes unavailable.
  if (!responseId.startsWith("basic:")) {
    const history = (Array.isArray(row.conversation_history) ? row.conversation_history : []) as ConversationTurn[];
    const lastReply = [...history].reverse().find(turn => turn.role === "assistant")?.content
      || (wasGreeting ? "Hello, how are you today?" : "I'm sorry, could you say that once more?");
    const fallbackId = `basic:${randomUUID()}`;
    const claimed = await client.query("UPDATE agent_calls SET current_response_id=$1,failure_reason=$2,updated_at=NOW() WHERE id=$3 AND current_response_id=$4 RETURNING id", [fallbackId, reason, row.id, responseId]);
    if (claimed.rows[0]) {
      const queued = await speak(controlId, decryptCredential(row.secret_ciphertext), lastReply, row.gender, fallbackId, true);
      if (queued) {
        voiceLog("[TTS] Basic speech fallback queued", { controlId, responseId: fallbackId });
        return;
      }
    }
  }

  await client.query("UPDATE agent_calls SET conversation_state=$1,current_response_id=NULL,conversation_busy=FALSE,failure_reason=$2,updated_at=NOW() WHERE id=$3", [CALL_STATES.LISTENING, reason, row.id]);
  if (wasGreeting) await startInboundTranscription(controlId, client);
}

async function stopSpeaking(controlId: string, client: Awaited<ReturnType<typeof db>>) {
  const result = await client.query(`UPDATE agent_calls c SET conversation_state=$1,current_response_id=NULL,updated_at=NOW()
    FROM agent_credentials ta JOIN ai_credentials t ON t.id=ta.credential_id
    WHERE c.agent_id=ta.agent_id AND ta.provider='TELNYX' AND c.telnyx_call_control_id=$2
      AND c.status='ANSWERED' AND c.conversation_state IN ($3,$4,$5)
    RETURNING t.secret_ciphertext`, [CALL_STATES.INTERRUPTED, controlId, CALL_STATES.SPEAKING, CALL_STATES.THINKING, CALL_STATES.AI_GREETING]);
  const secret = result.rows[0]?.secret_ciphertext; if (!secret) return false;
  try { await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(controlId)}/actions/speak_stop`, { method: "POST", headers: { Authorization: `Bearer ${decryptCredential(secret)}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ command_id: randomUUID() }) }); voiceLog("[AI] Speech interrupted", { controlId }); } catch { /* A response can still be generated if there is no active speech. */ }
  return true;
}

type ConversationTurn = { role: "user" | "assistant"; content: string; at?: string };
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function explicitEndRequest(text: string) {
  return /\b(goodbye|bye bye|hang up|end (the )?call|stop (the )?call|please stop|leave me alone|no thanks|don't want to (talk|continue)|do not want to (talk|continue)|not interested|remove my (number|details)|don't call|do not call|call me again mat)\b/i.test(text);
}

function clientAcceptedClosing(text: string, history: ConversationTurn[]) {
  if (explicitEndRequest(text)) return true;
  const previousAgent = [...history].reverse().find(turn => turn.role === "assistant")?.content ?? "";
  const closingQuestion = /\b(anything else|any other (question|thing)|else I can (help|clarify)|help with anything)\b/i.test(previousAgent);
  return closingQuestion && /^\s*(no|nope|no thanks|nothing else|that's all|that is all|all good|okay thanks|thank you)\b/i.test(text);
}

function removeInternalMarkers(text: string) {
  return text
    .replace(/\[?\s*END[_ -]?CALL\s*\]?/gi, "")
    .replace(/\[?\s*(END|CALL)[_ -]?(END|CALL)\s*\]?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function incompleteSpeech(text: string) {
  return /\b(i|we|it|that|because|but|and|or|didn't|don't|do not|have not|haven't|wasn't|isn't|the|a|an|to|for|with|my|your)\s*[,.!?]*$/i.test(text.trim());
}

function rateLimitDelay(response: Response, message: string) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(1800, Math.max(150, retryAfter * 1000));
  const match = message.match(/try again in\s+([\d.]+)\s*(ms|s)/i);
  if (!match) return 650;
  return Math.min(1800, Math.max(150, Number(match[1]) * (match[2].toLowerCase() === "s" ? 1000 : 1)));
}

async function requestGroqReply(key: string, model: string, messages: ChatMessage[]) {
  let lastError = "Groq returned no agent reply.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      signal: AbortSignal.timeout(7_000),
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature: 0.35, max_tokens: 72, ...(model.startsWith("openai/gpt-oss-") ? { reasoning_effort: "low", reasoning_format: "hidden" } : {}), messages }),
    });
    const data = await response.json().catch(() => ({}));
    const content = typeof data?.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content.replace(/\s+/g, " ").trim() : "";
    if (response.ok && content) return content;
    lastError = String(data?.error?.message || `Groq reply failed (${response.status}).`);
    if (response.status !== 429 || attempt === 2) break;
    const delay = rateLimitDelay(response, lastError);
    voiceLog("[GROQ] Rate limited; retrying", { attempt: attempt + 1, delay });
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error(lastError);
}

async function addCallNote(client: Awaited<ReturnType<typeof db>>, callId: string, message: string) {
  await client.query("UPDATE agent_calls SET notes=CASE WHEN notes='' THEN $1 ELSE notes || E'\\n' || $1 END,updated_at=NOW() WHERE id=$2", [`[Voice system] ${message.slice(0, 1200)}`, callId]);
}

async function promptAfterSilence(controlId: string, marker: Date, client: Awaited<ReturnType<typeof db>>) {
  await new Promise(resolve => setTimeout(resolve, 6500));
  const responseId = `silence:${randomUUID()}`;
  const claimed = await client.query(`UPDATE agent_calls c SET silence_prompt_count=silence_prompt_count+1,conversation_state=$1,current_response_id=$2,updated_at=NOW()
    FROM agents a,agent_credentials ac,ai_credentials cred
    WHERE c.agent_id=a.id AND ac.agent_id=c.agent_id AND ac.provider='TELNYX' AND cred.id=ac.credential_id
      AND c.telnyx_call_control_id=$3 AND c.status='ANSWERED' AND c.conversation_state=$4
      AND c.conversation_busy=FALSE AND c.silence_prompt_count<2 AND c.updated_at=$5
    RETURNING c.id,c.silence_prompt_count,a.gender,cred.secret_ciphertext`, [CALL_STATES.SPEAKING, responseId, controlId, CALL_STATES.LISTENING, marker]);
  const row = claimed.rows[0];
  if (!row) return;
  const finalPrompt = Number(row.silence_prompt_count) >= 2;
  const line = finalPrompt ? "It sounds like now isn't a good time, so I'll let you go. Take care." : "Hello, are you still there?";
  const played = await speak(controlId, decryptCredential(row.secret_ciphertext), line, row.gender, responseId, false, 0.93);
  if (played) {
    await client.query("UPDATE agent_calls SET ending_requested=$1,conversation_history=conversation_history || jsonb_build_array(jsonb_build_object('role','assistant','content',$2::text,'at',NOW())),transcript=CASE WHEN transcript='' THEN 'AGENT: ' || $2::text ELSE transcript || E'\\nAGENT: ' || $2::text END,notes=CASE WHEN notes='' THEN '[Quality] Silence prompt used.' ELSE notes || E'\\n[Quality] Silence prompt used.' END WHERE id=$3", [finalPrompt, line, row.id]);
    voiceLog("[QUALITY] Silence prompt used", { controlId, callId: row.id, attempt: row.silence_prompt_count });
  }
}

function leadData(headers: unknown, rows: unknown, number: string) {
  const keys = Array.isArray(headers) ? headers.map(value => String(value)) : [], data = Array.isArray(rows) ? rows as unknown[][] : [];
  const phoneIndex = keys.findIndex(key => /phone|mobile|telephone|number/i.test(key));
  const clean = (value: unknown) => String(value ?? "").replace(/[^\d+]/g, "");
  const row = data.find(item => clean(item[phoneIndex]) === clean(number));
  return row ? Object.fromEntries(keys.map((key, index) => [key, String(row[index] ?? "").slice(0, 500)])) : {};
}

function providerFailureReply(row: Record<string, unknown>, latestClientText: string) {
  const lead = leadData(row.lead_headers, row.lead_rows, String(row.lead_number || ""));
  const script = String(row.script_text || "");
  const company = script.match(/(?:calling|call)\s+from\s+([A-Z][\w&' -]{1,60})[.,\n]/i)?.[1]?.trim();
  if (/\b(no|not|haven't|have not|didn't|did not)\b[\s\S]{0,55}\b(issue|problem|disrepair|mould|mold|damp|leak)\b/i.test(latestClientText)) {
    return "Right, understood. Before we finish, may I take a few details so we can keep an accurate record and help if anything changes?";
  }
  if (/\b(who are you|who is this|what company|where are you calling from)\b/i.test(latestClientText)) {
    return `I'm ${row.agent_name}${company ? ` from ${company}` : ""}, calling about the service described at the start of our call.`;
  }
  if (/\b(where|how).{0,24}(get|got|have|find).{0,16}(number|details)|who gave.{0,16}(number|details)/i.test(latestClientText)) {
    const source = Object.entries(lead).find(([key, value]) => /source|provider|origin|campaign/i.test(key) && String(value).trim())?.[1];
    return source
      ? `Your contact was supplied through ${source}. Would you like me to continue?`
      : "The original source isn't shown on my call record. Would you like me to stop contact to this number?";
  }
  if (/\b(are you (an? )?(ai|bot|robot|automated)|are you human|real person)\b/i.test(latestClientText)) {
    return `I'm ${row.agent_name}, a representative from the company's team. I can help with questions about this call and the service.`;
  }
  if (latestClientText.trim().length < 4) return "Sorry, could you say that once more?";
  return "I’m sorry, I didn’t catch that. Could you repeat that last part, please?";
}

function needsNoIssueLeadPermission(latestClientText: string, history: ConversationTurn[]) {
  const noIssue = /\b(no|not|haven't|have not|didn't|did not)\b[\s\S]{0,55}\b(issue|problem|disrepair|mould|mold|damp|leak)\b/i.test(latestClientText);
  const permissionAlreadyAsked = history.some(turn => turn.role === "assistant" && /\b(may|can) I (take|collect|confirm|update).{0,35}\b(details|information|record)\b/i.test(turn.content));
  return noIssue && !permissionAlreadyAsked && !explicitEndRequest(latestClientText);
}

function enforceLeadPermission(reply: string, _latestClientText: string, history: ConversationTurn[]) {
  const asksForLead = /\b(full name|first name|surname|last name|phone|mobile|email|address|postcode|post code|date of birth|details|information)\b/i.test(reply);
  const permissionAlreadyAsked = history.some(turn => turn.role === "assistant" && /\b(would it be alright|may I|can I|is it okay|happy for me)\b.{0,80}\b(details|information|contact|record)\b/i.test(turn.content));
  if (asksForLead && !permissionAlreadyAsked) {
    return "Before I take any details, would it be alright if I asked you a few quick questions so the team can follow up properly?";
  }
  return reply;
}

async function generateReply(controlId: string, client: Awaited<ReturnType<typeof db>>, firstMessage = false, earliestSpeakAt = 0, turnResponseId?: string): Promise<boolean> {
  const result = await client.query(`SELECT c.id,c.lead_name,c.lead_number,c.conversation_history,a.name agent_name,a.gender,a.accent,
    t.secret_ciphertext telnyx_secret,g.secret_ciphertext groq_secret,g.config groq_config,COALESCE(sa.script_text,'') script_text,sa.lead_headers,sa.lead_rows
    FROM agent_calls c JOIN agents a ON a.id=c.agent_id
    JOIN agent_credentials ta ON ta.agent_id=c.agent_id AND ta.provider='TELNYX' JOIN ai_credentials t ON t.id=ta.credential_id
    LEFT JOIN agent_credentials ga ON ga.agent_id=c.agent_id AND ga.provider='GROQ' LEFT JOIN ai_credentials g ON g.id=ga.credential_id
    LEFT JOIN LATERAL (SELECT * FROM script_assignments WHERE agent_id=c.agent_id ORDER BY created_at DESC LIMIT 1) sa ON TRUE
    WHERE c.telnyx_call_control_id=$1 LIMIT 1`, [controlId]);
  const row = result.rows[0];
  if (!row?.telnyx_secret) return false;
  const fallback = firstMessage
    ? `Hello, this is ${row.agent_name}. I’m calling from the team today. How are you?`
    : "Mm-hmm, I understand. Could you tell me a little more about that?";
  const history = (Array.isArray(row.conversation_history) ? row.conversation_history : []) as ConversationTurn[];
  const recentHistory = history.slice(-8);
  const earlierClientAnswers = history.slice(0, -8).filter(turn => turn.role === "user").map(turn => turn.content).join(" | ").slice(-2400);
  const assistantTurnCount = history.filter(turn => turn.role === "assistant").length;
  const latestClientText = [...history].reverse().find(turn => turn.role === "user")?.content ?? "";
  const tenseClient = /angry|upset|annoyed|fraud|scam|stop|don't call|do not call|remove/i.test(latestClientText);
  const speakingRate = tenseClient ? 0.90 : 0.94;
  const fillerCount = history.filter(turn => turn.role === "assistant").reduce((count, turn) => count + ((turn.content.match(/\b(mm-hmm|well|let me see|right, so|just a moment)\b/gi) || []).length), 0);
  const fillerGuidance = !tenseClient && fillerCount < 3 && assistantTurnCount > 0 && assistantTurnCount % 3 === 0
    ? "Begin this response with exactly one natural, context-appropriate backchannel or filler such as 'Right', 'Mm-hmm' or 'Well'; never combine two."
    : `Do not use a thinking filler in this turn. ${fillerCount >= 3 ? "The whole-call filler limit has been reached." : ""}`;
  const system = `You are the calm, friendly, professional phone representative whose configured name is "${row.agent_name}". That is your only agent name. Names, blanks, question marks or sample personas inside the private playbook are instructions or placeholders, never your name. Use the company and role from the playbook.

Speak in natural UK English, or match the client's language when clear. Reply in one or two short sentences (normally under 40 spoken words) and ask at most one question. Listen first, understand the client's complete latest turn, answer it directly, then continue the next relevant playbook step. While the client is speaking, do not generate a response. If the customer interrupts, stop and answer that interruption first without a deliberate pause, then return to the next step. Never restart a cut-off line after an interruption. Never use the generic filler "Mm-hmm, I understand. Could you tell me more about that?". Do not repeat a question that was already answered, and do not say you failed to hear words that are present in the transcript.

On the first turn, give only a short, warm greeting, introduce yourself by your configured name and briefly state the organisation/call purpose when available. Do not ask for the client's name, phone number, email or any other lead information in the opening greeting. Let the client answer first. Never ask for, mention or seek permission for call/voice recording; recording is handled automatically and is not part of the conversation. Lead-data permission means permission to collect or confirm lead details, not recording permission.

Use the playbook as background knowledge, not a speech to recite. Never mention, quote or announce a script. Preserve its goal, facts, qualification order, objection handling and constraints, but paraphrase naturally. You may answer ordinary off-topic or follow-up questions from reliable general knowledge; for legal, medical, financial, current or uncertain facts, give a cautious general answer and do not invent certainty. Return smoothly to the next relevant call step after answering.

Treat lead data and history as memory. Never re-ask information already supplied. Listen until the customer has finished before replying. Accept partial information and request only the missing component, using what you heard: after a first name say "Thanks, [name]. And your surname?". If a first name or surname is unclear, do not guess or move on: ask "Could you spell that for me, please?", listen to the spelling, repeat the corrected name back once, and wait for confirmation before treating it as lead data. Confirm a date in two parts when needed (day, then month and year together, or the missing part); once the complete date is heard, repeat it back and ask for confirmation before moving on. Never say "repeat your full name/date" when one part is already clear. If values conflict, mention both briefly and ask which is correct. If the customer says they own a private or personal home, do not ask about tenancy, renting, landlord or tenancy start again. Acknowledge it and move to the next relevant question or close politely. Never repeat a question after it has been answered or refused; track answered fields and skip them.
If all required lead fields are complete, acknowledge the information positively, explain the next step if the playbook provides one, thank the customer warmly, and ask permission to end the call. Use a natural closing such as "Thank you, that’s everything I needed. We’ll review the details and be in touch. Have a lovely day — may I end the call?" Append [END_CALL] only after the customer agrees or gives a clear goodbye. If required fields are incomplete, keep collecting the missing fields politely and do not close early.

Unless the client explicitly opts out or asks to end, never close immediately after they say they have no issue, are not renting, are not interested, or have no current need. Explain briefly why an accurate contact record could help, ask permission to take or confirm their lead details, and wait for consent. Once they consent, collect every required lead field one at a time in the situation-appropriate order, regardless of whether they currently rent, have an issue, or want immediate help. If they decline, do not pressure them. If they ask any other question while lead data is being collected, answer that question first, then return to the next missing field. Before a successful close, recap the agreed next step and give the interested client every relevant contact detail from the playbook. For a phone number, email, date, amount or website, speak it clearly without filler; if asked again, repeat only that datum.

If asked who you are, say you are a team representative and identify your configured name, organisation and purpose accurately. Do not say AI, automated, bot or AI voice representative, and do not volunteer implementation details. If asked where the number came from, use a source field in lead data when available; otherwise say the original source is not shown to you and offer to stop contact. Only answer questions about your identity, organisation, purpose, this call, or the service described in the playbook. For unrelated business/general questions, say politely that you do not have that information and return to the call purpose. Answer the customer's latest question fully before asking the next lead question.
If the customer asks where you are from, answer the country and state/region as separate facts when asked separately, using the organisation's location from the playbook or lead data. If the exact state/region is not available, say so honestly; never invent one. If they ask for more information, provide the website link and WhatsApp number from the playbook or lead data, then warmly say they can find more information on the website. Speak WhatsApp numbers slowly, one digit at a time; if the customer asks you to slow down, group the number into short parts and repeat one part at a time. Read website addresses clearly and, if asked to slow down, break them into short parts. Do not use fillers while spelling or reading contact details.
Never switch language based only on accent, a few words in another language, or an assumption. Switch from English only when the customer explicitly says they do not understand English or directly asks to speak another language. For a calm customer who explicitly requests a language, first ask in English, "Which language would you prefer?" When they name a language, you may warmly joke once, "Oh, so you understood me after all — I'm just kidding," then immediately continue in that language. Never do this joke with an angry, upset, hesitant or confused customer; switch respectfully and simply. If the customer has not explicitly requested a language switch, continue in English.
Make a genuine effort to answer every reasonable question before moving on. For questions such as who you are, where you are calling from, the reason for the call, where you are based, whether you are a bot, whether this is a company or solicitor firm, charges, and whether payment is needed, answer directly from the playbook and known company facts. Keep the call reason especially clear: explain the purpose, what the company can help with, and what the next step is. Never invent fees, legal status, payment obligations or promises. If the playbook does not contain an answer—especially about charges or payment—say calmly that you do not have that detail on this call and offer the company's WhatsApp number or website for full guidance. Then return to the call purpose without sounding evasive.

Match tone to the client: calm and filler-free for anger, simpler for confusion, low-pressure for hesitation, and warm but factual for interest. Vary pace, warmth and sentence rhythm naturally while staying professional; do not keep one fixed tone throughout the call and do not become overly dramatic. Never call bad news "great". Use a backchannel such as "Mm-hmm" only when it genuinely acknowledges the customer's latest words, never repeat the same filler in consecutive turns, and never use it as a substitute for an answer. If only part of the customer's sentence is unclear, acknowledge the part understood and ask only for that missing portion; never say a generic "I didn't understand" when some words were clear. ${fillerGuidance} Useful natural starters include "Mm-hmm", "Right", "Okay", "I see", "Got it", "Well" and "Let me see"; use no more than one, only when it fits the situation, and never during important data.

Do not treat "no" as a refusal when it answers a factual question. A clear opt-out, removal request, goodbye or refusal to continue ends collection immediately. Otherwise do not force a disconnect. After the goal and required fields are complete, ask whether anything else would help. You may use the internal end-call marker only as instructed by the system, but never say, spell, explain, quote or expose any marker such as END_CALL, [END_CALL], END CALL or similar to the customer. Put any internal marker only at the very end.

Lead collection is voluntary and low-pressure. Before asking for the first lead detail, always ask politely for permission in natural wording, for example: "Would it be alright if I took a few quick details so the team can follow up properly?" or "Would you be happy for me to note down a couple of details?" Wait for a clear yes before collecting details. Do not ask permission repeatedly after consent, and never collect details if the client declines. Start with a proper greeting and your identity/purpose, then let the client speak. Answer the client’s question fully before asking anything. Ask for each lead detail once, maximum twice only when genuinely unclear. If declined or unavailable, accept it and move on; never force a lead or repeat the same request. Use only details the client gives you, never invent an answer.

Agent profile: ${row.gender}, ${row.accent}.
Lead data: ${JSON.stringify(leadData(row.lead_headers, row.lead_rows, row.lead_number))}
Earlier client answers: ${earlierClientAnswers || "None"}
Private playbook:
${String(row.script_text).slice(0, 10000)}`;
  const messages: ChatMessage[] = [{ role: "system", content: system }, ...recentHistory.map(turn => ({ role: turn.role, content: turn.content.slice(0, 600) }))];
  if (firstMessage) {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date()));
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    messages.push({ role: "user", content: `The call has just connected. Open with “${greeting}”, give a short natural greeting, introduce yourself using your configured name, and briefly identify the organisation/purpose from the playbook if available. Do not ask for the client's name or any lead information yet. Do not ask a qualification question yet. Finish the greeting and wait for the client's response.` });
  }
  const responseId = turnResponseId || randomUUID();
  const activated = await client.query("UPDATE agent_calls SET conversation_state=$1,current_response_id=$2,updated_at=NOW() WHERE id=$3 AND ($4::boolean=FALSE OR current_response_id=$2) RETURNING id", [firstMessage ? CALL_STATES.AI_GREETING : CALL_STATES.THINKING, responseId, row.id, Boolean(turnResponseId)]);
  if (!activated.rows[0]) return false;
  try {
    if (!row.groq_secret) throw new Error("No Groq credential is assigned to this agent.");
    const groqKey = decryptCredential(row.groq_secret);
    // GPT-OSS 20B is a low-latency default. A saved credential config can
    // select a different currently available Groq chat model per account.
    const model = typeof row.groq_config?.chatModel === "string" && row.groq_config.chatModel.trim() ? row.groq_config.chatModel.trim() : "openai/gpt-oss-20b";
    voiceLog("[GROQ] Request started", { controlId, responseId, historyTurns: history.length, greeting: firstMessage });
    // Keep the opening strictly greeting-only. The first client response must
    // arrive before the model is allowed to qualify or collect any lead data.
    const generated = firstMessage
      ? fallback
      : enforceLeadPermission(await requestGroqReply(groqKey, model, messages), latestClientText, history);
    const requestedEnd = /\[?\s*END[_ -]?CALL\s*\]?\s*$/i.test(generated);
    const endAfterSpeech = requestedEnd && clientAcceptedClosing(latestClientText, history);
    const reply = removeInternalMarkers(generated);
    if (requestedEnd && !endAfterSpeech) voiceLog("[CALL] Blocked premature AI end request", { controlId, latestClientText });
    if (!reply) throw new Error("Groq returned no agent reply.");
    voiceLog("[GROQ] Response received", { controlId, responseId, characters: reply.length });
    // A partial transcript may have arrived while Groq was thinking.  Do not
    // start stale audio after that barge-in has cancelled this response id.
    const remainingDelay = earliestSpeakAt - Date.now();
    if (remainingDelay > 0) await new Promise(resolve => setTimeout(resolve, remainingDelay));
    const active = await client.query("SELECT 1 FROM agent_calls WHERE id=$1 AND status='ANSWERED' AND current_response_id=$2", [row.id, responseId]);
    if (!active.rows[0]) return false;
    const played = await speak(controlId, decryptCredential(row.telnyx_secret), reply, row.gender, responseId, false, speakingRate);
    if (played) await client.query("UPDATE agent_calls SET conversation_state=$1,ending_requested=$2,conversation_history=conversation_history || jsonb_build_array(jsonb_build_object('role','assistant','content',$3::text,'at',NOW())),transcript=CASE WHEN transcript='' THEN 'AGENT: ' || $3::text ELSE transcript || E'\\nAGENT: ' || $3::text END,updated_at=NOW() WHERE id=$4 AND current_response_id=$5", [firstMessage ? CALL_STATES.AI_GREETING : CALL_STATES.SPEAKING, endAfterSpeech, reply, row.id, responseId]);
    else await addCallNote(client, row.id, "Telnyx rejected or could not start the speak command.");
    return played;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown reply-generation error.";
    console.error("Could not generate a conversational agent reply.", error);
    const claimed = await client.query("UPDATE agent_calls SET conversation_state=$1,failure_reason=$2,updated_at=NOW() WHERE id=$3 AND current_response_id=$4 RETURNING id", [firstMessage ? CALL_STATES.AI_GREETING : CALL_STATES.SPEAKING, reason.slice(0, 1000), row.id, responseId]);
    if (!claimed.rows[0]) return false;
    await addCallNote(client, row.id, `AI reply failed; used spoken fallback. ${reason}`);
    const contextualFallback = firstMessage ? fallback : providerFailureReply(row, latestClientText);
    const played = await speak(controlId, decryptCredential(row.telnyx_secret), contextualFallback, row.gender, responseId, false, speakingRate);
    if (played) await client.query("UPDATE agent_calls SET conversation_history=conversation_history || jsonb_build_array(jsonb_build_object('role','assistant','content',$1::text,'at',NOW())),transcript=CASE WHEN transcript='' THEN 'AGENT: ' || $1::text ELSE transcript || E'\\nAGENT: ' || $1::text END,updated_at=NOW() WHERE id=$2 AND current_response_id=$3", [contextualFallback, row.id, responseId]);
    else await addCallNote(client, row.id, "Telnyx rejected or could not start the fallback speak command.");
    return played;
  }
}

async function handleClientSpeech(controlId: string, text: string, client: Awaited<ReturnType<typeof db>>, forceFinal = false) {
  const pending = await client.query("SELECT id,pending_client_text FROM agent_calls WHERE telnyx_call_control_id=$1 AND status='ANSWERED' LIMIT 1", [controlId]);
  const pendingText = String(pending.rows[0]?.pending_client_text || "").trim();
  text = `${pendingText} ${text}`.trim();
  if (!forceFinal && incompleteSpeech(text)) {
    await client.query("UPDATE agent_calls SET pending_client_text=$1,pending_client_at=NOW(),updated_at=NOW() WHERE telnyx_call_control_id=$2 AND status='ANSWERED'", [text, controlId]);
    voiceLog("[STT] Held incomplete final transcript for continuation", { controlId, characters: text.length });
    await new Promise(resolve => setTimeout(resolve, 900));
    const claimed = await client.query("UPDATE agent_calls SET pending_client_text='',pending_client_at=NULL WHERE telnyx_call_control_id=$1 AND status='ANSWERED' AND pending_client_text=$2 RETURNING id", [controlId, text]);
    if (claimed.rows[0]) await handleClientSpeech(controlId, text, client, true);
    return;
  }
  if (pendingText) voiceLog("[STT] Merged split final transcript", { controlId, characters: text.length });
  await client.query("UPDATE agent_calls SET pending_client_text='',pending_client_at=NULL WHERE telnyx_call_control_id=$1", [controlId]);
  // Every final utterance supersedes an older in-flight response. The response
  // id acts as an ownership token, so the cancelled request cannot later clear
  // or speak over this newer turn.
  await stopSpeaking(controlId, client);
  const turnResponseId = randomUUID();
  const locked = await client.query("UPDATE agent_calls SET conversation_busy=TRUE,conversation_state=$1,current_response_id=$2,conversation_history=conversation_history || jsonb_build_array(jsonb_build_object('role','user','content',$3::text,'at',NOW())),transcript=CASE WHEN transcript='' THEN 'CLIENT: ' || $3::text ELSE transcript || E'\\nCLIENT: ' || $3::text END,start_note=CASE WHEN start_note='' THEN 'Customer opened with: ' || $3::text ELSE start_note END,mid_note=CASE WHEN mid_note='' THEN 'Customer: ' || $3::text ELSE mid_note || E'\\nCustomer: ' || $3::text END,updated_at=NOW() WHERE telnyx_call_control_id=$4 AND status='ANSWERED' RETURNING id", [CALL_STATES.THINKING, turnResponseId, text, controlId]);
  if (!locked.rows[0]) return;
  await client.query("UPDATE agent_calls SET silence_prompt_count=0 WHERE id=$1", [locked.rows[0].id]);
  voiceLog("[STT] Final transcript", { controlId, characters: text.length });
  const isOptOut = /\b(remove|delete)\s+(my\s+)?(number|details)\b|\b(do not|don't|dont|stop)\s+(call|calling|contact)|\bcall me (again )?mat (karna|karo)\b/i.test(text);
  if (isOptOut) {
    const call = await client.query("SELECT id,lead_number FROM agent_calls WHERE id=$1", [locked.rows[0].id]);
    if (call.rows[0]?.lead_number) {
      await client.query("INSERT INTO do_not_call (phone_number,source_call_id,reason) VALUES ($1,$2,$3) ON CONFLICT (phone_number) DO UPDATE SET source_call_id=EXCLUDED.source_call_id,reason=EXCLUDED.reason,created_at=NOW()", [call.rows[0].lead_number, call.rows[0].id, "Customer requested no further calls"]);
      await addCallNote(client, call.rows[0].id, "Do-not-call request detected and number added to suppression list.");
      voiceLog("[COMPLIANCE] Number suppressed", { callId: call.rows[0].id });
    }
  }
  try {
    // Leave a short natural pause after the customer finishes speaking.
    await generateReply(controlId, client, false, Date.now() + 1250, turnResponseId);
  } finally {
    await client.query("UPDATE agent_calls SET conversation_busy=FALSE,conversation_state=CASE WHEN conversation_state=$1 THEN $2 ELSE conversation_state END,updated_at=NOW() WHERE id=$3 AND current_response_id=$4", [CALL_STATES.INTERRUPTED, CALL_STATES.LISTENING, locked.rows[0].id, turnResponseId]);
  }
}

async function generateAiCallNotes(controlId: string, client: Awaited<ReturnType<typeof db>>) {
  const result = await client.query("SELECT c.id,c.transcript,g.secret_ciphertext FROM agent_calls c JOIN agent_credentials a ON a.agent_id=c.agent_id AND a.provider='GROQ' JOIN ai_credentials g ON g.id=a.credential_id WHERE c.telnyx_call_control_id=$1 LIMIT 1", [controlId]);
  const row = result.rows[0], transcript = String(row?.transcript || "").trim();
  if (!row?.secret_ciphertext || !transcript) return;
  try {
    const model = "openai/gpt-oss-20b";
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${decryptCredential(row.secret_ciphertext)}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0.2, ...(model.startsWith("openai/gpt-oss-") ? { reasoning_effort: "low", reasoning_format: "hidden" } : {}), messages: [{ role: "system", content: "Create concise final call records. Return JSON only: {summary:string,notes:string,outcome:string}. Outcome must be one of QUALIFIED, FOLLOW_UP, NOT_INTERESTED, NO_ANSWER, INCOMPLETE, or UNKNOWN. Count a lead as successful/qualified when at least 50% of the required lead fields were collected, even if some fields are missing; use FOLLOW_UP when the partial lead needs completion. Put the exact note 'Lead received (partial)' in notes for such a lead. Do not invent facts. Use INCOMPLETE only when less than 50% of required lead fields were collected." }, { role: "user", content: transcript.slice(-18000) }] }) });
    const data = await response.json().catch(() => ({})), content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return;
    const jsonText = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Groq returned no JSON call summary.");
    const parsed = JSON.parse(jsonText.slice(start, end + 1));
    const summary = String(parsed.summary || ""), notes = String(parsed.notes || ""), outcome = String(parsed.outcome || "UNKNOWN").toUpperCase();
    await client.query("UPDATE agent_calls SET summary=COALESCE(NULLIF($1,''),summary),notes=COALESCE(NULLIF($2,''),notes),final_note=COALESCE(NULLIF($2,''),final_note),outcome=CASE WHEN $3 IN ('QUALIFIED','FOLLOW_UP','NOT_INTERESTED','NO_ANSWER','INCOMPLETE','UNKNOWN') THEN $3 ELSE 'UNKNOWN' END,updated_at=NOW() WHERE id=$4", [summary, notes, outcome, row.id]);
    voiceLog("[SUMMARY] Final summary saved", { controlId, callId: row.id });
  } catch (error) { voiceLog("[SUMMARY] Could not create AI call notes", { controlId, reason: error instanceof Error ? error.message : "unknown" }); }
}

async function syncAssistantHistory(controlId: string, client: Awaited<ReturnType<typeof db>>) {
  const result = await client.query(`SELECT c.id,c.telnyx_ai_conversation_id,t.secret_ciphertext
    FROM agent_calls c JOIN agent_credentials ta ON ta.agent_id=c.agent_id AND ta.provider='TELNYX'
    JOIN ai_credentials t ON t.id=ta.credential_id
    WHERE c.telnyx_call_control_id=$1 LIMIT 1`, [controlId]);
  const row = result.rows[0];
  if (!row?.telnyx_ai_conversation_id) return;
  try {
    const response = await fetch(`https://api.telnyx.com/v2/ai/conversations/${encodeURIComponent(row.telnyx_ai_conversation_id)}/messages`, { headers: { Authorization: `Bearer ${decryptCredential(row.secret_ciphertext)}`, Accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data?.data)) return;
    const turns = data.data.filter((item: { role?: unknown; text?: unknown; content?: unknown }) => (item.role === "assistant" || item.role === "user") && typeof (item.text ?? item.content) === "string").map((item: { role: "assistant"|"user"; text?: string; content?: string }) => ({ role: item.role, content: String(item.text ?? item.content).slice(0, 4000), at: new Date().toISOString() }));
    if (!turns.length) return;
    const transcript = turns.map((turn: { role: string; content: string }) => `${turn.role === "assistant" ? "AGENT" : "CLIENT"}: ${turn.content}`).join("\n");
    await client.query("UPDATE agent_calls SET conversation_history=$1::jsonb,transcript=$2,updated_at=NOW() WHERE id=$3", [JSON.stringify(turns), transcript, row.id]);
  } catch (error) { voiceLog("[TELNYX AI] Could not sync conversation history", { controlId, reason: error instanceof Error ? error.message : "unknown" }); }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifiedTelnyxWebhook(request, rawBody)) return Response.json({ message: "Invalid Telnyx webhook signature." }, { status: 403 });

  let body: { data?: { id?: unknown; event_type?: unknown; payload?: unknown } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ message: "Invalid webhook payload." }, { status: 400 });
  }
  const event = typeof body.data?.event_type === "string" ? body.data.event_type : undefined;
  const payload = body.data?.payload as Record<string, unknown> | undefined;
  if (!event || !payload?.call_control_id) return Response.json({ ok: true });

  const client = await db();
  const eventId = typeof body.data?.id === "string" ? body.data.id : null;
  if (eventId) {
    const inserted = await client.query("INSERT INTO telnyx_webhook_events (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id", [eventId]);
    if (!inserted.rows[0]) return Response.json({ ok: true, duplicate: true });
  }

  const controlId = String(payload.call_control_id);
  const sessionId = payload.call_session_id ? String(payload.call_session_id) : null;
  // Correlate events even if the webhook arrives before the dial response.
  if (typeof payload.client_state === "string") {
    try {
      const state = JSON.parse(Buffer.from(payload.client_state, "base64").toString("utf8"));
      if (typeof state.callId === "string" && /^[0-9a-f-]{36}$/i.test(state.callId)) {
        await client.query("UPDATE agent_calls SET telnyx_call_control_id=$1,telnyx_call_session_id=COALESCE($2,telnyx_call_session_id),updated_at=NOW() WHERE id=$3 AND (telnyx_call_control_id IS NULL OR telnyx_call_control_id=$1)", [controlId,sessionId,state.callId]);
      }
    } catch { /* Older calls may use a different client state format. */ }
  }
  voiceLog("[TELNYX] Webhook received", { event, controlId });
  if (event === "call.initiated") await client.query("UPDATE agent_calls SET telnyx_call_control_id=$1,telnyx_call_session_id=COALESCE($2,telnyx_call_session_id),status='RINGING',updated_at=NOW() WHERE (telnyx_call_control_id=$1 OR telnyx_call_session_id=$2) AND status='INITIATED'", [controlId, sessionId]);
  if (event === "call.answered") {
    voiceLog("[CALL] Connected", { controlId });
    await client.query("UPDATE agent_calls SET status='ANSWERED',conversation_state=$1,answered_at=COALESCE(answered_at,NOW()),updated_at=NOW() WHERE telnyx_call_control_id=$2 OR telnyx_call_session_id=$3", [CALL_STATES.INITIALIZING, controlId, sessionId]);
    try { await startAutomaticRecording(controlId, client); }
    catch (error) {
      const reason = error instanceof Error ? error.message : "Automatic recording could not start.";
      const callId = (await client.query("SELECT id FROM agent_calls WHERE telnyx_call_control_id=$1", [controlId])).rows[0]?.id;
      if (callId) await addCallNote(client, callId, `Recording unavailable; call audio conversation continued. ${reason}`);
      voiceLog("[RECORDING] Start failed; continuing with greeting", { controlId, reason });
    }
    try { await startManagedConversation(controlId, client); }
    catch (error) {
      const reason = error instanceof Error ? error.message : "Telnyx AI Assistant could not start.";
      await client.query("UPDATE agent_calls SET conversation_state=$1,failure_reason=$2,updated_at=NOW() WHERE telnyx_call_control_id=$3", [CALL_STATES.FAILED, reason.slice(0, 1000), controlId]);
      await addCallNote(client, (await client.query("SELECT id FROM agent_calls WHERE telnyx_call_control_id=$1", [controlId])).rows[0]?.id || "", reason);
      voiceLog("[TELNYX AI] Start failed", { controlId, reason });
    }
  }
  if (event === "call.hangup") { voiceLog("[CALL_ENDED]", { controlId }); await client.query("UPDATE agent_calls SET status='COMPLETED',conversation_state=$1,current_response_id=NULL,conversation_busy=FALSE,recording_active=FALSE,on_hold=FALSE,ended_at=NOW(),duration_seconds=GREATEST(duration_seconds,FLOOR(EXTRACT(EPOCH FROM (NOW()-COALESCE(answered_at,created_at))))::int),updated_at=NOW() WHERE telnyx_call_control_id=$2 OR telnyx_call_session_id=$3", [CALL_STATES.COMPLETED, controlId, sessionId]); await syncAssistantHistory(controlId, client); await new Promise(resolve => setTimeout(resolve, 1200)); await syncAssistantHistory(controlId, client); await generateAiCallNotes(controlId, client); }
  if (event === "call.recording.saved") {
    const urls = payload.recording_urls as { mp3?: unknown; wav?: unknown } | undefined;
    const recordingUrl = urls?.mp3 || urls?.wav || payload.recording_url;
    const reportedSize = Number(payload.recording_size_bytes || payload.file_size || 0);
    const sizeBytes = Number.isFinite(reportedSize) && reportedSize > 0 ? reportedSize : recordingUrl ? await recordingSize(String(recordingUrl)) : 0;
    await client.query("UPDATE agent_calls SET recording_url=COALESCE($1,recording_url),recording_id=COALESCE($2,recording_id),recording_size_bytes=CASE WHEN $3>0 THEN $3 ELSE recording_size_bytes END,recording_active=FALSE,updated_at=NOW() WHERE telnyx_call_control_id=$4 OR telnyx_call_session_id=$5", [recordingUrl ? String(recordingUrl) : null, payload.recording_id ? String(payload.recording_id) : null, sizeBytes, controlId, sessionId]);
  }
  if (event === "call.hold") { voiceLog("[HOLD]", { controlId }); await client.query("UPDATE agent_calls SET on_hold=TRUE,conversation_state='ON_HOLD',updated_at=NOW() WHERE telnyx_call_control_id=$1", [controlId]); }
  if (event === "call.unhold") { voiceLog("[HOLD] Resumed", { controlId }); await client.query("UPDATE agent_calls SET on_hold=FALSE,conversation_state=$1,updated_at=NOW() WHERE telnyx_call_control_id=$2 AND status='ANSWERED'", [CALL_STATES.LISTENING, controlId]); }
  if (event === "call.speak.started") {
    const responseId = typeof payload.client_state === "string" ? Buffer.from(payload.client_state, "base64").toString("utf8") : "";
    const result = await client.query("SELECT conversation_state FROM agent_calls WHERE telnyx_call_control_id=$1 AND current_response_id=$2", [controlId, responseId]);
    if (result.rows[0]) {
      voiceLog(result.rows[0].conversation_state === CALL_STATES.AI_GREETING ? "[AI] Greeting started" : "[AI] Speaking started", { controlId, responseId });
      voiceLog("[TELNYX] AI audio started", { controlId, responseId });
    }
  }
  if (event === "call.speak.failed") await handleSpeakFailure(controlId, payload, client);
  if (event === "call.speak.ended") {
    const responseId = typeof payload.client_state === "string" ? Buffer.from(payload.client_state, "base64").toString("utf8") : "";
    const prior = await client.query("SELECT conversation_state,ending_requested FROM agent_calls WHERE telnyx_call_control_id=$1 AND status='ANSWERED' AND current_response_id=$2", [controlId, responseId]);
    const transitioned = await client.query("UPDATE agent_calls SET conversation_state=$1,current_response_id=NULL,updated_at=NOW() WHERE telnyx_call_control_id=$2 AND status='ANSWERED' AND current_response_id=$3 AND conversation_state IN ($4,$5) RETURNING conversation_state,updated_at", [CALL_STATES.LISTENING, controlId, responseId, CALL_STATES.AI_GREETING, CALL_STATES.SPEAKING]);
    if (transitioned.rows[0]) {
      voiceLog(prior.rows[0]?.conversation_state === CALL_STATES.AI_GREETING ? "[AI] Greeting finished" : "[AI] Response finished", { controlId, responseId });
      if (prior.rows[0]?.conversation_state === CALL_STATES.AI_GREETING) await startInboundTranscription(controlId, client);
      voiceLog("[VOICE] Listening resumed", { controlId, responseId });
      if (prior.rows[0]?.ending_requested) {
        const credential = await client.query("SELECT t.secret_ciphertext FROM agent_calls c JOIN agent_credentials a ON a.agent_id=c.agent_id AND a.provider='TELNYX' JOIN ai_credentials t ON t.id=a.credential_id WHERE c.telnyx_call_control_id=$1", [controlId]);
        const secret = credential.rows[0]?.secret_ciphertext;
        if (secret) {
          await client.query("UPDATE agent_calls SET conversation_state=$1,updated_at=NOW() WHERE telnyx_call_control_id=$2", [CALL_STATES.ENDING, controlId]);
          try { await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(controlId)}/actions/hangup`, { method: "POST", headers: { Authorization: `Bearer ${decryptCredential(secret)}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ command_id: randomUUID() }) }); voiceLog("[CALL] AI requested end", { controlId }); } catch (error) { voiceLog("[CALL] AI end request failed", { controlId, reason: error instanceof Error ? error.message : "unknown" }); }
        }
      } else await promptAfterSilence(controlId, transitioned.rows[0].updated_at, client);
    } else voiceLog("[AI] Ignored stale speech-ended event", { controlId, responseId });
  }
  if (event === "call.transcription") {
    const data = payload.transcription_data as { transcript?: unknown; is_final?: unknown } | undefined;
    const text = typeof data?.transcript === "string" ? data.transcript.trim() : "";
    // Barge-in must happen as soon as the caller starts speaking. Waiting for the
    // final transcript makes the caller listen to the remainder of the agent turn.
    if (text && data?.is_final !== true) {
      voiceLog("[VOICE] Customer audio received", { controlId, final: data?.is_final === true, characters: text.length });
      voiceLog("[STT] Partial transcript", { controlId, characters: text.length });
      const interrupted = await stopSpeaking(controlId, client);
      if (interrupted) await client.query("UPDATE agent_calls SET interruption_count=interruption_count+1,notes=CASE WHEN notes='' THEN '[Quality] Client interrupted agent speech.' ELSE notes || E'\\n[Quality] Client interrupted agent speech.' END,updated_at=NOW() WHERE telnyx_call_control_id=$1", [controlId]);
      else await client.query("UPDATE agent_calls SET updated_at=NOW() WHERE telnyx_call_control_id=$1 AND status='ANSWERED'", [controlId]);
    }
    if (text && data?.is_final === true) await handleClientSpeech(controlId, text, client);
  }
  // Telnyx uses the conversation event for AI Assistant calls and the
  // ai_gather variant for gather calls. Support both so the live transcript
  // is written regardless of which assistant command produced it.
  if (event?.endsWith("message_history_updated")) {
    const history = Array.isArray(payload.message_history) ? payload.message_history : [];
    const turns = history
      .filter((turn): turn is { role: string; content: string } => !!turn && typeof turn === "object" && typeof (turn as { role?: unknown }).role === "string" && typeof (turn as { content?: unknown }).content === "string")
      .filter(turn => turn.role === "assistant" || turn.role === "user")
      .map(turn => ({ role: turn.role === "assistant" ? "assistant" : "user", content: turn.content.slice(0, 4000), at: new Date().toISOString() }));
    const transcript = turns.map(turn => `${turn.role === "assistant" ? "AGENT" : "CLIENT"}: ${turn.content}`).join("\n");
    await client.query("UPDATE agent_calls SET conversation_history=$1::jsonb,transcript=$2,conversation_state=$3,updated_at=NOW() WHERE telnyx_call_control_id=$4", [JSON.stringify(turns), transcript, CALL_STATES.LISTENING, controlId]);
  }
  if (event === "call.conversation.ended") {
    // Some Telnyx Assistant versions include the final history on the ended
    // callback instead of sending a separate history-update callback.
    const finalHistory = Array.isArray(payload.message_history) ? payload.message_history : [];
    if (finalHistory.length) {
      const turns = finalHistory
        .filter((turn): turn is { role: string; content: string } => !!turn && typeof turn === "object" && typeof (turn as { role?: unknown }).role === "string" && typeof (turn as { content?: unknown }).content === "string")
        .filter(turn => turn.role === "assistant" || turn.role === "user")
        .map(turn => ({ role: turn.role === "assistant" ? "assistant" : "user", content: turn.content.slice(0, 4000), at: new Date().toISOString() }));
      const transcript = turns.map(turn => `${turn.role === "assistant" ? "AGENT" : "CLIENT"}: ${turn.content}`).join("\n");
      await client.query("UPDATE agent_calls SET conversation_history=$1::jsonb,transcript=$2,updated_at=NOW() WHERE telnyx_call_control_id=$3", [JSON.stringify(turns), transcript, controlId]);
    }
    await client.query("UPDATE agent_calls SET telnyx_ai_conversation_id=COALESCE($1,telnyx_ai_conversation_id),conversation_state=$2,updated_at=NOW() WHERE telnyx_call_control_id=$3", [typeof payload.conversation_id === "string" ? payload.conversation_id : null, CALL_STATES.COMPLETED, controlId]);
    await syncAssistantHistory(controlId, client);
    await generateAiCallNotes(controlId, client);
  }
  return Response.json({ ok: true });
}
