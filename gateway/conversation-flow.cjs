"use strict";
const { rememberQuestions } = require("./question-memory.cjs");
const isPresenceCheck = (text) =>
  /^(?:(?:hello|hi|hey)[?!., ]*)+(?:(?:are you (?:still )?there|can you hear me)[?!., ]*)?$|^(?:are you (?:still )?there|(?:is )?(?:anyone|anybody|someone|somebody) there|can you hear me)[?!., ]*$/i.test(
    String(text || "").trim(),
  );
function hearingRecoveryIntent(text, awaitingConfirmation = false) {
  const value = String(text || "").trim().replace(/[’]/g, "'")
    .replace(/[,!.?]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:(?:sorry|hello|uh|um|no|but|don't disappear on me) )*(?:I )?(?:can ?not|can't|cant|could not|couldn't|did not|didn't|do not|don't|am not|I'm not) (?:really )?(?:hear|hearing|here) you(?: clearly| very well| at all)?(?: what did you say| can you repeat that)?$/i.test(value) ||
      /\b(?:your|the) (?:voice|audio|sound|line)(?: is| keeps| sounds| seems)? (?:breaking(?: up)?|cutting(?: out)?|crackling|choppy|distorted|unclear|not clear|too (?:low|quiet))\b|\byou(?:'re| are) (?:breaking up|cutting out)\b/i.test(value))
    return "complaint";
  if (/^(?:(?:hello|hi|hey|uh|um|are you there) )*(?:can|could|do) you (?:hear|here) me(?: clearly| now| okay)?(?: good)?$/i.test(value))
    return "check";
  if (/^(?:(?:yes|yeah|yep|yup|okay|ok|sure) )?(?:I(?:'m| am) (?:still )?here|I (?:can )?hear you)(?: now| clearly)?(?: (?:and )?I (?:can )?hear you(?: now| clearly)?)?$/i.test(value) ||
      awaitingConfirmation && /^(?:yes|yeah|yep|yup|okay|ok|sure|I am|I can)$/i.test(value))
    return "confirmation";
}
const isGreetingOnly = (text) =>
  /^(?:(?:hello|hi|hey)[?!., ]*)+$/i.test(String(text || "").trim());
const isAfterIntroduction = (spoken) =>
  spoken.length === 1 &&
  /\b(?:this is|my name is|I(?:'m| am))\b/i.test(spoken[0].content) &&
  !/\[interrupted\]|\b(?:calling (?:to|about|because|regarding)|reason (?:for|I))\b/i.test(
    spoken[0].content,
  );
const asksCallingPurpose = (text) =>
  /\bwhy\b[^.!?]{0,70}\bcall(?:ing|ed)?\b|\bwhat\b[^.!?]{0,50}\bcall\b[^.!?]{0,25}\babout\b/i.test(
    String(text || ""),
  );
const acknowledgment = (text) =>
  /^(?:yes|yeah|yep|sure|okay|ok|alright|all right|go ahead|please do)[.! ,?]*$/i.test(
    String(text).trim(),
  );
function interruptionKind(text) {
  const value = String(text || "")
    .trim()
    .toLowerCase();
  if (!value) return "ignore";
  const words = value
    .replace(/\bmm[ -]?hmm\b/g, "mhm")
    .replace(/\buh[ -]?huh\b/g, "uhhuh")
    .replace(/\bof course\b/g, "ofcourse")
    .replace(/\bi see\b/g, "isee")
    .replace(/\ball right\b/g, "alright")
    .split(/[\s,.!?-]+/)
    .filter(Boolean);
  const fillers = new Set([
    "uh",
    "um",
    "erm",
    "hmm",
    "hm",
    "mm",
    "mhm",
    "uhhuh",
    "ah",
  ]);
  const acknowledgments = new Set([
    "okay",
    "ok",
    "yeah",
    "yep",
    "yes",
    "right",
    "sure",
    "alright",
    "ofcourse",
    "isee",
    "absolutely",
    "certainly",
  ]);
  if (
    words.length &&
    words.every((w) => fillers.has(w) || acknowledgments.has(w))
  )
    return words.some((w) => acknowledgments.has(w))
      ? "acknowledgment"
      : "filler";
  return "interrupt";
}
const key = (s) =>
  s
    .toLowerCase()
    .replace(
      /^(?:Coming back to (?:your|the) question:|Before we finish,)\s*/i,
      "",
    )
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
function mainQuestions(script) {
  let source = String(script || "");
  const task = source.search(/(?:^|\n)\s*\d*\.?\s*Tasks\s*\n/i);
  if (task >= 0) source = source.slice(task);
  source = source.split(
    /(?:^|\n)\s*\d*\.?\s*(?:Knowledge|FAQs?|Restrictions)\s*\n/i,
  )[0];
  const out = [];
  for (const line of source.split("\n")) {
    if (
      /^\s*(?:if (?:yes|no|both|unsure|they|customer)|FAQ|Q:|customer asks|if asked)/i.test(
        line,
      )
    )
      continue;
    for (const match of line.matchAll(
      /\b(?:are you|do you|does your|have you|is your|what (?:is|are)|how (?:old|many|much)|may I know|can you|would you|which\b)[^?\n]*\?/gi,
    )) {
      const q = match[0].trim();
      if (
        q.length > 500 ||
        /^(?:are you today|are you doing|are you feeling)\b/i.test(q) ||
        /\b(?:good time|okay time|time to talk|minute|moment|how are you|connect|transfer|permission|continue reviewing)\b/i.test(
          q,
        )
      )
        continue;
      if (!out.some((x) => key(x) === key(q))) out.push(q);
    }
  }
  return out;
}
// Audio checks precede progression so a greeting cannot consume a script step.
function audioCheckReply(text, history) {
  const spoken = history.filter((t) => t.role === "assistant");
  if (!spoken.length) return;
  const check = "Can you hear me clearly?";
  const value = String(text || "")
    .trim()
    .replace(/[’]/g, "'");
  const confirmed =
    /^(?:(?:yes|yeah|yep|sure|okay|ok)(?:[,!. ]+(?:I|you) can(?: hear(?: you)?)?)?|I can hear(?: you)?|(?:it(?:'s| is)|your voice is) clear now)[.! ,]*$/i.test(
      value,
    );

  const complaint =
    /\b(?:your|the) (?:voice|audio|sound|line)(?: is| keeps| sounds| seems)? (?:breaking(?: up)?|cutting(?: out)?|crackling|choppy|distorted|unclear|not clear|too (?:low|quiet))\b|\b(?:I )?(?:can(?:not|'t)|could(?: not|n't)) hear you\b|\byou(?:'re| are) (?:breaking up|cutting out)\b/i.test(
      value,
    );
  const recovery = "The audio may be cutting out. Is my voice clear now?";
  const repeatedRecovery =
    "It sounds like the audio is still unclear. Would you like to pause the conversation?";
  if (complaint)
    return spoken.some(
      (t) => t.content === recovery || t.content === repeatedRecovery,
    )
      ? repeatedRecovery
      : recovery;
  if ([recovery, repeatedRecovery].includes(spoken.at(-1).content)) {
    if (confirmed) {
      if (spoken.at(-1).content === repeatedRecovery)
        return "Of course, take your time.";
      // Resume only a pending question, never replay an introduction or sales pitch.
      const question = rememberQuestions(history).pendingQuestion;
      return question
        ? `Thank you. ${question}`
        : "Thank you for letting me know. We can continue when you're ready.";
    }
    if (
      /^(?:no|nope|not really|still (?:breaking|unclear|not clear))[.! ,]*$/i.test(
        value,
      )
    )
      return repeatedRecovery;
  }
  if (isAfterIntroduction(spoken) && isGreetingOnly(value)) return;
  // Greetings are routed by the session's unfinished step, never a stock presence reply.
  if (isPresenceCheck(text)) return;
  if (spoken.at(-1).content !== check) return;
  if (confirmed) {
    const question = rememberQuestions(history).pendingQuestion;
    return question && !/\bhow are you(?: today| doing)?\?/i.test(question)
      ? question
      : "Yes, I'm here.";
  }
  if (
    /^(?:no|nope|not really|I can(?:not|'t) hear you)[.! ,]*$/i.test(
      String(text).trim(),
    )
  )
    return "I'm sorry the audio isn't clear. Can you hear me now?";
}
// Only use verified spoken purpose text; arbitrary goals need the grounded model.
function scriptPurpose(config) {
  const script = String(config.script || "");
  if (
    /\b(?:verbatim|exact (?:opening|wording)|mandatory disclosure|read exactly)\b/i.test(
      script + " " + (config.instructions || ""),
    )
  )
    return;
  const explicit = script
    .match(/\b(?:I(?:'m| am)|M) calling\b[^.!?\n]{4,240}[.!]/i)?.[0]
    ?.replace(/^M calling/i, "I'm calling");
  if (explicit) return explicit;
  const goal = String(config.goal || "").trim();
  if (
    /^(?:review|discuss|check|confirm|schedule)\b/i.test(goal) &&
    goal.length < 180 &&
    !/[\n.!?]/.test(goal.replace(/[.!]+$/, ""))
  )
    return `I'm calling to ${goal[0].toLowerCase() + goal.slice(1).replace(/[.!]+$/, "")}.`;
}
function openingCourtesyReply(text, history, config = {}) {
  const spoken = history.filter((t) => t.role === "assistant");
  const value = String(text).trim();
  if (isAfterIntroduction(spoken)) return;
  if (spoken.length !== 1 || !/How are you today\?$/.test(spoken[0].content))
    return;
  // Complex questions, distress, refusals and time objections need a tailored answer.
  if (
    !/^(?:(?:hello|hi|hey)[,.! ]*)?(?:(?:I(?:'m| am) |doing |very )?(?:fine|good|great|well|okay|ok|not bad)(?: today)?[,.! ]*)?(?:(?:and |but )?(?:how are you(?: today| doing)?|how about you|what about you)[?!., ]*)?$|^(?:yes|yeah|okay|ok)[.! ]*$/i.test(
      value,
    ) ||
    !value
  )
    return;
  const purpose = scriptPurpose(config);
  if (!purpose) return;
  const reciprocal = /\b(?:how are you|how about you|what about you)\b/i.test(
    value,
  );
  return `${reciprocal ? "I'm doing well, thank you for asking. " : ""}${purpose}`;
}
function acknowledgmentReply(config, text, history, memory) {
  const spoken = history.filter((t) => t.role === "assistant");
  if (!spoken.length) return;
  const presenceConfirmation =
    /^(?:Are you still there|Can you hear me(?: clearly)?)\?$/i.test(spoken.at(-1).content) &&
    /^(?:(?:yes|yeah|yep)[,.! ]*)?(?:I(?:'m| am) (?:still )?here|I am|I can(?: hear you)?)[.!? ]*$/i.test(text.trim());
  if (!presenceConfirmation && !acknowledgment(text) && interruptionKind(text) !== "acknowledgment") return;
  if (presenceConfirmation && memory.pendingQuestion) return memory.pendingQuestion;
  const questions = mainQuestions(config.script);
  if (!questions.length) return;
  // Acknowledging an answer to a side question does not answer the pending script question.
  if (
    history.at(-1)?.role === "assistant" &&
    history.at(-2)?.role === "user" &&
    /\?\s*$/.test(history.at(-2).content) &&
    !/\?|\[interrupted\]/i.test(spoken.at(-1).content)
  ) {
    const { pendingQuestion } = rememberQuestions(history);
    const pending = questions.find((question) => key(question) === key(pendingQuestion || ""));
    if (pending) return pending;
  }
  const asked = spoken
    .filter((t) => !t.content.includes("[interrupted]"))
    .flatMap((t) => t.content.match(/[^.!?\n]+\?/g) || [])
    .map(key);
  if (
    isAfterIntroduction(spoken) ||
    (spoken.length === 1 && /How are you today\?$/.test(spoken[0].content))
  )
    return;
  const permission = /\b(?:may|can|could) I ask\b|\b(?:okay|good) time\b/i.test(
    spoken.at(-1).content,
  );
  const hasBranches =
    /\bif\s+(?:yes|no|both|unsure|the customer|customer|they)\b/i.test(
      config.script,
    );
  // Branching decisions stay with the grounded model; the initial permission
  // acknowledgment can still go directly to the first main question.
  if (hasBranches && !permission) return;
  const next = questions.find((q) => !asked.includes(key(q)));
  if (next) {
    const quoted = config.script.match(
      /["“](I(?:'m| am) calling[^.!?\n"”]{4,180}[.!?])/i,
    )?.[1];
    const goal = String(config.goal || "").trim();
    const purpose =
      spoken.length === 1
        ? quoted ||
          (/^(?:review|discuss|check|confirm|schedule)\b/i.test(goal) &&
          goal.length < 180
            ? `I'm calling to ${goal[0].toLowerCase() + goal.slice(1).replace(/[.!?]+$/, "")}.`
            : "")
        : "";
    return `${/^(?:hello|hi)/i.test(text) ? "Yes, I'm here." : "Thank you."} ${purpose ? purpose + " " : ""}${next}`;
  }
  const missing = questions.find(
    (q) =>
      !memory.completed.some((a) => key(a.question) === key(q)) &&
      asked.filter((x) => x === key(q)).length < 2,
  );
  if (missing)
    return `Before we finish, ${missing[0].toLowerCase() + missing.slice(1)}`;
}
const asksToWait = (text) =>
  !/\b(?:why|who|where|what|how|are you|do you)\b/i.test(String(text || "")) &&
  /^(?:(?:please|just|okay|ok|um|uh|yeah|yes|yep)[, ]+)*(?:(?:wait|hold on|hang on)(?:\b[^?]*)|(?:give me|just|one|a) (?:a |one )?(?:sec(?:ond)?|moment|minute)\b[^?]*)[.! ]*$/i.test(
    String(text || "").trim(),
  );
module.exports = {
  isPresenceCheck,
  hearingRecoveryIntent,
  asksCallingPurpose,
  scriptPurpose,
  audioCheckReply,
  openingCourtesyReply,
  asksToWait,
  interruptionKind,
  acknowledgmentReply,
  mainQuestions,
  key,
};

