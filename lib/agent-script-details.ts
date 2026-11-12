import { z } from "zod";
import type { TestConfig } from './agent-test';
export const conversationStyles = ["Professional", "Friendly", "Warm & Empathetic", "Casual", "Confident", "Consultative", "Persuasive", "Calm & Patient"] as const;
const excerpts = z.array(z.string().trim().min(1).max(4000)).max(24);
export const scriptDetailsSchema = z.object({ instructions: excerpts, goals: excerpts, tasks: excerpts, knowledge: excerpts, faqs: excerpts, conversationFlow: excerpts, restrictions: excerpts }).strict();
export type ScriptDetails = z.infer<typeof scriptDetailsSchema>;
/** Identical script-to-conversation setup for the tester and VICIdial calls. */
export function scriptTestConfig(profile:Pick<TestConfig,'name'|'voice'|'first'|'script'|'style'>,details:ScriptDetails):TestConfig {
  return {...profile,
    goal:details.goals.join('\n'),task:details.tasks.join('\n'),
    instructions:[...details.instructions,...details.conversationFlow,...details.restrictions].join('\n'),
    knowledge:[...details.knowledge,...details.faqs].join('\n'),
    style:conversationStyles.includes(profile.style as typeof conversationStyles[number])?profile.style:'Professional',
  };
}
export const detailLabels = { instructions: "Instructions", goals: "Goals", tasks: "Tasks", knowledge: "Knowledge", faqs: "FAQs", conversationFlow: "Conversation Flow", restrictions: "Restrictions" } as const;
export function emptyScriptDetails(): ScriptDetails { return { instructions: [], goals: [], tasks: [], knowledge: [], faqs: [], conversationFlow: [], restrictions: [] }; }
export function groundedDetails(script: string, value: unknown): ScriptDetails {
  const parsed = scriptDetailsSchema.parse(value), normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase(), source = normalize(script);
  // Only source-verifiable excerpts survive. No invented summaries become facts.
  for (const key of Object.keys(parsed) as (keyof ScriptDetails)[]) parsed[key] = [...new Set(parsed[key])].filter(text => source.includes(normalize(text)));
  return parsed;
}
