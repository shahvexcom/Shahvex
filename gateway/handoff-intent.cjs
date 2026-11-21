"use strict";
const textOf = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/[’]/g, "'")
    .trim();
const human =
  "(?:(?:a|an|the|your|that) )?(?:(?:real|live|human|licensed|verified) )*(?:person|human|agent|representative|specialist|member|advisor|adviser)";
function withdrawsHumanRequest(value) {
  const text = textOf(value);
  return (
    /\b(?:don't|do not|never)\s+(?:want\s+(?:you\s+)?to\s+)?(?:transfer|connect|put)\b/i.test(
      text,
    ) ||
    new RegExp(
      "\\b(?:don't|do not|never) (?:want|need)(?: to (?:speak|talk) (?:to|with))? " +
        human +
        "\\b",
      "i",
    ).test(text) ||
    /^(?:no (?:transfer|agent)|cancel (?:the |my )?transfer)[.! ]*$/i.test(text)
  );
}
function reaffirmsHumanRequest(value, history = []) {
  const text = textOf(value);
  if (
    withdrawsHumanRequest(text) ||
    /\b(?:don't|do not|won't|no longer) (?:want|need|wait)|\b(?:why|what for|if|whether)\b/i.test(
      text,
    )
  )
    return false;
  if (
    !history.some(
      (t) =>
        (t.role === "assistant" &&
          /\b(?:connect|transfer|licensed|specialist)\b/i.test(t.content)) ||
        (t.role === "user" && customerRequestsHuman(t.content)),
    )
  )
    return false;
  return (
    /\b(?:I(?:'m| am) (?:still )?waiting(?: for (?:that|the (?:connection|transfer|agent)))?|go ahead|please connect with me)\b/i.test(
      text,
    ) &&
    /\b(?:you (?:ask|asked|said|told|offered)|connect|transfer|licen[cs]e(?:d)?|specialist)\b/i.test(
      text,
    )
  );
}
function affirmativeTransferConsent(value) {
  const text = textOf(value)
    .toLowerCase()
    .replace(/[,!.?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:um|uh)\s+)+/, '');
  const yes = /^(?:hmm|hm|mm|yes|yeah|yep|yup|uh[- ]?huh|mm[- ]?hmm|mhm|okay|ok|sure|sure thing|alright|all right|absolutely|certainly|of course|sounds good|great|why not|why nit|that's fine|please do|go ahead)(?: (?:please|go ahead|yes|sure|okay|ok|great|i ?am|i do|i would|why not|why nit))*$/;
  return yes.test(text);
}
function customerRequestsHuman(value, history = []) {
  const text = textOf(value);
  if (reaffirmsHumanRequest(text, history)) return true;
  if (
    withdrawsHumanRequest(text) ||
    /\b(?:after|once|when) (?:I|we|you)\b|\bif\b.*\b(?:give|answer|complete|qualify|eligible)\b/i.test(
      text,
    ) ||
    /\b(?:he|she|they) (?:said|says|asked)\b/i.test(text)
  )
    return false;
  // Match a request clause, not the words "connect me" inside a why/how question.
  // The same predicate governs conversational acknowledgments and real handoff consent.
  const clauses = text
    .split(
      /(?:[.!?;,]+|\s+but\s+|\s+and\s+(?=(?:please\s+)?(?:transfer|connect|put)\b))/i,
    )
    .map((s) => s.trim())
    .filter(Boolean);
  return clauses.some((clause) => {
    if (
      /^(?:why|what|who|where|when|how|do you|are you|have you|did you|will I|would I|is it|does it)\b/i.test(
        clause,
      ) ||
      /\b(?:if|whether|might|maybe|perhaps)\b/i.test(clause)
    )
      return false;
    return (
      /^(?:(?:okay|ok|yes|yeah|sure|alright|all right|then|please)\s+)*(?:(?:can|could|would|will) you (?:please )?)?(?:(?:transfer|connect) me(?: (?:please|now|right now))?$|(?:transfer|connect|put) me (?:to|through|with)\b|(?:transfer|connect) (?:my|this|the) calls?\b)/i.test(
        clause,
      ) ||
      new RegExp(
        "^I(?:'d like| (?:really |just )?(?:want|would like|need|prefer))(?: to)? (?:speak|talk|deal) (?:to|with) " +
          human +
          "\\b",
        "i",
      ).test(clause) ||
      new RegExp(
        "^(?:please )?(?:can|could|may) I (?:speak|talk) (?:to|with) " +
          human +
          "\\b",
        "i",
      ).test(clause) ||
      new RegExp(
        "^I(?:'ll| will| would rather| prefer to) (?:give|share|provide|discuss) (?:my |the )?(?:details|information|answers) (?:directly )?(?:to|with) " +
          human +
          "\\b",
        "i",
      ).test(clause)
    );
  });
}
function waitingAcknowledgment(value) {
  const text = textOf(value);
  return (
    /^(?:hmm|hm|mm|mm[- ]?hmm|mhm|yes|yeah|yep|sure|absolutely|certainly|of course|okay|ok|all right|alright|please do|go ahead)(?:[,.! ]+(?:please|go ahead|yes|sure|okay|ok))*[.! ]*$/i.test(
      text,
    ) ||
    /^(?:(?:okay|ok|yes|yeah|sure|all right|alright|fine)[,.! ]*)?(?:I(?:'m| am) (?:still )?(?:here[, ]+I(?:'m| am) )?waiting|waiting|I(?:'m| am) (?:here|there))[.!?, ]*$/i.test(
      text,
    )
  );
}
/** A listening/presence confirmation is never permission for a transfer. */
function isTransferOffer(turn) {
  if (turn.role !== "assistant" || turn.content.includes("[interrupted]"))
    return false;
  const qs = turn.content.match(/[^.!?\n]+\?/g) || [];
  const offer = qs.length === 1 ? qs[0] : qs.length === 0 ? turn.content : "";
  if (/\b(?:can'?t|cannot|couldn'?t|won'?t|unable to|not going to|already)\b/i.test(offer))
    return false;
  return (
    !/\b(?:if|after|once|when|later)\b/i.test(offer) &&
    /\b(?:transfer|connect)\s+(?:you|your call)\b|\b(?:speak|talk) (?:to|with) (?:a |an |the )?(?:human|person|agent|representative|specialist|team)\b/i.test(
      offer,
    )
  );
}
function requestedTransferAnnouncement(script) {
  return configuredTransferAnnouncement(script) || "I'll connect you now.";
}
function configuredTransferAnnouncement(script) {
  return String(script || '').split('\n').map(line=>line.trim()).find(line=>
    /^(?:let me|I(?:'ll| will| am going to)) (?:connect|transfer) (?:you|your call)\b[^?!]*[.!]?$/i.test(line));
}
function configuredTransferOffer(script) {
  return String(script || '').split('\n').map(line=>line.trim()).find(content=>
    /^(?:may|can|could|shall|should|would|do)\b[^?]+\?$/i.test(content) && isTransferOffer({role:'assistant',content}));
}
function requiresTransferAcceptance(script) {
  return /\b(?:consent|permission|agrees?|accepts?|opts? in)\b[^.\n]{0,55}\b(?:transfer|handoff|connect)\b|\b(?:transfer|handoff|connect)\b[^.\n]{0,55}\b(?:consent|permission|agrees?|accepts?|opts? in)\b/i.test(script) ||
    Boolean(configuredTransferOffer(script));
}
function handoffDeclineReply(value, history) {
  const text = textOf(value);
  if (
    withdrawsHumanRequest(text) ||
    (isTransferOffer(history.at(-1) || {}) &&
      /^(?:no|nope|not (?:yet|now)|I(?:'d| would) (?:rather|prefer to) (?:stay|continue|speak|talk) (?:here|with you))[.! ,]*$/i.test(
        text,
      ))
  )
    return "Of course. We can continue here.";
}
function transferConsent(history) {
  let consent = false,
    pending = false;
  const prefix = [];
  for (const turn of history) {
    prefix.push(turn);
    if (turn.role === "assistant") {
      pending = isTransferOffer(turn);
      continue;
    }
    if (turn.role !== "user") continue;
    if (withdrawsHumanRequest(turn.content)) {
      consent = false;
      pending = false;
      continue;
    }
    if (customerRequestsHuman(turn.content, prefix)) {
      consent = true;
      pending = false;
      continue;
    }
    if (pending) {
      if (affirmativeTransferConsent(turn.content)) consent = true;
      else if (
        /^(?:no|nope|not now|no thanks)[.! ]*$/i.test(textOf(turn.content))
      )
        consent = false;
      // Questions and audio checks consume the offer: a later unrelated yes cannot accept it.
      pending = false;
    }
  }
  return consent;
}
function handoffWaiting(history) {
  let waiting = false;
  const prefix = [];
  for (const turn of history) {
    prefix.push(turn);
    if (turn.role === "user" && withdrawsHumanRequest(turn.content))
      waiting = false;
    if (
      turn.role === "assistant" &&
      /^(?:Please wait while I connect you to the [a-z ]+|Alright, please wait)\.$/i.test(
        turn.content.trim(),
      )
    )
      waiting = transferConsent(prefix);
    if (
      turn.role === "assistant" &&
      /\b(?:cannot|can't|unable to) (?:connect|transfer)|transfer (?:failed|cancelled|canceled)/i.test(
        turn.content,
      )
    )
      waiting = false;
  }
  return waiting;
}
function routineHandoffOffer(script, memory, customer) {
  const {
    supportsSimpleScriptFlow,
    scriptQuestionProgress,
    questionKey,
  } = require("./reply-integrity.cjs");
  const answer =
    memory.latestAnswer === undefined
      ? memory.completed.at(-1)
      : memory.latestAnswer;
  if (
    !supportsSimpleScriptFlow(script) ||
    answer?.response !== customer ||
    /[?]|\b(?:why|what|how|who|wait|don't|do not)\b/i.test(customer)
  )
    return;
  const progress = scriptQuestionProgress(script, memory);
  if (
    !progress.length ||
    progress.some(
      (q) =>
        q.applicability === "unresolved" ||
        (q.applicability === "required" && q.status !== "answered"),
    )
  )
    return;
  if (
    !progress.some(
      (q) => questionKey(answer.question) === questionKey(q.question),
    )
  )
    return;
  const target = String(script).match(
    /\b(?:connect|transfer) you (?:with|to) (?:a|an|the) ((?:licensed |human |live )?(?:specialist|agent|representative|advisor|adviser|person))\b(?: who can ([^.!?\n]{3,200}))?/i,
  );
  if (!target) return;
  return `Let me connect you with a ${target[1]}${target[2] ? ` who can ${target[2]}` : ""}.`;
}
/** Explain an offered handoff using its configured purpose, then ask for agreement. */
function handoffExplanationReply(value, history, script = "") {
  const text = textOf(value);
  if (customerRequestsHuman(text) || withdrawsHumanRequest(text)) return;
  const reason =
    /\b(?:why|what for|for what|what.*reason)\b[^.!?]{0,140}\b(?:connect|transfer|agent|specialist|person|representative)\b/i.test(
      text,
    );
  const wait = /^wait(?:ing)? for what[?! .]*$/i.test(text);
  const definition =
    /^(?:what(?:'s| is)|who (?:is|are)) (?:a |an |the )?(?:licensed |human |live )?(?:specialist|agent|representative|advisor|adviser|person)(?:s)?[?! .]*$/i.test(
      text,
    );
  if (!reason && !wait && !definition) return;
  if (
    wait &&
    !history.some(
      (t) =>
        t.role === "assistant" &&
        /\b(?:wait|connect|transfer)\b/i.test(t.content),
    )
  )
    return;
  const target = String(script).match(
    /\b(?:connect|transfer) you (?:with|to) (?:a|an|the) ((?:licensed |human |live )?(?:specialist|agent|representative|advisor|adviser|person))\b(?: who can ([^.!?\n]{3,200}))?/i,
  );
  if (!target) return;
  const role = target[1],
    task = target[2];
  if (definition)
    return `${/^licensed /i.test(role) ? "A licensed specialist is a person with a professional license. " : ""}${task ? `Their role here is to ${task}.` : `You can choose whether to speak with the ${role}.`}`;
  const purpose = task
    ? `The ${role} can ${task}.`
    : `The handoff would let you speak with a ${role} for further help.`;
  if (transferConsent(history))
    return `${purpose} I don't have confirmation of a completed transfer yet.`;
  return `${wait && history.some((t) => t.role === "assistant" && /\b(?:please wait|hold on)\b/i.test(t.content)) ? "I should have explained before asking you to wait. " : ""}${purpose} Would you like me to connect you?`;
}
module.exports = {
  configuredTransferAnnouncement,
  requestedTransferAnnouncement,
  configuredTransferOffer,
  requiresTransferAcceptance,
  reaffirmsHumanRequest,
  handoffWaiting,
  customerRequestsHuman,
  withdrawsHumanRequest,
  waitingAcknowledgment,
  affirmativeTransferConsent,
  transferConsent,
  handoffExplanationReply,
  routineHandoffOffer,
  isTransferOffer,
  handoffDeclineReply,
};

