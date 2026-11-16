"use strict";
const { isHarassment, explicitlyEndsCall } = require("./customer-conduct.cjs");
/** A direct voice-capability answer, not a claim about real feelings.
 * @param {string} customer
 * @returns {string|undefined}
 */
function expressionCapabilityReply(customer) {
  if (isHarassment(customer) || explicitlyEndsCall(customer)) return;
  const text = customer
    .toLowerCase()
    .replace(/[’]/g, "'")
    .trim()
    .slice(0, 16000);
  if (
    /\b(?:stop|not interested|no thanks|no thank you|don't call|do not call|remove me|leave me alone|end (?:the|this) call)\b/.test(
      text,
    )
  )
    return;
  if (
    /\b(?:regular|mathematical|algebraic|facial|face|coding|regex)\b|\b(?:human|real person|actually feel|real feelings)\b/.test(
      text,
    )
  )
    return;
  const sadDemo =
    /^(?:(?:please|can you|could you|would you)\s+)*(?:cry|sound sad|use a sad voice|show a sad expression)(?:\s+(?:please|for me|a little|now))*[.!?]*$/.test(
      text,
    );
  const surpriseDemo =
    /^(?:(?:please|can you|could you|would you)\s+)*(?:sound surprised|use a surprised voice|show surprise)(?:\s+(?:please|for me|now))*[.!?]*$/.test(
      text,
    );
  const calmDemo =
    /^(?:(?:please|can you|could you|would you)\s+)*(?:sound reassuring|use a reassuring voice|show reassurance)(?:\s+(?:please|for me|now))*[.!?]*$/.test(
      text,
    );
  if (sadDemo) return "I can use a softer, sad-sounding voice.";
  if (surpriseDemo) return "Oh, that is a surprise.";
  if (calmDemo) return "We can take this one step at a time.";
  if (
    /\b(?:sad|upset|died|death|funeral|passed away|crying|suicid\w*|kill myself|can't breathe|chest pain|emergency|don't laugh|do not laugh|no laughing|not funny)\b/.test(
      text,
    )
  )
    return;
  // Explicit demonstrations use the existing short acoustic laugh, never spoken tags.
  const demo =
    /^(?:(?:please|can you|could you|would you|will you)\s+)*(?:smile|laugh|chuckle)(?:\s+(?:please|for me|a little|naturally|now|to show me))*[.!?]*$/.test(
      text,
    ) ||
    /\b(?:show me (?:your |a )?(?:smile|laugh)|(?:smile|laugh|hans|hass|muskur[a-z]*)\s+(?:kar|kr|ker)\s*(?:ke|k)?\s*(?:dikhao|dikha[o]?|dikhayo))\b/.test(
      text,
    );
  if (demo) return "Yes, I can.";
  if (!/\bexpressions?\b/.test(text)) return;
  const roman =
    /\b(?:teray|tere|tera|terey|tumhare|tumharay|tumhary|tmhare|aapke|apke|aap|tum)\b/.test(
      text,
    ) && /\b(?:paas|pass|pas|hain|hay|hai|ho|kya|kia)\b/.test(text);
  if (roman) return "Yes, I do have expressions.";
  if (
    /\b(?:do|have|can|could|would|will|are)\s+you\b|\byou\s+(?:have|got)\s+(?:(?:any|some|voice)\s+){0,2}expressions?\b/.test(
      text,
    )
  )
    return "Yes, I do have expressions.";
}

/** @param {string} customer */
function isAiIdentityQuestion(customer) {
  const text = customer.replace(/[’]/g, "'").slice(0, 16000);
  return (
    /\b(?:are you|are u|r u|is this|you're|you are)\b.{0,55}\b(?:AI|artificial intelligence|human|real person|live person|bot|robot|automated)\b/i.test(
      text,
    ) ||
    /\bvirtual\b.{0,65}\b(?:AI|artificial intelligence)\b/i.test(text) ||
    /\bam I (?:talking|speaking)\b.{0,30}\b(?:AI|human|person|bot|robot)\b/i.test(
      text,
    ) ||
    (/\b(?:tum|aap|tu)\b/i.test(text) &&
      /\b(?:AI|human|insaan|robot)\b/i.test(text) &&
      /\b(?:ho|hai|hain|hay)\b/i.test(text))
  );
}
/** Only a casual, truthful AI admission can use the approved chuckle.
 * @param {string} customer
 * @param {string} reply
 */
