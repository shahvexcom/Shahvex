import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "development-only-change-me-before-production");
export const SESSION_COOKIE = "maxai_session";
export const ADMIN_SESSION_COOKIE = "maxai_admin_session";
export const AGENT_SESSION_COOKIE = SESSION_COOKIE;
export const BPO_SESSION_COOKIE = "maxai_bpo_session";
export type SessionPayload = { agentId: string; role: "AGENT" | "ADMIN" | "BPO" };
export async function createSession(payload: SessionPayload) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret);
}
export async function readSession(token?: string) {
  if (!token) return null;
  try { return (await jwtVerify(token, secret)).payload as SessionPayload; } catch { return null; }
}

