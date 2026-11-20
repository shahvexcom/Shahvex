import { sessions } from "./agent-test";
import { handleTestSession as run } from "./agent-test-session";

type Session = NonNullable<ReturnType<typeof sessions.get>>;
type Draft = { token: string; parent: Session; shadow: Session; committed: boolean; cancelled: boolean; finished: boolean; timer: ReturnType<typeof setTimeout> };
const state = globalThis as unknown as { agentSpeechDrafts?: Map<string, Draft> };
const drafts = state.agentSpeechDrafts ??= new Map<string, Draft>();
const rateState = globalThis as unknown as { agentSpeechDraftRates?: Map<string, { at: number; count: number }> };
const rates = rateState.agentSpeechDraftRates ??= new Map<string, { at: number; count: number }>();
const json = (status: number, error: string, code?: string) => Response.json({ error, code }, { status, headers: { "cache-control": "no-store" } });
function release(id: string, d: Draft) {
  if (!d.finished || (!d.committed && !d.cancelled)) return;
  clearTimeout(d.timer);
  if (drafts.get(id) !== d) return;
  if (d.committed && !d.cancelled && sessions.get(id) === d.parent) {
    d.parent.messages = d.shadow.messages;
    d.parent.recordingHashes = d.shadow.recordingHashes;
    d.parent.turns = d.shadow.turns;
    d.parent.timeOfferMade = d.shadow.timeOfferMade;
    d.parent.voiceEmotionState = d.shadow.voiceEmotionState;
    d.parent.conductWarned = d.shadow.conductWarned;
    d.parent.unclearSpeechCount = d.shadow.unclearSpeechCount;
    d.parent.endedReason = d.shadow.endedReason;
    d.parent.endOfferMade = d.shadow.endOfferMade;
    d.parent.awaitingEndDecision = d.shadow.awaitingEndDecision;
    d.parent.endResumeQuestion = d.shadow.endResumeQuestion;
    d.parent.speechPhase = d.shadow.speechPhase;
    d.parent.awaitingHearingConfirmation = d.shadow.awaitingHearingConfirmation;
    d.parent.hearingConfirmed = d.shadow.hearingConfirmed;
    d.parent.introPlaybackComplete = d.shadow.introPlaybackComplete;
    d.parent.lastCompletedTurnId = d.shadow.lastCompletedTurnId;
    d.parent.introRestartPending = d.shadow.introRestartPending;
    d.parent.purposeDelivered = d.shadow.purposeDelivered;
    d.parent.handoffDeclined = d.shadow.handoffDeclined;
    d.parent.silenceQuestionRetried = d.shadow.silenceQuestionRetried;
    d.parent.silencePromptIndex = d.shadow.silencePromptIndex;
    d.parent.questionAliases = d.shadow.questionAliases;
  }
  d.parent.busy = false; d.parent.activeTurnId = undefined;
  drafts.delete(id);
}
function cancel(id: string, d: Draft) {
  clearTimeout(d.timer);
  // Once playback is confirmed, preserve the heard user turn and interrupted reply.
  d.cancelled = !d.committed; d.shadow.abort?.abort(); release(id, d);
}
/** Authenticated callers share this bounded, isolated draft transaction on local and PC routes. */
export async function handleTestSession(request: Request, owner: string, publicDemo = false) {
  const url = new URL(request.url), id = url.searchParams.get("id") || "", action = url.searchParams.get("action");
  const parent = sessions.get(id);
  if (!parent || parent.owner !== owner) return json(404, "Test session expired. Start again.");
  parent.lastSeen = Date.now();
  let d = drafts.get(id);
  if (action === "stop" || action === "interrupt") { if (d) cancel(id, d); return run(request, owner, publicDemo); }
  if (action === "commit" || action === "cancel") {
    const token = url.searchParams.get("turnId") || "";
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(token)) return json(400, "Invalid speech draft");
    if (action === "cancel") {
      // A cancellation may overtake its upload across Vercel/Cloudflare. Fence
      // that token before acknowledging, even if the upload has not arrived.
      parent.cancelledDrafts ??= new Set(); parent.cancelledDrafts.add(token);
      if (parent.cancelledDrafts.size > 200) parent.cancelledDrafts.delete(parent.cancelledDrafts.values().next().value!);
      if (d?.token === token) {
        cancel(id, d);
      } else if (parent.activeTurnId === token) parent.abort?.abort();
      if (parent.activeTurnId === token && parent.finished) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([parent.finished, new Promise<void>(resolve => { timer = setTimeout(resolve, 10000); })]); }
        finally { clearTimeout(timer); }
        if (parent.busy) return json(409, "Previous turn is finishing; try again.", "BUSY");
      }
    } else {
      if (!d || d.token !== token || d.cancelled) return json(409, "Draft is no longer available", "STALE_DRAFT");
      d.committed = true; clearTimeout(d.timer); release(id, d);
    }
    return Response.json({ accepted: true }, { headers: { "cache-control": "no-store" } });
  }
  if (action !== "draft") {
    if (action === "turn" && parent.cancelledDrafts?.has(url.searchParams.get("turnId") || "")) return json(409, "Turn was cancelled", "CANCELLED_DRAFT");
    return run(request, owner, publicDemo);
  }
  const token = url.searchParams.get("turnId") || "";
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(token) || !request.headers.get("content-type")?.startsWith("audio/wav")) return json(400, "Invalid speech draft");
  if (parent.cancelledDrafts?.has(token)) return json(409, "Speech draft was cancelled", "CANCELLED_DRAFT");
  if (parent.busy || d) return json(409, "Previous turn is finishing; try again.", "BUSY");
  const now = Date.now();
  for (const [key, value] of rates) if (now - value.at > 60000) rates.delete(key);
  const rate = rates.get(owner) || { at: now, count: 0 };
  if (++rate.count > 60) return json(429, "Too many speech drafts. Pause and try again.");
  rates.set(owner, rate);
  const shadow: Session = { ...parent, busy: false, abort: undefined, finished: undefined,
    questionAliases: parent.questionAliases ? new Map(parent.questionAliases) : undefined,
    voiceEmotionState: parent.voiceEmotionState ? { ...parent.voiceEmotionState } : undefined,
    messages: parent.messages.map(m => ({ ...m })), turns: new Set(parent.turns), recordingHashes: new Set(parent.recordingHashes) };
  d = { token, parent, shadow, committed: false, cancelled: false, finished: false, timer: setTimeout(() => {}, 0) };
  clearTimeout(d.timer);
  const tx = d;
  tx.timer = setTimeout(() => cancel(id, tx), 30000); tx.timer.unref?.();
  parent.busy = true; parent.activeTurnId = token; drafts.set(id, tx);
  const target = new URL(request.url); target.searchParams.set("action", "turn");
  try {
    const response = await run(new Request(target, request), owner, publicDemo, shadow);
    parent.abort = shadow.abort;
    parent.finished = (shadow.finished || Promise.resolve()).then(() => { tx.finished = true; release(id, tx); });
    // An abandoned tab or stream cannot leave its isolated work holding capacity.
    request.signal.addEventListener("abort", () => cancel(id, tx), { once: true });
    if (request.signal.aborted || !response.ok) cancel(id, tx);
    return response;
  } catch (error) { tx.finished = true; cancel(id, tx); throw error; }
}

