import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { z } from "zod";
import { bpoEntitlements } from "@/lib/bpo-entitlements";
import { db } from "@/lib/database";
import { requireApprovedBpo } from "@/lib/bpo-session";

const agentFormSchema = z.object({
  name: z.string().trim().min(2).max(80),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  voiceId: z.string().uuid(),
  scriptId: z.string().uuid(),
  leadSheetId: z.string().uuid(),
  dialingMode: z.enum(["AUTO", "MANUAL", "BOTH"]),
  avatarUrl: z.string().url().max(500).optional().or(z.literal("")),
});
const createSchema = agentFormSchema;
const activitySchema = z.object({ action: z.literal("activity"), agentId: z.string().uuid(), isActive: z.boolean() });
const editSchema = agentFormSchema.extend({ action: z.literal("edit"), agentId: z.string().uuid() });

const agentFields = `a.id,a.name,a.gender,a.accent,a.status,a.created_at,COALESCE(a.avatar_url,'') avatar_url,
  b.voice_id,b.voice_name,b.source_script_id,b.script_name,b.source_lead_id,b.lead_file_name,b.is_active,b.dialing_mode,
  COALESCE(v.status,'INACTIVE') voice_status,
  tc.label telnyx_label,gc.label groq_label,
  COALESCE((SELECT COUNT(*)::int FROM agent_calls c WHERE c.agent_id=a.id AND c.call_type IN ('LEAD','QUICK_DIAL')),0) calls_total,
  COALESCE((SELECT COUNT(DISTINCT c.lead_number)::int FROM agent_calls c WHERE c.agent_id=a.id AND c.call_type IN ('LEAD','QUICK_DIAL') AND c.status='COMPLETED' AND c.lead_number<>''),0) leads_completed,
  COALESCE((SELECT jsonb_array_length(s.lead_rows) FROM script_assignments s WHERE s.agent_id=a.id ORDER BY s.created_at DESC LIMIT 1),0) leads_total,
  COALESCE((SELECT s.script_text FROM script_assignments s WHERE s.agent_id=a.id ORDER BY s.created_at DESC LIMIT 1),'') script_text,
  COALESCE((SELECT LEFT(string_agg(CONCAT_WS(' ',c.summary,c.notes),' '),12000) FROM agent_calls c WHERE c.agent_id=a.id AND c.status='COMPLETED'),'') task_evidence,
  COALESCE((SELECT LEFT(string_agg(c.transcript,E'\\n'),12000) FROM agent_calls c WHERE c.agent_id=a.id AND c.status='COMPLETED'),'') customer_transcripts`;

function number(value: unknown) {
  return Number(value || 0);
}

function extractTasks(text: string) {
  const lines = text.split(/\r?\n|(?<=[?.!])\s+(?=[A-Z])/).map(line => line.replace(/^[-•\d.)\s]+/, "").trim()).filter(line => line.length > 4);
  const start = lines.findIndex(line => /following details|following information|collect|confirm|take the following/i.test(line));
  const source = start >= 0 ? lines.slice(start + 1) : lines;
  const blocked = /^(if |you will have to|you must |please |when |the agent|call |hello |hi |thank |do not |never )/i;
  return [...new Set(source.filter(line => line.length < 180 && !blocked.test(line) && /[a-z]/i.test(line)))].slice(0, 20);
}

function customerEvidence(transcripts: string) {
  const lines = transcripts.split(/\r?\n/);
  const customerLines = lines.filter(line => /^\s*(client|customer|user)\s*:/i.test(line));
  return (customerLines.length ? customerLines : lines)
    .map(line => line.replace(/^\s*(client|customer|user)\s*:\s*/i, ""))
    .join(" ");
}

function progressFrom(row: Record<string, unknown>) {
  const leadsTotal = number(row.leads_total);
  const leadsCompleted = Math.min(leadsTotal, number(row.leads_completed));
  const tasks = extractTasks(String(row.script_text || ""));
  const evidence = `${String(row.task_evidence || "")} ${customerEvidence(String(row.customer_transcripts || ""))}`.toLowerCase();
  const ignored = new Set(["with", "that", "this", "from", "your", "have", "will", "about", "please", "customer", "details", "information", "collect", "confirm"]);
  const tasksCompleted = tasks.filter(task => task.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(word => word.length > 3 && !ignored.has(word)).some(word => evidence.includes(word))).length;
  const percent = (complete: number, total: number) => total > 0 ? Math.min(100, Math.round((complete / total) * 100)) : 0;
  return {
    calls: number(row.calls_total),
    leadsCompleted,
    leadsTotal,
    leadsPercent: percent(leadsCompleted, leadsTotal),
    tasksCompleted,
    tasksTotal: tasks.length,
    tasksPercent: percent(tasksCompleted, tasks.length),
  };
}

