import { z } from "zod";

export const vicidialLiveConfig = z.object({
  enabled: z.boolean().default(false),
  listId: z.string().regex(/^\d{2,14}$/).or(z.literal("")).default(""),
  phoneCode: z.string().regex(/^[1-9]\d{0,3}$/).default("1"),
  remoteUsers: z.array(z.string().regex(/^[\w-]{2,20}$/)).max(1000).default([]),
  transferInGroup: z.string().regex(/^[\w-]{2,20}$/).or(z.literal("")).default(""),
  bridgeUrl: z.string().url().or(z.literal("")).default(""),
  recordingBaseUrl: z.string().url().or(z.literal("")).default(""),
  recordingUsername: z.string().max(100).default(""),
  recordingEnabled: z.boolean().default(true),
}).strict();
export type VicidialLiveConfig = z.infer<typeof vicidialLiveConfig>;
export function missingVicidialSetup(value: unknown, hasBridgeSecret: boolean) {
  const parsed = vicidialLiveConfig.safeParse(value);
  if (!parsed.success) return ["Valid live calling settings"];
  const c = parsed.data, missing: string[] = [];
  if (!c.enabled) missing.push("Enable VICIdial live calling");
  if (!c.remoteUsers.length) missing.push("Remote agent users");
  if (new Set(c.remoteUsers).size !== c.remoteUsers.length) missing.push("Unique remote agent users");
  if (!c.transferInGroup) missing.push("Human transfer in-group");
  if (!c.bridgeUrl) missing.push("Audio bridge HTTPS URL");
  if (!hasBridgeSecret) missing.push("Audio bridge shared secret");
  if (!c.recordingEnabled) missing.push("Campaign recording enabled in VICIdial");
  return missing;
}
