import { contactConfirmationEmail, contactTeamEmail } from "@/lib/contact-email-templates";
import { sendMail } from "@/lib/email";
import { z } from "zod";

const contactSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  company: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  subject: z.enum(["Product demo", "BPO operations", "Pricing and plans", "Technical question", "Other enquiry"]),
  message: z.string().trim().min(10).max(2000),
  website: z.string().max(0).optional().default(""),
});

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 10_000) return Response.json({ message: "Request is too large." }, { status: 413 });
    const parsed = contactSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ message: "Please check the form and try again." }, { status: 400 });

    const { name, email, company, phone, subject, message } = parsed.data;
    const recipient = process.env.CONTACT_EMAIL || "support@Shahvex.com";
    const details = { name, email, company, phone, subject, message };
    const teamEmail = contactTeamEmail(details);
    const confirmationEmail = contactConfirmationEmail(details);

    await Promise.all([
      sendMail(recipient, teamEmail.subject, teamEmail.text, teamEmail.html, email),
      sendMail(email, confirmationEmail.subject, confirmationEmail.text, confirmationEmail.html, recipient),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Contact form submission failed", error);
    return Response.json({ message: "Unable to send your message right now. Please try again." }, { status: 500 });
  }
}
