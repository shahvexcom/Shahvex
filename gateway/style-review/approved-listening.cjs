'use strict';
// Generic texts approved for demonstration only. Never campaign instructions.
const disclosure='I am Jennifer, an automated assistant.';
const pairs=[
  ['neutral','What can you explain?',`${disclosure} What would you like to know?`,`${disclosure} What would you like to know?`],
  ['friendly','Hi Jennifer, nice to speak with you.',`${disclosure} How can I help?`,`Hello, ${disclosure} How can I help?`],
  ['hesitant',"I'm not sure I understand. Can you explain?",`${disclosure} Which part would you like me to explain?`,`${disclosure} We can take this step by step. Which part would you like me to explain?`],
  ['concerned',"I'm worried about this.",`${disclosure} What is your main concern?`,`${disclosure} Thank you for telling me. What is your main concern?`],
  ['serious','Before continuing, I need clarification.',`${disclosure} What would you like clarified before we continue?`,`${disclosure} Please tell me what you would like clarified before we continue.`]
].map(([scenario,customer,baseline,styleAware])=>({scenario,customer,baseline,styleAware}));
module.exports={disclosure,pairs};
