import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./database";

export const demoHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const demoToken = () => randomBytes(32).toString("base64url");
export const validDemoToken = (token: string) =>
  /^[A-Za-z0-9_-]{43}$/.test(token);
let ready: Promise<void> | undefined;
export async function demoDb() {
  const pool = await db();
  ready ??= pool
    .query(
      `
    CREATE TABLE IF NOT EXISTS agent_demo_links (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
      max_sessions INTEGER NOT NULL CHECK(max_sessions BETWEEN 1 AND 1000),
      used_sessions INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS agent_demo_sessions (
      id TEXT PRIMARY KEY, link_id TEXT NOT NULL REFERENCES agent_demo_links(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ,
      consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), consent_version TEXT NOT NULL,
      request_window TIMESTAMPTZ NOT NULL DEFAULT NOW(), request_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS agent_demo_sessions_active ON agent_demo_sessions(link_id,expires_at) WHERE ended_at IS NULL;
    CREATE TABLE IF NOT EXISTS agent_demo_rate (
      key TEXT PRIMARY KEY, window_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), hits INTEGER NOT NULL DEFAULT 1
    );
  `,
    )
    .then(() => {})
    .catch((error) => {
      ready = undefined;
      throw error;
    });
  await ready;
  return pool;
}
export async function demoRate(token: string) {
  const pool = await demoDb();
  const result = await pool.query(
    `INSERT INTO agent_demo_rate(key) VALUES($1)
    ON CONFLICT(key) DO UPDATE SET
      hits=CASE WHEN agent_demo_rate.window_at<NOW()-INTERVAL '1 minute' THEN 1 ELSE agent_demo_rate.hits+1 END,
      window_at=CASE WHEN agent_demo_rate.window_at<NOW()-INTERVAL '1 minute' THEN NOW() ELSE agent_demo_rate.window_at END
    WHERE agent_demo_rate.hits<120 OR agent_demo_rate.window_at<NOW()-INTERVAL '1 minute' RETURNING key`,
    [demoHash(token)],
  );
  return Boolean(result.rowCount);
}
export async function demoLink(token: string) {
  if (!validDemoToken(token)) return null;
  const pool = await demoDb();
  const result = await pool.query(
    `SELECT l.*,a.name,a.avatar_url,a.accent,a.language,a.local_voice_id,a.speaks_first,a.conversation_style,
    COALESCE(NULLIF(a.agent_script,''),s.script_text,'') script
    FROM agent_demo_links l JOIN agents a ON a.id=l.agent_id
    JOIN agents owner ON owner.id=l.owner_id AND owner.role='ADMIN'
    JOIN admin_agent_owners o ON o.agent_id=a.id AND o.owner_id=l.owner_id AND o.verified=TRUE
    LEFT JOIN LATERAL (SELECT script_text FROM script_assignments WHERE agent_id=a.id ORDER BY created_at DESC LIMIT 1) s ON TRUE
    WHERE l.token_hash=$1 AND l.revoked_at IS NULL AND l.expires_at>NOW() AND a.role='AGENT'
    AND NOT EXISTS (SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.id)`,
    [demoHash(token)],
  );
  return result.rows[0] || null;
}
export const demoHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
export const demoJson = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: demoHeaders });
