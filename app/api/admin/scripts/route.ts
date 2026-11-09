import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { z } from "zod";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";

export const runtime = "nodejs";
cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
const assignmentSchema = z.object({ agentId: z.string().min(1).optional(), agentIds: z.array(z.string().min(1)).min(1).max(100).optional(), leadFileName: z.string().min(1).max(255), scriptFileName: z.string().min(1).max(255), leadFileUrl: z.string().url().optional(), leadFileType: z.string().max(30).optional(), scriptFileUrl: z.string().url().optional(), scriptFileType: z.string().max(30).optional(), headers: z.array(z.string().max(200)).min(1).max(100), rows: z.array(z.array(z.string().max(5000)).max(100)).max(1000), scriptText: z.string().min(1).max(100000) }).refine(data => !!data.agentId || !!data.agentIds?.length, { message: "Select at least one agent." });

async function admin() { const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value); return session?.role === "ADMIN" ? session : null; }
const cells = (value: unknown) => String(value ?? "").trim();
function tableFromText(text: string) { const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean); const delimiter = lines[0]?.includes("\t") ? "\t" : lines[0]?.includes(",") ? "," : ""; if (!delimiter) return { headers: ["Data"], rows: lines.slice(0, 1000).map(x => [x]) }; const parse = (line: string) => line.split(delimiter).map(x => x.trim().replace(/^"|"$/g, "")); return { headers: parse(lines[0]).filter(Boolean), rows: lines.slice(1, 1001).map(parse) }; }

async function extract(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer()), name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) { const book = XLSX.read(bytes, { type: "buffer" }), sheet = book.Sheets[book.SheetNames[0]], values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }) as unknown[][]; return { text: values.map(row => row.map(cells).join(" | ")).join("\n"), headers: (values[0] ?? []).map(cells).filter(Boolean), rows: values.slice(1, 1001).map(row => row.map(cells)) }; }
  if (name.endsWith(".docx")) { const result = await mammoth.extractRawText({ buffer: bytes }); const table = tableFromText(result.value); return { text: result.value.trim(), ...table }; }
  if (name.endsWith(".pdf")) { const { PDFParse } = await import("pdf-parse"); const parser = new PDFParse({ data: bytes }); try { const result = await parser.getText(); const table = tableFromText(result.text); return { text: result.text.trim(), ...table }; } finally { await parser.destroy(); } }
  if (name.endsWith(".txt") || name.endsWith(".md")) { const text = bytes.toString("utf8"); return { text, ...tableFromText(text) }; }
  throw new Error("Please upload a PDF, DOCX, XLSX, XLS, CSV, TXT or MD file.");
}
async function storeOriginal(file: File) {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) throw new Error("Cloudinary is not configured. Add the Cloudinary environment variables in Vercel.");
  const bytes = Buffer.from(await file.arrayBuffer()), extension = path.extname(file.name).replace(".", "").toUpperCase() || "FILE";
  const upload = await new Promise<{ secure_url: string }>((resolve, reject) => cloudinary.uploader.upload_stream({ folder: "max7-ai/script-files", public_id: randomUUID(), resource_type: "raw", filename_override: path.basename(file.name) }, (error, result) => error || !result ? reject(error || new Error("Cloudinary upload failed.")) : resolve(result)).end(bytes));
  return { fileUrl: upload.secure_url, fileType: extension };
}

async function duplicateLead(client: Awaited<ReturnType<typeof db>>, headers: string[], rows: string[][], excludeId?: string) {
  const result = await client.query("SELECT s.lead_file_name,a.name FROM script_assignments s JOIN agents a ON a.id=s.agent_id WHERE s.lead_headers=$1::jsonb AND s.lead_rows=$2::jsonb AND ($3::text IS NULL OR s.id<>$3) AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=s.agent_id) LIMIT 1", [JSON.stringify(headers), JSON.stringify(rows), excludeId ?? null]);
  return result.rows[0] as { lead_file_name: string; name: string } | undefined;
}

