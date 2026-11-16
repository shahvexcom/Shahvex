import { cookies } from "next/headers";
import { z } from "zod";
import { readSession, SESSION_COOKIE } from "@/lib/session";
import { db } from "@/lib/database";
import { decryptCredential } from "@/lib/credential-crypto";

const requestSchema = z.object({
  text: z.string().trim().min(1, "Write some text to preview.").max(200, "Groq voice previews support up to 200 characters."),
  language: z.string().min(2).max(80),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  accent: z.enum(["Natural", "Professional", "Deep", "Warm", "Conversational", "Calm"]).optional(),
});

const voices = {
  english: { MALE: "troy", FEMALE: "hannah", OTHER: "autumn" },
  arabic: { MALE: "fahad", FEMALE: "noura", OTHER: "aisha" },
} as const;

export async function POST(request: Request) {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Invalid voice request." }, { status: 400 });
  const credentialResult = await (await db()).query("SELECT c.secret_ciphertext,c.config FROM agent_credentials ac JOIN ai_credentials c ON c.id=ac.credential_id WHERE ac.agent_id=$1 AND ac.provider='GROQ' LIMIT 1", [session.agentId]);
  if (!credentialResult.rows[0]) return Response.json({ message: "No Groq credential has been assigned to your agent. Ask an admin to assign one." }, { status: 403 });
  let groqApiKey: string;
  try { groqApiKey = decryptCredential(credentialResult.rows[0].secret_ciphertext); } catch { return Response.json({ message: "The saved Groq credential could not be decrypted. Ask an admin to update it." }, { status: 503 }); }
  const { text, language, gender, accent } = parsed.data;
  const isArabic = language === "Arabic";
  const directions: Record<string, string> = { Professional: "[professionally] ", Deep: "[confidently] ", Warm: "[warmly] ", Conversational: "[casually] ", Calm: "[calmly] ", Natural: "" };
  const previewText = !isArabic ? `${directions[accent || "Natural"]}${text}` : text;
  const configuredModel = credentialResult.rows[0].config?.ttsModel;
  const ttsModel = configuredModel?.startsWith("canopylabs/") ? configuredModel : (isArabic ? "canopylabs/orpheus-arabic-saudi" : "canopylabs/orpheus-v1-english");
  const response = await fetch("https://api.groq.com/openai/v1/audio/speech", { method: "POST", headers: { Authorization: `Bearer ${groqApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: ttsModel, voice: voices[isArabic ? "arabic" : "english"][gender], input: previewText, response_format: "wav", speed: 1.25 }) });
  if (!response.ok) {
    const raw = await response.text();
    let message = "Groq could not generate this voice preview.";
    try { const body = JSON.parse(raw) as { error?: { message?: string }; message?: string }; message = body.error?.message || body.message || message; } catch { if (raw) message = raw.slice(0, 300); }
    return Response.json({ message }, { status: response.status });
  }
  const audio = await response.arrayBuffer();
  if (audio.byteLength < 44) return Response.json({ message: "Groq returned an incomplete audio file. Please generate again." }, { status: 502 });
  return new Response(audio, { headers: { "Content-Type": "audio/wav", "Content-Length": String(audio.byteLength), "Content-Disposition": "inline; filename=agent-voice-preview.wav", "Cache-Control": "no-store, no-transform", "Accept-Ranges": "bytes" } });
}
