import nodemailer from "nodemailer";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const sender = () => process.env.PRIVATE_EMAIL_USER?.trim() || "shahvex1@gmail.com";
const mailer = () => nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user: sender(), pass: process.env.PRIVATE_EMAIL_PASSWORD?.replace(/\s/g, "") },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
});

export async function sendMail(to: string, subject: string, text: string, html?: string, replyTo?: string) {
  if (!process.env.PRIVATE_EMAIL_PASSWORD?.trim()) throw new Error("Gmail is not configured. Set PRIVATE_EMAIL_PASSWORD to a Google App Password.");
  await mailer().sendMail({
    from: `Shahvex <${sender()}>`,
    to,
    subject,
    text,
    ...(html ? {
      html,
      ...(html.includes("cid:shahvex-logo@shahvex") ? {
        attachments: [{
          filename: "shahvex-logo.png",
          content: await readFile(join(process.cwd(), "public", "img", "email-logo.png")),
          contentType: "image/png",
          contentDisposition: "inline" as const,
          cid: "shahvex-logo@shahvex",
        }],
      } : {}),
    } : {}),
    ...(replyTo ? { replyTo } : {}),
  });
}
