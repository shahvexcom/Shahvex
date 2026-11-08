import { randomUUID } from "node:crypto";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { requireApprovedBpo } from "@/lib/bpo-session";
import { db } from "@/lib/database";
import { backfillBpoRecordingSizes, getBpoStorageSummary } from "@/lib/bpo-storage";
import { sendMail } from "@/lib/email";
import { bpoFilesUploadedEmail } from "@/lib/email-templates";

export const runtime = "nodejs";
const MAX_SIZE = 5 * 1024 * 1024;
const cell = (value: unknown) => String(value ?? "").trim();
const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function csv(text: string) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const delimiter = lines[0]?.includes("\t") ? "\t" : ",";
  const parseLine = (line: string) => line.split(delimiter).map(value => value.trim().replace(/^"|"$/g, ""));
  return { headers: parseLine(lines[0] || "Lead"), rows: lines.slice(1, 1001).map(parseLine) };
}

async function parse(file: File, script = false) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const book = XLSX.read(bytes, { type: "buffer" });
    const sheet = book.Sheets[book.SheetNames[0]];
    const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }) as unknown[][];
    return {
      text: values.map(row => row.map(cell).join(" | ")).join("\n"),
      headers: (values[0] || []).map(cell),
      rows: values.slice(1, 1001).map(row => row.map(cell)),
    };
  }
  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: bytes });
    return { text: result.value.trim(), headers: ["Script"], rows: result.value.split(/\r?\n/).filter(Boolean).map(line => [line]) };
  }
  if (name.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      return { text: result.text.trim(), headers: ["Script"], rows: result.text.split(/\r?\n/).filter(Boolean).map(line => [line]) };
    } finally {
      await parser.destroy();
    }
  }
  const text = bytes.toString("utf8");
  return script ? { text, headers: ["Script"], rows: text.split(/\r?\n/).filter(Boolean).map(line => [line]) } : { text, ...csv(text) };
}

function scriptTasks(text: string) {
  const rules = [
    [/full name|first name|last name|surname/i, "Customer name"],
    [/e[- ]?mail/i, "Email address"],
    [/date of birth|\bdob\b/i, "Date of birth"],
    [/phone|mobile|telephone|contact number/i, "Phone number"],
    [/address|postcode|post code/i, "Address"],
    [/company|business|organisation|organization/i, "Company details"],
  ] as const;
  return rules.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

export async function GET() {
  const current = await requireApprovedBpo();
  if (!current) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const client = await db();
  await backfillBpoRecordingSizes(client, current.agentId);
  const [result, storage] = await Promise.all([
    client.query("SELECT id,lead_file_name,script_file_name,lead_file_type,script_file_type,lead_headers,lead_rows,script_text,lead_file_size,script_file_size,created_at FROM script_assignments WHERE agent_id=$1 ORDER BY created_at DESC", [current.agentId]),
    getBpoStorageSummary(client, current.agentId),
  ]);
  const assignments = result.rows.map(row => ({
    ...row,
    script_file_size: Number(row.script_file_size || 0) || Buffer.byteLength(String(row.script_text || ""), "utf8"),
    lead_file_size: Number(row.lead_file_size || 0) || Buffer.byteLength(JSON.stringify(row.lead_rows || []), "utf8"),
    lead_headers: scriptTasks(String(row.script_text || "")),
  }));
  return Response.json({
    assignments,
    storageUsedBytes: storage.usedBytes,
    storageLimitBytes: storage.limitBytes,
    storageRemainingBytes: storage.remainingBytes,
    scriptStorageBytes: storage.scriptBytes,
    recordingStorageBytes: storage.recordingBytes,
    hasActivePlan: storage.hasActivePlan,
    canUpload: storage.hasActivePlan && storage.usedBytes < storage.limitBytes,
  });
}

export async function POST(request: Request) {
  const current = await requireApprovedBpo();
  if (!current) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  try {
    const form = await request.formData();
    const script = form.get("script");
    const leads = form.get("leads");
    if (!(script instanceof File) || !(leads instanceof File)) return Response.json({ message: "Upload both an agent script and leads sheet." }, { status: 400 });
    if (script.size > MAX_SIZE || leads.size > MAX_SIZE) return Response.json({ message: "Each file must be 5MB or smaller." }, { status: 400 });

    const client = await db();
    const storage = await getBpoStorageSummary(client, current.agentId);
    const incomingBytes = script.size + leads.size;
    if (!storage.hasActivePlan) return Response.json({ message: "Buy a plan before uploading workspace files." }, { status: 403 });
    if (storage.usedBytes + incomingBytes > storage.limitBytes) {
      const shortfall = storage.usedBytes + incomingBytes - storage.limitBytes;
      return Response.json({ message: `Not enough storage. Free ${formatSize(shortfall)} or choose a plan with more storage.` }, { status: 413 });
    }
    const parsedScript = await parse(script, true);
    const parsedLeads = await parse(leads);
    await client.query(
      "INSERT INTO script_assignments (id,agent_id,lead_file_name,script_file_name,lead_file_type,script_file_type,lead_headers,lead_rows,script_text,lead_file_size,script_file_size,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$2)",
      [randomUUID(), current.agentId, leads.name, script.name, leads.name.split(".").pop()?.toUpperCase() || "FILE", script.name.split(".").pop()?.toUpperCase() || "FILE", JSON.stringify(parsedLeads.headers), JSON.stringify(parsedLeads.rows), parsedScript.text.slice(0, 100000), leads.size, script.size],
    );

    const profile = await client.query("SELECT name,email FROM agents WHERE id=$1", [current.agentId]);
    if (profile.rows[0]?.email) {
      const fileDetails = (file: File) => ({
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        format: file.name.split(".").pop()?.toUpperCase() || "FILE",
      });
      const emailContent = bpoFilesUploadedEmail({
        name: profile.rows[0].name,
        script: fileDetails(script),
        leads: fileDetails(leads),
        uploadedAt: new Date(),
      });
      try {
        await sendMail(profile.rows[0].email, emailContent.subject, emailContent.text, emailContent.html);
      } catch (mailError) {
        console.error("BPO upload email error:", mailError);
      }
    }
    return Response.json({ message: "Script and leads uploaded successfully." }, { status: 201 });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "Upload failed." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const current = await requireApprovedBpo();
  if (!current) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ message: "File assignment is required." }, { status: 400 });
  const result = await (await db()).query("DELETE FROM script_assignments WHERE id=$1 AND agent_id=$2 RETURNING id", [id, current.agentId]);
  return result.rowCount
    ? Response.json({ message: "Files deleted successfully." })
    : Response.json({ message: "File not found." }, { status: 404 });
}
