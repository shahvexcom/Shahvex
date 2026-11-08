import { consumeEmailOtp } from "@/lib/email-otp";
import { randomUUID } from "node:crypto";
import { sendMail } from "@/lib/email";
import { bpoEmailVerifiedEmail } from "@/lib/email-templates";
import { readBpoRegistrationToken } from "@/lib/bpo-registration-token";

export async function POST(request: Request) {
  try {
    const { token, otp } = await request.json();
    const pending = await readBpoRegistrationToken(String(token || ""));
    const suppliedOtp = String(otp || "").trim();
    if (!pending?.challengeId || !/^\d{6}$/.test(suppliedOtp)) {
      return Response.json({ message: "Invalid or expired OTP." }, { status: 400 });
    }
    const verified = await consumeEmailOtp(pending.challengeId, pending.email, "bpo-registration", suppliedOtp, async client => {
    const existing = await client.query("SELECT id FROM agents WHERE name=$1 OR username=$2 OR email=$3 LIMIT 1", [pending.name, pending.username, pending.email]);
    if (existing.rowCount) throw Object.assign(new Error("Account already exists"), { code: "23505" });
    await client.query(
      "INSERT INTO agents (id,name,username,email,phone,password_hash,gender,accent,role,status,email_verified,approved_at) VALUES ($1,$2,$3,$4,$5,$6,'OTHER','Professional','BPO','APPROVED',TRUE,NOW())",
      [randomUUID(), pending.name, pending.username, pending.email, pending.phone || null, pending.passwordHash],
    );
    });
    if (!verified) return Response.json({ message: "Invalid or expired OTP. Request a new code if needed." }, { status: 400 });
    const emailContent = bpoEmailVerifiedEmail({ name: pending.name });
    try {
      await sendMail(pending.email, emailContent.subject, emailContent.text, emailContent.html);
    } catch (mailError) {
      console.error("BPO verification confirmation email error:", mailError);
    }
    return Response.json({ message: "Email verified successfully." });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "23505") return Response.json({ message: "Name, email or username is already in use." }, { status: 409 });
    return Response.json({ message: "Unable to verify email right now." }, { status: 503 });
  }
}
