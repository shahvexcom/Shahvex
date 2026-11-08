import { readBpoRegistrationToken } from "@/lib/bpo-registration-token";
import { deliverEmailOtp, OtpLimitError } from "@/lib/email-otp";
import { sendMail } from "@/lib/email";
import { bpoVerificationEmail } from "@/lib/email-templates";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const pending = await readBpoRegistrationToken(String(body.token || ""));
    if (!pending?.challengeId) return Response.json({ message: "Verification session expired. Please register again." }, { status: 400 });
    const result = await deliverEmailOtp(pending.email, "bpo-registration", async code => {
      const content = bpoVerificationEmail({ name: pending.name, code });
      await sendMail(pending.email, content.subject, content.text, content.html);
    }, pending.challengeId);
    return Response.json({ message: "A new OTP has been emailed. Use the latest code.", ...result });
  } catch (error) {
    if (error instanceof OtpLimitError) return Response.json({ message: error.message, retryAfter: error.retryAfter }, { status: 429, headers: { "Retry-After": String(error.retryAfter) } });
    return Response.json({ message: "Could not resend the code. Please try again." }, { status: 503 });
  }
}
