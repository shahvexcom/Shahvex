import { deliverEmailOtp, OtpLimitError } from "@/lib/email-otp";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/database";
import { sendMail } from "@/lib/email";
import { bpoVerificationEmail } from "@/lib/email-templates";
import { createBpoRegistrationToken } from "@/lib/bpo-registration-token";

const schema = z.object({
  portal: z.enum(["agent", "bpo"]).default("agent"),
  name: z.string().trim().min(2).max(80),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._@+-]{3,80}$/),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("")),
  phone: z.string().trim().min(7).max(40).optional().or(z.literal("")),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  accent: z.string().trim().min(2).max(80).optional(),
  password: z.string().min(8).max(128),
  confirmPassword: z.string().optional(),
  confirmed: z.literal(true).optional(),
}).refine(data => data.portal === "agent" || data.password === data.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"],
}).refine(data => data.portal !== "bpo" || Boolean(data.email), {
  message: "Email is required for a BPO account.",
  path: ["email"],
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.portal !== "bpo") return Response.json({ message: "Please register through the BPO workspace." }, { status: 403 });
    const parsed = schema.safeParse(body);
    if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Please complete all required fields correctly." }, { status: 400 });

    const data = parsed.data;
    const client = await db();
    const existing = await client.query(
      "SELECT id FROM agents WHERE name=$1 OR username=$2 OR ($3<>'' AND email=$3) LIMIT 1",
      [data.name, data.username, data.email || ""],
    );
    if (existing.rowCount) return Response.json({ message: "Name, email or username is already in use." }, { status: 409 });

    const isBpo = data.portal === "bpo";
    const passwordHash = await hash(data.password, 12);
    let verificationToken: string | undefined;
    if (isBpo) {
      const delivery = await deliverEmailOtp(data.email!, "bpo-registration", async code => {
        const content = bpoVerificationEmail({ name: data.name, code });
        await sendMail(data.email!, content.subject, content.text, content.html);
      });
      verificationToken = await createBpoRegistrationToken({ name: data.name, username: data.username, email: data.email!, phone: data.phone || "", passwordHash, challengeId: delivery.challengeId });
    } else {
      await client.query(
        "INSERT INTO agents (id,name,username,email,phone,password_hash,gender,accent,role,status,email_verified) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'AGENT','PENDING',TRUE)",
        [randomUUID(), data.name, data.username, data.email || null, data.phone || null, passwordHash, data.gender || "OTHER", data.accent || "Professional"],
      );
    }

    return Response.json({
      message: isBpo ? "OTP sent to your email. Enter it below to verify your account." : "Registration received. Your account is pending admin approval.",
      verificationToken,
      retryAfter: isBpo ? 60 : undefined,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof OtpLimitError) return Response.json({ message: error.message, retryAfter: error.retryAfter }, { status: 429, headers: { "Retry-After": String(error.retryAfter) } });
    console.error("BPO registration error:", error);
    return Response.json({ message: "Unable to create account right now." }, { status: 503 });
  }
}