export async function GET() { if (!await admin()) return Response.json({ message: "Unauthenticated" }, { status: 401 }); const result = await (await db()).query("SELECT s.id,s.agent_id,a.name agent_name,COALESCE(a.avatar_url,'') agent_avatar,s.lead_file_name,s.script_file_name,s.lead_headers,s.lead_rows,s.script_text,s.created_at FROM script_assignments s JOIN agents a ON a.id=s.agent_id WHERE NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=s.agent_id) ORDER BY s.created_at DESC"); return Response.json({ assignments: result.rows }); }
export async function POST(request: Request) {
  try {
    const session = await admin(); if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) { const file = (await request.formData()).get("file"); if (!(file instanceof File) || file.size > 15 * 1024 * 1024) return Response.json({ message: "Choose a supported file up to 15 MB." }, { status: 400 }); const original = await storeOriginal(file); return Response.json({ fileName: file.name, ...original, ...(await extract(file)) }); }
    const parsed = assignmentSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message ?? "Complete both uploads and select an agent." }, { status: 400 });
    const data = parsed.data, client = await db(), agentIds = [...new Set(data.agentIds ?? (data.agentId ? [data.agentId] : []))]; const agent = await client.query("SELECT id FROM agents a WHERE id=ANY($1::text[]) AND role='AGENT' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)", [agentIds]); if (agent.rows.length !== agentIds.length) return Response.json({ message: "One or more selected agents were not found." }, { status: 404 }); const existingLead = await duplicateLead(client, data.headers, data.rows); if (existingLead) return Response.json({ message: `This lead sheet is already assigned to ${existingLead.name} (${existingLead.lead_file_name}). Use a new lead sheet instead.` }, { status: 409 });
    await Promise.all(agentIds.map(agentId => client.query("INSERT INTO script_assignments (id,agent_id,lead_file_name,script_file_name,lead_file_url,lead_file_type,script_file_url,script_file_type,lead_headers,lead_rows,script_text,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)", [randomUUID(), agentId, data.leadFileName, data.scriptFileName, data.leadFileUrl ?? "", data.leadFileType ?? path.extname(data.leadFileName).replace(".", "").toUpperCase(), data.scriptFileUrl ?? "", data.scriptFileType ?? path.extname(data.scriptFileName).replace(".", "").toUpperCase(), JSON.stringify(data.headers), JSON.stringify(data.rows), data.scriptText, session.agentId])));
    await client.query("UPDATE agents SET agent_script=$1,updated_at=NOW() WHERE id=ANY($2::text[])",[data.scriptText,agentIds]);
    return Response.json({ message: `Lead sheet and script assigned to ${agentIds.length} agent(s).` }, { status: 201 });
  } catch (error) { console.error("Scripts upload failed", error); return Response.json({ message: error instanceof Error ? error.message : "Upload failed on the server. Check Vercel environment variables." }, { status: 500 }); }
}
export async function PATCH(request: Request) {
  if (!await admin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const body = await request.json().catch(() => null), id = typeof body?.id === "string" ? body.id : "";
  const parsed = assignmentSchema.safeParse(body); if (!id || !parsed.success) return Response.json({ message: parsed.error?.issues[0]?.message ?? "Invalid assignment details." }, { status: 400 });
  const data = parsed.data, agentIds = [...new Set(data.agentIds ?? (data.agentId ? [data.agentId] : []))];
  if (agentIds.length !== 1) return Response.json({ message: "Select one regular agent." }, { status: 400 });
  const client = await db();
  const agent = await client.query("SELECT id FROM agents a WHERE id=$1 AND role='AGENT' AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)", [agentIds[0]]);
  if (!agent.rows[0]) return Response.json({ message: "Agent not found." }, { status: 404 });
  const existingLead = await duplicateLead(client, data.headers, data.rows, id); if (existingLead) return Response.json({ message: `This lead sheet is already assigned to ${existingLead.name} (${existingLead.lead_file_name}). Use a new lead sheet instead.` }, { status: 409 });
  const result = await client.query("UPDATE script_assignments s SET agent_id=$1,lead_file_name=$2,script_file_name=$3,lead_file_url=COALESCE(NULLIF($4,''),lead_file_url),lead_file_type=COALESCE(NULLIF($5,''),lead_file_type),script_file_url=COALESCE(NULLIF($6,''),script_file_url),script_file_type=COALESCE(NULLIF($7,''),script_file_type),lead_headers=$8::jsonb,lead_rows=$9::jsonb,script_text=$10 WHERE id=$11 AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=s.agent_id) RETURNING id", [agentIds[0], data.leadFileName, data.scriptFileName, data.leadFileUrl ?? "", data.leadFileType ?? "", data.scriptFileUrl ?? "", data.scriptFileType ?? "", JSON.stringify(data.headers), JSON.stringify(data.rows), data.scriptText, id]);
  if(result.rows[0])await client.query("UPDATE agents SET agent_script=$1,updated_at=NOW() WHERE id=$2",[data.scriptText,agentIds[0]]);
  return result.rows[0] ? Response.json({ message: "Assigned sheets updated." }) : Response.json({ message: "Assignment not found." }, { status: 404 });
}
export async function DELETE(request: Request) { if (!await admin()) return Response.json({ message: "Unauthenticated" }, { status: 401 }); const id = new URL(request.url).searchParams.get("id"); if (!id) return Response.json({ message: "Assignment ID is required." }, { status: 400 }); const result = await (await db()).query("DELETE FROM script_assignments s WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=s.agent_id) RETURNING id,agent_id", [id]); if(result.rows[0])await (await db()).query("UPDATE agents SET agent_script=COALESCE((SELECT script_text FROM script_assignments WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 1),''),updated_at=NOW() WHERE id=$1",[result.rows[0].agent_id]); return result.rows[0] ? Response.json({ message: "Assignment deleted." }) : Response.json({ message: "Assignment not found." }, { status: 404 }); }
