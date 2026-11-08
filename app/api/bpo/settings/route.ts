import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { requireApprovedBpo } from "@/lib/bpo-session";
import { db } from "@/lib/database";
import { sendMail } from "@/lib/email";
import { twoFactorStatusEmail } from "@/lib/email-templates";

const key = () => Buffer.from((process.env.AUTH_SECRET || "maxai-bpo-settings-secret").padEnd(32, "0").slice(0, 32));

function seal(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

function open(value: string) {
  const [iv, tag, data] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString();
}

function otp(secret: string, counter: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const raw = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < raw.length; index += 1) raw[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hashValue = createHmac("sha1", raw).update(buffer).digest();
  const offset = hashValue[hashValue.length - 1] & 15;
  return String((hashValue.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}

function valid(secret: string, code: string) {
  const now = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some(offset => otp(secret, now + offset) === code);
}

async function sendTwoFactorEmail(client: Awaited<ReturnType<typeof db>>, agentId: string, enabled: boolean) {
  const profile = await client.query("SELECT name,email FROM agents WHERE id=$1", [agentId]);
  if (!profile.rows[0]?.email) return;
  const content = twoFactorStatusEmail({ name: profile.rows[0].name, enabled, changedAt: new Date() });
  try {
    await sendMail(profile.rows[0].email, content.subject, content.text, content.html);
  } catch (error) {
    console.error("BPO 2FA notification email error:", error);
  }
}

export async function GET() {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const result = await (await db()).query(
    "SELECT name,email,username,COALESCE(avatar_url,'') avatar_url,two_factor_enabled FROM agents WHERE id=$1 AND role='BPO'",
    [session.agentId],
  );
  return Response.json({ profile: result.rows[0] });
}

export async function PATCH(request: Request) {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const data = await request.json();
  const client = await db();
  const current = await client.query("SELECT password_hash,two_factor_secret,two_factor_enabled,email FROM agents WHERE id=$1 AND role='BPO'", [session.agentId]);
  if (!current.rows[0]) return Response.json({ message: "Account not found" }, { status: 404 });

  if (data.action === "profile") {
    if (data.avatar_url !== undefined) await client.query("UPDATE agents SET avatar_url=$1,updated_at=NOW() WHERE id=$2", [data.avatar_url || null, session.agentId]);
    if (data.newPassword) {
      if (!data.currentPassword || !(await compare(data.currentPassword, current.rows[0].password_hash))) return Response.json({ message: "Current password is incorrect." }, { status: 400 });
      await client.query("UPDATE agents SET password_hash=$1,updated_at=NOW() WHERE id=$2", [await hash(data.newPassword, 12), session.agentId]);
    }
    return Response.json({ message: "Account settings saved." });
  }

  if (data.action === "setup") {
    if (current.rows[0].two_factor_enabled) return Response.json({ message: "Two-factor authentication is already enabled." }, { status: 400 });
    const secret = randomBytes(10).toString("base64").replace(/[^A-Z2-7]/gi, "A").slice(0, 16).toUpperCase();
    await client.query("UPDATE agents SET two_factor_secret=$1 WHERE id=$2", [seal(secret), session.agentId]);
    const uri = `otpauth://totp/7%20Call%20AI:${encodeURIComponent(current.rows[0].email || "BPO")}?secret=${secret}&issuer=7%20Call%20AI`;
    return Response.json({ secret, uri });
  }

  if (data.action === "verify") {
    const secret = current.rows[0].two_factor_secret && open(current.rows[0].two_factor_secret);
    if (!secret || !valid(secret, String(data.code || ""))) return Response.json({ message: "Invalid authenticator code." }, { status: 400 });
    await client.query("UPDATE agents SET two_factor_enabled=TRUE,updated_at=NOW() WHERE id=$1", [session.agentId]);
    await sendTwoFactorEmail(client, session.agentId, true);
    return Response.json({ message: "Two-factor authentication enabled." });
  }

  if (data.action === "disable") {
    if (!data.currentPassword || !(await compare(data.currentPassword, current.rows[0].password_hash))) return Response.json({ message: "Current password is incorrect." }, { status: 400 });
    await client.query("UPDATE agents SET two_factor_enabled=FALSE,two_factor_secret=NULL,updated_at=NOW() WHERE id=$1", [session.agentId]);
    await sendTwoFactorEmail(client, session.agentId, false);
    return Response.json({ message: "Two-factor authentication disabled." });
  }

  return Response.json({ message: "Unsupported action." }, { status: 400 });
}
