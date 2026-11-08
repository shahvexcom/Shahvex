import { createHash, randomInt, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "./database";

export const OTP_COOLDOWN_SECONDS = 60;
export class OtpLimitError extends Error {
  constructor(message: string, public retryAfter: number) { super(message); }
}
let schema: Promise<unknown> | undefined;
async function pool() {
  const client = await db();
  schema ??= client.query(`CREATE TABLE IF NOT EXISTS email_otp_challenges (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL, flow_expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ, failed_attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS email_otp_deliveries (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, is_resend BOOLEAN NOT NULL, sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS email_otp_deliveries_email_time ON email_otp_deliveries(email,sent_at);`).catch(error => { schema = undefined; throw error; });
  await schema;
  return client;
}
const digest = (id: string, code: string) => createHash("sha256").update(`${id}:${code}`).digest("hex");

// One email identity shares its cooldown and resend allowance across all purposes.
export async function deliverEmailOtp(email: string, purpose: string, deliver: (code: string) => Promise<void>, challengeId?: string) {
  email = email.trim().toLowerCase();
  const connection = await (await pool()).connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
    // Restarting the same registration must not bypass resend limits.
    if (!challengeId) {
      const existing = await connection.query("SELECT id FROM email_otp_challenges WHERE email=$1 AND purpose=$2 AND verified_at IS NULL AND flow_expires_at>NOW() ORDER BY flow_expires_at DESC LIMIT 1 FOR UPDATE", [email, purpose]);
      challengeId = existing.rows[0]?.id;
    }
    if (challengeId) {
      const challenge = await connection.query("SELECT id FROM email_otp_challenges WHERE id=$1 AND email=$2 AND purpose=$3 AND verified_at IS NULL AND flow_expires_at>NOW() FOR UPDATE", [challengeId, email, purpose]);
      if (!challenge.rowCount) throw new Error("Verification session expired. Please register again.");
    }
    const limits = await connection.query(`SELECT
      COUNT(*) FILTER (WHERE is_resend AND sent_at >= date_trunc('day',NOW() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi')::int AS daily,
      COUNT(*) FILTER (WHERE is_resend AND sent_at >= date_trunc('month',NOW() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi')::int AS monthly,
      GREATEST(0,CEIL(60-EXTRACT(EPOCH FROM (NOW()-MAX(sent_at)))))::int AS cooldown,
      CEIL(EXTRACT(EPOCH FROM ((date_trunc('day',NOW() AT TIME ZONE 'Asia/Karachi')+INTERVAL '1 day') AT TIME ZONE 'Asia/Karachi'-NOW())))::int AS day_reset,
      CEIL(EXTRACT(EPOCH FROM ((date_trunc('month',NOW() AT TIME ZONE 'Asia/Karachi')+INTERVAL '1 month') AT TIME ZONE 'Asia/Karachi'-NOW())))::int AS month_reset
      FROM email_otp_deliveries WHERE email=$1`, [email]);
    const limit = limits.rows[0];
    if (challengeId && limit.monthly >= 150) throw new OtpLimitError("Monthly resend limit reached (150). Please try next month.", limit.month_reset);
    if (challengeId && limit.daily >= 5) throw new OtpLimitError("Daily resend limit reached (5). Please try tomorrow.", limit.day_reset);
    if (limit.cooldown > 0) throw new OtpLimitError("Please wait before requesting another code.", limit.cooldown);
    const id = challengeId || randomUUID(), code = String(randomInt(100000, 1000000));
    // Failed delivery rolls back both the new code and its allowance usage.
    await deliver(code);
    if (challengeId) await connection.query("UPDATE email_otp_challenges SET code_hash=$2,expires_at=NOW()+INTERVAL '10 minutes',failed_attempts=0 WHERE id=$1", [id, digest(id, code)]);
    else {
      await connection.query("UPDATE email_otp_challenges SET flow_expires_at=NOW() WHERE email=$1 AND purpose=$2 AND verified_at IS NULL", [email, purpose]);
      await connection.query("INSERT INTO email_otp_challenges(id,email,purpose,code_hash,expires_at,flow_expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes',NOW()+INTERVAL '24 hours')", [id, email, purpose, digest(id, code)]);
    }
    await connection.query("INSERT INTO email_otp_deliveries(id,email,is_resend) VALUES($1,$2,$3)", [randomUUID(), email, Boolean(challengeId)]);
    await connection.query("COMMIT");
    return { challengeId: id, retryAfter: OTP_COOLDOWN_SECONDS, dailyRemaining: 5 - limit.daily - Number(Boolean(challengeId)), monthlyRemaining: 150 - limit.monthly - Number(Boolean(challengeId)) };
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
}

export async function consumeEmailOtp(id: string, email: string, purpose: string, code: string, complete: (connection: PoolClient) => Promise<void>) {
  const connection = await (await pool()).connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email.trim().toLowerCase()]);
    const result = await connection.query("SELECT *,expires_at>NOW() AND flow_expires_at>NOW() AS valid FROM email_otp_challenges WHERE id=$1 AND email=$2 AND purpose=$3 FOR UPDATE", [id, email.trim().toLowerCase(), purpose]);
    const row = result.rows[0];
    if (!row || row.verified_at || !row.valid || row.failed_attempts >= 5) { await connection.query("ROLLBACK"); return false; }
    if (row.code_hash !== digest(id, code)) {
      await connection.query("UPDATE email_otp_challenges SET failed_attempts=failed_attempts+1 WHERE id=$1", [id]);
      await connection.query("COMMIT"); return false;
    }
    await complete(connection);
    await connection.query("UPDATE email_otp_challenges SET verified_at=NOW() WHERE id=$1", [id]);
    await connection.query("COMMIT"); return true;
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
}
