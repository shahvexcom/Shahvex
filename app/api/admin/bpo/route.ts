import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/database";
import { getBpoCreditContacts } from "@/lib/bpo-credit-contacts";
import { sendMail } from "@/lib/email";
import {
  bpoApprovedEmail,
  bpoBlockedEmail,
  bpoDeletedEmail,
  creditLoadedEmail,
  creditReducedEmail,
  formatPkr,
} from "@/lib/email-templates";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";

const loadCreditsSchema = z.object({
  action: z.literal("load-credits"),
  id: z.string().min(1),
  amount: z.number().positive().max(1_000_000).refine(value => Number.isFinite(value), "Enter a valid credit amount."),
});

const reduceCreditsSchema = z.object({
  action: z.literal("reduce-credits"),
  id: z.string().min(1),
  amount: z.number().positive().max(1_000_000).refine(value => Number.isFinite(value), "Enter a valid credit amount."),
});

const blockSchema = z.object({
  action: z.literal("block"),
  id: z.string().min(1),
  reason: z.string().trim().min(3, "Please enter a block reason.").max(500),
});

const approveSchema = z.object({
  action: z.literal("approve"),
  id: z.string().min(1),
});

const deleteSchema = z.object({ id: z.string().min(1) });

const contactUrl = z.string().trim().max(500).url("Enter a valid URL.").refine(
  value => value.startsWith("https://") || value.startsWith("http://"),
  "URL must start with http:// or https://.",
);

const creditContactsSchema = z.object({
  action: z.literal("update-credit-contacts"),
  whatsappUrl: contactUrl,
  instagramUrl: contactUrl,
  messengerUrl: contactUrl,
});

async function requireAdmin() {
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  return session?.role === "ADMIN" ? session : null;
}

const bpoFields = `id,name,email,COALESCE(avatar_url,'') avatar_url,
  COALESCE(two_factor_enabled,FALSE) two_factor_enabled,created_at,status,
  COALESCE(overall_credits,0)::float8 overall_credits,
  COALESCE(remaining_credits,0)::float8 remaining_credits,
  blocked_at,COALESCE(block_reason,'') block_reason`;

async function emailSafely(to: string | null, subject: string, text: string, html?: string) {
  if (!to) return false;
  try {
    await sendMail(to, subject, text, html);
    return true;
  } catch (error) {
    console.error(`BPO admin email failed (${subject})`, error);
    return false;
  }
}

