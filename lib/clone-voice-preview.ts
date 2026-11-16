import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { savedVoiceCatalog } from "./local-voice-registry";

const files = new Map<string, Promise<Uint8Array>>();
/** Preview the approved recording immediately; never queue a new model job. */
export async function cloneVoicePreview(owner: string, voice: string): Promise<Response | undefined> {
  if (voice !== "emma" && voice !== "olivia") return;
  const catalog = await savedVoiceCatalog(owner);
  if (!catalog.voices.some(item => item.id === voice)) return;
  let pending = files.get(voice);
  if (!pending) {
    pending = readFile(path.join(process.cwd(), ".data", "voice-previews", `${voice}.wav`)).then(audio => {
      if (audio.length < 44 || audio.length > 2_000_000 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") throw Error("Invalid saved preview");
      return new Uint8Array(audio);
    });
    files.set(voice, pending);
  }
  try {
    return new Response(new Uint8Array(await pending), { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, no-store" } });
  } catch {
    files.delete(voice);
    return;
  }
}