export async function GET() {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });

  try {
    const client = await db();
    const [agents, voices, scripts, plan] = await Promise.all([
      client.query(`SELECT ${agentFields}
        FROM bpo_created_agents b
        JOIN agents a ON a.id=b.agent_id
        LEFT JOIN admin_voices v ON v.id=b.voice_id
        LEFT JOIN agent_credentials at ON at.agent_id=a.id AND at.provider='TELNYX'
        LEFT JOIN ai_credentials tc ON tc.id=at.credential_id
        LEFT JOIN agent_credentials ag ON ag.agent_id=a.id AND ag.provider='GROQ'
        LEFT JOIN ai_credentials gc ON gc.id=ag.credential_id
        WHERE b.bpo_id=$1
        ORDER BY b.created_at DESC`, [session.agentId]),
      client.query(`SELECT v.id,v.name,v.gender,v.accent,tc.label telnyx_label,gc.label groq_label
        FROM bpo_voice_assignments x
        JOIN admin_voices v ON v.id=x.voice_id
        LEFT JOIN ai_credentials tc ON tc.id=v.telnyx_credential_id
        LEFT JOIN ai_credentials gc ON gc.id=v.groq_credential_id
        WHERE x.bpo_id=$1 AND x.is_active=TRUE AND v.status='ACTIVE'
        ORDER BY v.name`, [session.agentId]),
      client.query(`SELECT id,script_file_name,lead_file_name,created_at
        FROM script_assignments
        WHERE agent_id=$1 AND created_by=$1
        ORDER BY created_at DESC`, [session.agentId]),
      bpoEntitlements(client, session.agentId),
    ]);

    return Response.json({
      agents: agents.rows.map(row => {
        const { script_text, task_evidence, customer_transcripts, ...agent } = row;
        return { ...agent, progress: progressFrom(row) };
      }),
      voices: voices.rows,
      scripts: scripts.rows,
      agentLimit: plan.agents,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ message: "Unable to load your calling agents right now." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Enter valid agent details." }, { status: 400 });

  const agentId = randomUUID();
  const username = `bpo-${agentId.replaceAll("-", "").slice(0, 20)}`;
  const passwordHash = await hash(randomUUID(), 12);
  const pool = await db();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const bpo = await client.query("SELECT id FROM agents WHERE id=$1 AND role='BPO' AND status='APPROVED' FOR UPDATE", [session.agentId]);
    if (!bpo.rows[0]) {
      await client.query("ROLLBACK");
      return Response.json({ message: "Your BPO account is not approved." }, { status: 403 });
    }

    const [plan, existing, voice, sourceScript, sourceLeads, duplicateName] = await Promise.all([
      bpoEntitlements(client, session.agentId),
      client.query("SELECT COUNT(*)::int agents FROM bpo_created_agents WHERE bpo_id=$1", [session.agentId]),
      client.query(`SELECT v.id,v.name,v.accent,v.telnyx_credential_id,v.groq_credential_id
        FROM bpo_voice_assignments x
        JOIN admin_voices v ON v.id=x.voice_id
        WHERE x.bpo_id=$1 AND x.is_active=TRUE AND v.id=$2 AND v.status='ACTIVE'
        FOR UPDATE OF v`, [session.agentId, parsed.data.voiceId]),
      client.query(`SELECT id,script_file_name,script_file_url,script_file_type,script_text,script_file_size
        FROM script_assignments WHERE id=$1 AND agent_id=$2 AND created_by=$2 FOR UPDATE`, [parsed.data.scriptId, session.agentId]),
      client.query(`SELECT id,lead_file_name,lead_file_url,lead_file_type,lead_headers,lead_rows,lead_file_size
        FROM script_assignments WHERE id=$1 AND agent_id=$2 AND created_by=$2 FOR UPDATE`, [parsed.data.leadSheetId, session.agentId]),
      client.query("SELECT id FROM agents WHERE name=$1 FOR UPDATE", [parsed.data.name]),
    ]);
    const agentLimit = plan.agents;
    const existingAgents = number(existing.rows[0]?.agents);
    if (agentLimit <= 0) {
      await client.query("ROLLBACK");
      return Response.json({ message: "Buy a plan with agent slots before creating a calling agent." }, { status: 403 });
    }
    if (existingAgents >= agentLimit) {
      await client.query("ROLLBACK");
      return Response.json({ message: `Your ${agentLimit} available agent slots are already in use.` }, { status: 409 });
    }
    if (duplicateName.rows[0]) {
      await client.query("ROLLBACK");
      return Response.json({ message: "This agent name is already in use. Choose another name." }, { status: 409 });
    }
    const selectedVoice = voice.rows[0];
    if (!selectedVoice) {
      await client.query("ROLLBACK");
      return Response.json({ message: "Choose an active AI voice assigned to your BPO workspace." }, { status: 403 });
    }
    const script = sourceScript.rows[0];
    if (!script) {
      await client.query("ROLLBACK");
      return Response.json({ message: "Choose a script uploaded in your BPO workspace." }, { status: 403 });
    }
    const leads = sourceLeads.rows[0];
    if (!leads) {
      await client.query("ROLLBACK");
      return Response.json({ message: "Choose a customer sheet uploaded in your BPO workspace." }, { status: 403 });
    }

    await client.query(`INSERT INTO agents (id,name,username,password_hash,gender,accent,avatar_url,status,role,approved_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'APPROVED','AGENT',NOW())`,
    [agentId, parsed.data.name, username, passwordHash, parsed.data.gender, selectedVoice.accent || "Professional", parsed.data.avatarUrl || null]);

    const credentials = [["TELNYX", selectedVoice.telnyx_credential_id], ["GROQ", selectedVoice.groq_credential_id]] as const;
    for (const [provider, credentialId] of credentials) {
      if (credentialId) await client.query("INSERT INTO agent_credentials (agent_id,provider,credential_id) VALUES ($1,$2,$3)", [agentId, provider, credentialId]);
    }

    await client.query(`INSERT INTO script_assignments (id,agent_id,lead_file_name,script_file_name,lead_file_url,script_file_url,lead_file_type,script_file_type,lead_headers,lead_rows,script_text,lead_file_size,script_file_size,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14)`, [
      randomUUID(), agentId, leads.lead_file_name, script.script_file_name, leads.lead_file_url || null, script.script_file_url || null,
      leads.lead_file_type || null, script.script_file_type || null, JSON.stringify(leads.lead_headers || []), JSON.stringify(leads.lead_rows || []),
      script.script_text || "", number(leads.lead_file_size), number(script.script_file_size), session.agentId,
    ]);
    await client.query(`INSERT INTO bpo_created_agents (agent_id,bpo_id,voice_id,voice_name,source_script_id,script_name,source_lead_id,lead_file_name,dialing_mode)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [agentId, session.agentId, selectedVoice.id, selectedVoice.name, script.id, script.script_file_name, leads.id, leads.lead_file_name, parsed.data.dialingMode]);

    await client.query("COMMIT");
    return Response.json({ message: `${parsed.data.name} is ready for your calling team.`, agentId }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return Response.json({ message: "This agent name is already in use. Choose another name." }, { status: 409 });
    }
    console.error("BPO agent creation failed", error);
    return Response.json({ message: "Unable to create this calling agent right now." }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PATCH(request: Request) {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsedActivity = activitySchema.safeParse(body);
  const parsedEdit = parsedActivity.success ? null : editSchema.safeParse(body);
  if (!parsedActivity.success && !parsedEdit?.success) return Response.json({ message: "Choose valid calling agent details." }, { status: 400 });

  const pool = await db();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (parsedActivity.success) {
      const updated = await client.query("UPDATE bpo_created_agents SET is_active=$1 WHERE agent_id=$2 AND bpo_id=$3 RETURNING agent_id", [parsedActivity.data.isActive, parsedActivity.data.agentId, session.agentId]);
      if (!updated.rows[0]) {
        await client.query("ROLLBACK");
        return Response.json({ message: "Calling agent not found." }, { status: 404 });
      }
      await client.query("UPDATE agents SET status=$1,updated_at=NOW() WHERE id=$2 AND role='AGENT'", [parsedActivity.data.isActive ? "APPROVED" : "SUSPENDED", parsedActivity.data.agentId]);
      await client.query("COMMIT");
      return Response.json({ message: parsedActivity.data.isActive ? "Calling agent is now active." : "Calling agent is now inactive.", isActive: parsedActivity.data.isActive });
    }

    // The validation guard above makes this the edit payload (activity requests
    // return from the branch above).
    const data = parsedEdit!.data!;
    const current = await client.query("SELECT b.agent_id FROM bpo_created_agents b WHERE b.agent_id=$1 AND b.bpo_id=$2 FOR UPDATE", [data.agentId, session.agentId]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return Response.json({ message: "Calling agent not found." }, { status: 404 });
    }
    const [voice, sourceScript, sourceLeads, duplicateName] = await Promise.all([
      client.query(`SELECT v.id,v.name,v.accent,v.telnyx_credential_id,v.groq_credential_id
        FROM bpo_voice_assignments x
        JOIN admin_voices v ON v.id=x.voice_id
        WHERE x.bpo_id=$1 AND x.is_active=TRUE AND v.id=$2 AND v.status='ACTIVE'
        FOR UPDATE OF v`, [session.agentId, data.voiceId]),
      client.query(`SELECT id,script_file_name,script_file_url,script_file_type,script_text,script_file_size
        FROM script_assignments WHERE id=$1 AND agent_id=$2 AND created_by=$2 FOR UPDATE`, [data.scriptId, session.agentId]),
      client.query(`SELECT id,lead_file_name,lead_file_url,lead_file_type,lead_headers,lead_rows,lead_file_size
        FROM script_assignments WHERE id=$1 AND agent_id=$2 AND created_by=$2 FOR UPDATE`, [data.leadSheetId, session.agentId]),
      client.query("SELECT id FROM agents WHERE name=$1 AND id<>$2 FOR UPDATE", [data.name, data.agentId]),
    ]);
    if (duplicateName.rows[0]) {
      await client.query("ROLLBACK");
      return Response.json({ message: "This agent name is already in use. Choose another name." }, { status: 409 });
    }
    const selectedVoice = voice.rows[0];
    if (!selectedVoice) {
      await client.query("ROLLBACK");
      return Response.json({ message: "Choose an active voice from the Voices tab." }, { status: 403 });
    }
    const script = sourceScript.rows[0], leads = sourceLeads.rows[0];
    if (!script || !leads) {
      await client.query("ROLLBACK");
      return Response.json({ message: "Choose a script and customer sheet uploaded in your BPO workspace." }, { status: 403 });
    }
    await client.query("UPDATE agents SET name=$1,gender=$2,accent=$3,avatar_url=$4,updated_at=NOW() WHERE id=$5 AND role='AGENT'", [data.name, data.gender, selectedVoice.accent || "Professional", data.avatarUrl || null, data.agentId]);
    await client.query("DELETE FROM agent_credentials WHERE agent_id=$1", [data.agentId]);
    const credentials = [["TELNYX", selectedVoice.telnyx_credential_id], ["GROQ", selectedVoice.groq_credential_id]] as const;
    for (const [provider, credentialId] of credentials) {
      if (credentialId) await client.query("INSERT INTO agent_credentials (agent_id,provider,credential_id) VALUES ($1,$2,$3)", [data.agentId, provider, credentialId]);
    }
    const assignment = await client.query(`UPDATE script_assignments SET lead_file_name=$1,script_file_name=$2,lead_file_url=$3,script_file_url=$4,lead_file_type=$5,script_file_type=$6,lead_headers=$7::jsonb,lead_rows=$8::jsonb,script_text=$9,lead_file_size=$10,script_file_size=$11
      WHERE id=(SELECT id FROM script_assignments WHERE agent_id=$12 ORDER BY created_at DESC LIMIT 1)
      RETURNING id`, [leads.lead_file_name, script.script_file_name, leads.lead_file_url || null, script.script_file_url || null, leads.lead_file_type || null, script.script_file_type || null, JSON.stringify(leads.lead_headers || []), JSON.stringify(leads.lead_rows || []), script.script_text || "", number(leads.lead_file_size), number(script.script_file_size), data.agentId]);
    if (!assignment.rows[0]) {
      await client.query(`INSERT INTO script_assignments (id,agent_id,lead_file_name,script_file_name,lead_file_url,script_file_url,lead_file_type,script_file_type,lead_headers,lead_rows,script_text,lead_file_size,script_file_size,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14)`, [randomUUID(), data.agentId, leads.lead_file_name, script.script_file_name, leads.lead_file_url || null, script.script_file_url || null, leads.lead_file_type || null, script.script_file_type || null, JSON.stringify(leads.lead_headers || []), JSON.stringify(leads.lead_rows || []), script.script_text || "", number(leads.lead_file_size), number(script.script_file_size), session.agentId]);
    }
    await client.query(`UPDATE bpo_created_agents SET voice_id=$1,voice_name=$2,source_script_id=$3,script_name=$4,source_lead_id=$5,lead_file_name=$6,dialing_mode=$7
      WHERE agent_id=$8 AND bpo_id=$9`, [selectedVoice.id, selectedVoice.name, script.id, script.script_file_name, leads.id, leads.lead_file_name, data.dialingMode, data.agentId, session.agentId]);
    await client.query("COMMIT");
    return Response.json({ message: `${data.name} has been updated.` });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("BPO agent activity update failed", error);
    return Response.json({ message: "Unable to update this calling agent right now." }, { status: 500 });
  } finally {
    client.release();
  }
}
