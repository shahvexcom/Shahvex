"use strict";
const smokingReply = "No, I don't smoke. Smoking damages the lungs and raises lung cancer risk, so I'd encourage getting support to quit.";
const drinkingReply = "No, I don't drink alcohol. It can harm the liver and raise cancer risk, so drinking less or avoiding it is safer.";
const nicotineReply = "No, I don't use nicotine. It's addictive, and if you're thinking about quitting tobacco, support can help.";
const marriageReply = "Oh, good question. I don't have a spouse, but I appreciate you asking.";
const familyReply = "Thanks for asking. I don't have a family or a personal life of my own.";
const ageReply = "That's a fair question. I don't have a human age.";
const hobbiesReply = "Oh, I don't have hobbies of my own, but I do appreciate a little conversation.";
const sympathyReply = "I'm sorry to hear that. Take your time.";
const medicalFallback = "I can't advise on your individual health. A healthcare professional can help you with that.";
const preparedSideReplies = [smokingReply, drinkingReply, nicotineReply, marriageReply, familyReply, ageReply, hobbiesReply, sympathyReply, medicalFallback];

function personalSideReply(value) {
  const text = String(value || '').replace(/[’]/g, "'");
  if (/\b(?:are you (?:married|single|divorced)|did you (?:ever )?(?:get married|marry)|when did you get married|do you have (?:a )?(?:spouse|husband|wife|partner)|what is your marital status|what's your marital status)\b/i.test(text))
    return marriageReply;
  if (/\b(?:do you have (?:any )?(?:children|kids|a family)|have you got (?:any )?(?:children|kids))\b/i.test(text))
    return familyReply;
  if (/\b(?:how old are you|what(?:'s| is) your age)\b/i.test(text))
    return ageReply;
  if (/\b(?:what do you do for fun|what (?:are|about) your hobbies|do you have (?:any )?hobbies)\b/i.test(text))
    return hobbiesReply;
  if (!/\?/.test(text) && /\bmy (?:father|mother|dad|mom|wife|husband|partner|son|daughter|friend) (?:just |recently )?(?:died|passed away)\b/i.test(text))
    return sympathyReply;
}

/** General facts only; no invented personal history or individualized health advice. */
function healthSideTopic(value) {
  const text = String(value || "").trim();
  if (/\b(?:are you (?:(?:a )?drunk|intoxicated|drinking(?: alcohol)?)|you are drinking|have you been drinking|(?:do|did) you drink(?: alcohol)?|why (?:don't|do not) you drink)\b/i.test(text))
    return {answer:drinkingReply,meal:false};
  if (/\b(?:are you (?:getting|using|taking|on)|you are (?:getting|using|taking|on)|(?:do|did) you (?:get|use|take)|why (?:don't|do not) you use) nicotine\b/i.test(text))
    return {answer:nicotineReply,meal:false};
  if (/\b(?:(?:do|did) you smoke|are you (?:a )?smoker|are you smoking|you are smoking|have you been smoking|why (?:don't|do not) you smoke)\b/i.test(text))
    return {answer:smokingReply,meal:false};
  if (/\bI(?:'m| am) smoking\b/i.test(text))
    return { answer: "Smoking can harm your lungs.", meal: false };
  if (
    /\b(?:I(?:'m| am) (?:eating|having (?:my )?(?:breakfast|lunch|dinner))|I(?:'m| am) (?:at|in the middle of) (?:breakfast|lunch|dinner))\b/i.test(
      text,
    )
  )
    return { answer: "Please take your time with your meal.", meal: true };
  if (
    /\b(?:did|have|do|are) you\b[^?]{0,35}\b(?:eat|eaten|eating|breakfast|lunch|dinner)\b/i.test(
      text,
    )
  )
    return {
      answer:
        "I don't eat meals, but I can give you a moment if you're eating.",
      meal: true,
    };
  if (
    /\b(?:is|can|does)\b[^?]{0,55}\b(?:breakfast|lunch|dinner)\b[^?]{0,50}\b(?:healthy|good|health)\b|\b(?:is|can)\b[^?]{0,35}\b(?:healthy|good)\b[^?]{0,30}\b(?:breakfast|lunch|dinner)\b/i.test(
      text,
    )
  )
    return {
      answer:
        "A balanced meal can be part of a healthy routine; what suits you depends on your needs.",
      meal: false,
    };
  return null;
}
function isGeneralHealthQuestion(value) {
  const text = String(value || "");
  return (
    /\b(?:alcohol|drunk|smoking|tobacco|nicotine|vaping|nutrition|diet|exercise|eat|eaten|eating|food|meal|breakfast|lunch|dinner|blood pressure|cough|cancer|lungs?|liver|medicine|medication|healthy)\b/i.test(
      text,
    ) &&
    !/\b(?:medicare|medicaid|coverage|rebate|refund|eligib\w*|plan|specialist|transfer|connect)\b/i.test(
      text,
    ) &&
    /\?|^(?:what|why|how|is|are|can|could|do|does|should)\b/i.test(text.trim())
  );
}
const GENERAL_HEALTH_RULES =
  "Answer the customer's actual side question briefly and accurately in one or two sentences. Do not automatically agree: say yes only when supported. Do not invent drinking, smoking, eating, breakfast or other personal experiences. Never infer the customer's meal or local time from the server clock. Alcohol can harm the liver and increases the risk of several cancers; do not describe it as mainly a lung-damage issue. Smoking harms the lungs. A balanced meal may fit a healthy routine; breakfast is not universally required for everyone. Do not diagnose, prescribe or promise health benefits. For an unknown or individual medical issue, state the uncertainty and direct them to an appropriate clinician. Do not repeat the call pitch or ask a follow-up question; the server resumes the pending call step.";
module.exports = {
  healthSideTopic,
  personalSideReply,
  medicalFallback,
  preparedSideReplies,
  isGeneralHealthQuestion,
  GENERAL_HEALTH_RULES,
};