export async function GET() {
  if (!await requireAdmin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const client = await db();
  const [result, creditContacts] = await Promise.all([client.query(`SELECT ${bpoFields},
    (SELECT COUNT(*)::int FROM bpo_voice_assignments x JOIN admin_voices v ON v.id=x.voice_id WHERE x.bpo_id=agents.id AND v.status='ACTIVE') active_agents,
    (SELECT COUNT(*)::int FROM agent_calls c WHERE c.agent_id=agents.id OR EXISTS (SELECT 1 FROM script_assignments s WHERE s.agent_id=c.agent_id AND s.created_by=agents.id)) total_calls,
    GREATEST(COALESCE(overall_credits,0)-COALESCE(remaining_credits,0),0)::float8 spend_amount
    FROM agents WHERE role='BPO' ORDER BY created_at DESC`), getBpoCreditContacts()]);
  return Response.json({ users: result.rows, creditContacts });
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const creditContacts = creditContactsSchema.safeParse(body);

  if (creditContacts.success) {
    const result = await (await db()).query(
      `INSERT INTO bpo_credit_contact_settings (id,whatsapp_url,instagram_url,messenger_url,updated_by,updated_at)
       VALUES (1,$1,$2,$3,$4,NOW())
       ON CONFLICT (id) DO UPDATE SET whatsapp_url=EXCLUDED.whatsapp_url,
         instagram_url=EXCLUDED.instagram_url,messenger_url=EXCLUDED.messenger_url,
         updated_by=EXCLUDED.updated_by,updated_at=NOW()
       RETURNING whatsapp_url,instagram_url,messenger_url,updated_at`,
      [creditContacts.data.whatsappUrl, creditContacts.data.instagramUrl, creditContacts.data.messengerUrl, admin.agentId],
    );
    const row = result.rows[0];
    return Response.json({
      message: "Credit contact URLs updated.",
      creditContacts: {
        whatsappUrl: row.whatsapp_url,
        instagramUrl: row.instagram_url,
        messengerUrl: row.messenger_url,
        updatedAt: new Date(row.updated_at).toISOString(),
      },
    });
  }
  const load = loadCreditsSchema.safeParse(body);

  if (load.success) {
    const client = await db();
    const connection = await client.connect();
    try {
      await connection.query("BEGIN");
      const result = await connection.query(
        `UPDATE agents SET overall_credits=overall_credits+$1,remaining_credits=remaining_credits+$1,updated_at=NOW()
         WHERE id=$2 AND role='BPO' RETURNING ${bpoFields}`,
        [load.data.amount, load.data.id],
      );
      const user = result.rows[0];
      if (!user) {
        await connection.query("ROLLBACK");
        return Response.json({ message: "BPO user not found." }, { status: 404 });
      }
      await connection.query(
        "INSERT INTO bpo_credit_transactions (id,bpo_id,amount,loaded_by,transaction_type) VALUES ($1,$2,$3,$4,'LOAD')",
        [randomUUID(), load.data.id, load.data.amount, admin.agentId],
      );
      await connection.query("COMMIT");
      const creditEmail = creditLoadedEmail({ name: user.name, amount: load.data.amount, balance: Number(user.remaining_credits), loadedAt: new Date() });
      const emailSent = await emailSafely(user.email, creditEmail.subject, creditEmail.text, creditEmail.html);
      return Response.json({ message: "Credits loaded successfully.", user, emailSent });
    } catch (error) {
      await connection.query("ROLLBACK").catch(() => undefined);
      console.error("BPO credit load failed", error);
      return Response.json({ message: "Unable to load credits right now." }, { status: 500 });
    } finally {
      connection.release();
    }
  }

  const reduce = reduceCreditsSchema.safeParse(body);
  if (reduce.success) {
    const client = await db();
    const connection = await client.connect();
    try {
      await connection.query("BEGIN");
      const result = await connection.query(
        `UPDATE agents SET overall_credits=GREATEST(overall_credits-$1,0),remaining_credits=remaining_credits-$1,updated_at=NOW()
         WHERE id=$2 AND role='BPO' AND remaining_credits >= $1 RETURNING ${bpoFields}`,
        [reduce.data.amount, reduce.data.id],
      );
      const user = result.rows[0];
      if (!user) {
        const current = await connection.query("SELECT remaining_credits::float8 remaining_credits FROM agents WHERE id=$1 AND role='BPO'", [reduce.data.id]);
        await connection.query("ROLLBACK");
        if (!current.rows[0]) return Response.json({ message: "BPO user not found." }, { status: 404 });
        return Response.json({ message: `You cannot remove more than the remaining balance (${formatPkr(Number(current.rows[0].remaining_credits))}).` }, { status: 400 });
      }
      await connection.query(
        "INSERT INTO bpo_credit_transactions (id,bpo_id,amount,loaded_by,transaction_type) VALUES ($1,$2,$3,$4,'DEDUCT')",
        [randomUUID(), reduce.data.id, reduce.data.amount, admin.agentId],
      );
      await connection.query("COMMIT");
      const creditEmail = creditReducedEmail({ name: user.name, amount: reduce.data.amount, balance: Number(user.remaining_credits), adjustedAt: new Date() });
      const emailSent = await emailSafely(user.email, creditEmail.subject, creditEmail.text, creditEmail.html);
      return Response.json({ message: "Credits reduced successfully.", user, emailSent });
    } catch (error) {
      await connection.query("ROLLBACK").catch(() => undefined);
      console.error("BPO credit reduction failed", error);
      return Response.json({ message: "Unable to reduce credits right now." }, { status: 500 });
    } finally {
      connection.release();
    }
  }

  const block = blockSchema.safeParse(body);
  if (block.success) {
    const blockedAt = new Date();
    const result = await (await db()).query(
      `UPDATE agents SET status='SUSPENDED',blocked_at=$1,block_reason=$2,updated_at=NOW()
       WHERE id=$3 AND role='BPO' RETURNING ${bpoFields}`,
      [blockedAt, block.data.reason, block.data.id],
    );
    const user = result.rows[0];
    if (!user) return Response.json({ message: "BPO user not found." }, { status: 404 });
    const emailContent = bpoBlockedEmail({ name: user.name, reason: block.data.reason, blockedAt });
    const emailSent = await emailSafely(user.email, emailContent.subject, emailContent.text, emailContent.html);
    return Response.json({ message: "BPO user blocked successfully.", user, emailSent });
  }

  const approve = approveSchema.safeParse(body);
  if (approve.success) {
    const approvedAt = new Date();
    const result = await (await db()).query(
      `UPDATE agents SET status='APPROVED',approved_at=COALESCE(approved_at,$1),blocked_at=NULL,block_reason='',updated_at=NOW()
       WHERE id=$2 AND role='BPO' RETURNING ${bpoFields}`,
      [approvedAt, approve.data.id],
    );
    const user = result.rows[0];
    if (!user) return Response.json({ message: "BPO user not found." }, { status: 404 });
    const emailContent = bpoApprovedEmail({ name: user.name, approvedAt });
    const emailSent = await emailSafely(user.email, emailContent.subject, emailContent.text, emailContent.html);
    return Response.json({ message: "BPO user approved successfully.", user, emailSent });
  }

  const issue = body?.action === "block"
    ? block.error?.issues[0]?.message
    : body?.action === "approve"
      ? approve.error?.issues[0]?.message
      : body?.action === "update-credit-contacts"
        ? creditContacts.error?.issues[0]?.message
      : body?.action === "reduce-credits"
        ? reduce.error?.issues[0]?.message
        : load.error?.issues[0]?.message;
  return Response.json({ message: issue || "Invalid BPO action." }, { status: 400 });
}

export async function DELETE(request: Request) {
  if (!await requireAdmin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "Invalid BPO user." }, { status: 400 });

  const client = await db();
  const connection = await client.connect();
  let user: { id: string; name: string; email: string | null } | undefined;
  try {
    await connection.query("BEGIN");
    const parent = await connection.query("SELECT id FROM agents WHERE id=$1 AND role='BPO' FOR UPDATE", [parsed.data.id]);
    if (!parent.rows[0]) {
      await connection.query("ROLLBACK");
      return Response.json({ message: "BPO user not found." }, { status: 404 });
    }
    // Remove the BPO-owned calling agents first. Otherwise the relationship
    // row cascades away with the BPO account and leaves ordinary AGENT rows.
    await connection.query("DELETE FROM agents WHERE id IN (SELECT agent_id FROM bpo_created_agents WHERE bpo_id=$1)", [parsed.data.id]);
    const result = await connection.query(
      "DELETE FROM agents WHERE id=$1 AND role='BPO' RETURNING id,name,email",
      [parsed.data.id],
    );
    user = result.rows[0];
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    console.error("BPO deletion failed", error);
    return Response.json({ message: "Unable to delete this BPO user right now." }, { status: 500 });
  } finally {
    connection.release();
  }
  if (!user) return Response.json({ message: "BPO user not found." }, { status: 404 });
  const emailContent = bpoDeletedEmail({ name: user.name, deletedAt: new Date() });
  const emailSent = await emailSafely(user.email, emailContent.subject, emailContent.text, emailContent.html);
  return Response.json({ message: "BPO user deleted successfully.", deletedId: user.id, emailSent });
}