function identityVoiceReply(customer, reply) {
  if (
    !isAiIdentityQuestion(customer) ||
    isHarassment(customer) ||
    explicitlyEndsCall(customer)
  )
    return false;
  if (
    /\b(?:stop|not interested|no thanks|don't call|do not call|leave me alone|sad|upset|angry|annoyed|worried|concerned|scared|serious|uncomfortable|creepy|died|death|passed away|funeral|crying|suicid\w*|kill myself|can't breathe|chest pain|emergency|don't laugh|do not laugh|no laughing|not funny)\b/i.test(
      customer,
    )
  )
    return false;
  const text = reply.replace(/[’]/g, "'");
  return (
    /\b(?:I'm|I am)\s+(?:an?\s+)?AI\b/i.test(text) &&
    !/\b(?:not (?:an? )?AI|human|real person)\b/i.test(text)
  );
}

/** Select only approved Lissa expressions using existing conversation text.
 * No LLM call, no spoken control tags, and no change for other voices.
 * @param {{voice:string, customerText?:string, enabled?:boolean, state?:{turn:number,lastTurn?:number,total?:number}}} options
 * @returns {(text:string)=>'neutral'|'laugh'|'sad'|'surprise'|'reassure'}
 */
function createEmotionSelector({
  voice,
  customerText = "",
  enabled = false,
  state = { turn: 0 },
}) {
  if (!enabled || voice !== "lissa" || !customerText.trim())
    return () => "neutral";
  state.turn++;
  const turn = state.turn;
  let used = false;
  const capability = expressionCapabilityReply(customerText);
  const customer = customerText
    .toLowerCase()
    .replace(/[’]/g, "'")
    .slice(0, 16000);
  const crisis =
    /\b(?:suicid\w*|kill myself|hurt myself|can't breathe|cannot breathe|chest pain|heart attack|bleeding badly|emergency)\b/.test(
      customer,
    );
  const negative =
    /\b(?:sad|upset|crying|griev\w*|died|death|passed away|funeral|cancer|terrified|afraid|lost my (?:mother|father|mum|mom|dad|wife|husband|child|job)|bad news|struggling|depressed|heartbroken)\b/.test(
      customer,
    );
  const needsReassurance =
    /\b(?:worried|anxious|nervous|confused|overwhelmed|unsure|don't understand|do not understand|not sure|not confident)\b/.test(
      customer,
    );
  const humour =
    /\b(?:ha(?:ha)+|lol|lmao|that's (?:really )?funny|that was funny|made me laugh|just kidding|only joking)\b/.test(
      customer,
    );
  const noLaugh =
    /\b(?:not funny|isn't funny|is not funny|don't laugh|do not laugh|no laughing)\b/.test(
      customer,
    );
  const unexpected =
    /\b(?:unexpected|surpris\w*|you won't believe|cannot believe|can't believe|didn't expect|wasn't expecting|suddenly)\b/.test(
      customer,
    );
  return (text) => {
    if (
      used ||
      crisis ||
      isHarassment(customerText) ||
      explicitlyEndsCall(customerText) ||
      /\b(?:angry|annoyed|furious|don't laugh|do not laugh|no laughing|not funny)\b/.test(
        customer,
      )
    )
      return "neutral";
    const requestedDemo =
      (capability !== undefined && text.trim() === capability) ||
      identityVoiceReply(customerText, text);
    if (
      !requestedDemo &&
      ((state.total || 0) >= 6 ||
        (state.lastTurn !== undefined && turn - state.lastTurn < 4))
    )
      return "neutral";
    const reply = text.toLowerCase().replace(/[’]/g, "'");
    let emotion = "neutral";
    if (requestedDemo)
      emotion = /\b(?:cry|sad)\b/.test(customer)
        ? "sad"
        : /\b(?:surprised|surprise)\b/.test(customer)
          ? "surprise"
          : /\b(?:reassuring|reassurance)\b/.test(customer)
            ? "reassure"
            : "laugh";
    else if (negative) {
      if (
        /\b(?:sorry|that sounds (?:hard|difficult|painful)|take your time|i'm listening|i understand)\b/.test(
          reply,
        )
      )
        emotion = "sad";
    } else if (needsReassurance) {
      if (
        /\b(?:i understand|take (?:this|it) (?:one )?step|one step at a time|no rush|take your time|work through (?:this|it) together|we can go slowly)\b/.test(
          reply,
        )
      )
        emotion = "reassure";
    } else if (
      humour &&
      !noLaugh &&
      /\b(?:funny|made me (?:smile|laugh)|good one|that (?:is|was|really is) (?:amusing|hilarious))\b/.test(
        reply,
      )
    )
      emotion = "laugh";
    else if (
      unexpected &&
      /\b(?:oh[, ]+really|wasn't expecting|didn't expect|unexpected|quite a surprise|really\?)\b/.test(
        reply,
      )
    )
      emotion = "surprise";
    if (emotion !== "neutral") {
      used = true;
      state.lastTurn = turn;
      state.total = (state.total || 0) + 1;
    }
    return /** @type {'neutral'|'laugh'|'sad'|'surprise'|'reassure'} */ (
      emotion
    );
  };
}
module.exports = {
  createEmotionSelector,
  expressionCapabilityReply,
  isAiIdentityQuestion,
  identityVoiceReply,
};
