"use strict";
/** General facts only; no invented meals, drinking history, diagnosis or customer location. */
function healthSideTopic(value) {
  const text = String(value || "").trim();
  if (
    /\b(?:are you (?:drunk|intoxicated)|have you been drinking|do you drink(?: alcohol)?|did you drink(?: alcohol)?)\b/i.test(
      text,
    )
  )
    return {
      answer:
        "No, I don't drink alcohol. Alcohol can harm the liver and increase the risk of some cancers.",
      meal: false,
    };
  if (/\b(?:do you smoke|are you (?:a )?smoker|are you smoking)\b/i.test(text))
    return {
      answer:
        "No, I don't smoke. Smoking harms the lungs and increases the risk of lung cancer.",
      meal: false,
    };
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
    /\b(?:alcohol|drunk|smoking|tobacco|nutrition|diet|exercise|eat|eaten|eating|food|meal|breakfast|lunch|dinner|blood pressure|cough|cancer|lungs?|liver|medicine|medication|healthy)\b/i.test(
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
  isGeneralHealthQuestion,
  GENERAL_HEALTH_RULES,
};
