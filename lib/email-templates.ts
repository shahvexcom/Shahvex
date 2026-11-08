function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

const supportEmail = "support@Shahvex.com";
const supportPhone = "+92 302 9333326";
const emailHead = `<head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><style>@media only screen and (max-width:620px){.email-shell{padding:14px 7px!important}.email-card{border-radius:12px!important}.email-card>tbody>tr>td{padding-left:18px!important;padding-right:18px!important}.email-action{display:block!important;text-align:center!important}}</style></head>`;

export function formatPkr(value: number) {
  return `PKR ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function creditLoadedEmail({ name, amount, balance, loadedAt }: { name: string; amount: number; balance: number; loadedAt: Date }) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.Shahvex.com").replace(/\/$/, "");
  const safeName = escapeHtml(name);
  const amountLabel = formatPkr(amount);
  const balanceLabel = formatPkr(balance);
  const timeLabel = new Intl.DateTimeFormat("en-PK", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Karachi" }).format(loadedAt);
  const subject = `${amountLabel} credits added to your Shahvex account`;
  const text = `Hi ${name},\n\n${amountLabel} credits have been added to your BPO account.\n\nAvailable balance: ${balanceLabel}\nAdded on: ${timeLabel} (PKT)\n\nBalances and charges are billed in Pakistani rupees.\n\nOpen your workspace: ${siteUrl}/bpo\n\nShahvex`;
  const html = `<!doctype html>
<html>${emailHead}<body style="margin:0;padding:0;background:#fff7f0;font-family:Arial,Helvetica,sans-serif;color:#413932">
  <table class="email-shell" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7f0;padding:32px 14px"><tr><td align="center">
    <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border:1px solid #f2eae3;border-radius:18px;overflow:hidden;box-shadow:0 12px 35px rgba(232, 82, 10,.08)">
      <tr><td style="padding:24px 30px;border-bottom:1px solid #f8f0e9;background:#ffffff">
        <img src="cid:shahvex-logo@shahvex" width="150" alt="Shahvex" style="display:block;width:150px;max-width:100%;height:auto;border:0" />
      </td></tr>
      <tr><td style="padding:34px 30px 12px">
        <div style="display:inline-block;padding:7px 11px;border-radius:999px;background:#e9f8f1;color:#14845f;font-size:11px;font-weight:700;letter-spacing:.3px">CREDIT SUCCESSFULLY LOADED</div>
        <h1 style="margin:18px 0 10px;color:#3a322b;font-size:26px;line-height:1.25">Your PKR balance is ready</h1>
        <p style="margin:0;color:#888079;font-size:14px;line-height:1.7">Hi ${safeName}, an administrator has added credits to your BPO account.</p>
      </td></tr>
      <tr><td style="padding:18px 30px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f7efe8;border-radius:14px;background:#fffaf3">
          <tr><td style="padding:21px 22px;border-bottom:1px solid #f4ece5;color:#8c847d;font-size:12px">Credits added</td><td align="right" style="padding:21px 22px;border-bottom:1px solid #f4ece5;color:#e96016;font-size:24px;font-weight:800">${amountLabel}</td></tr>
          <tr><td style="padding:17px 22px;color:#8c847d;font-size:12px">Available balance</td><td align="right" style="padding:17px 22px;color:#423a33;font-size:16px;font-weight:800">${balanceLabel}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:4px 30px 26px">
        <p style="margin:0 0 18px;color:#a79f98;font-size:11px;line-height:1.6">Added on ${timeLabel} (PKT). <strong style="color:#817972">PKR</strong> is the billing currency used inside Shahvex.</p>
        <a class="email-action" href="${siteUrl}/bpo" style="display:inline-block;padding:13px 19px;border-radius:9px;background:#e96016;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none">Open BPO workspace</a>
      </td></tr>
      <tr><td style="padding:20px 30px;background:#3a322b;color:#c3bbb4;font-size:10px;line-height:1.7">This is an automated notification from Shahvex.<br><a href="mailto:${supportEmail}" style="color:#fff;text-decoration:none">${supportEmail}</a> &nbsp;·&nbsp; <a href="tel:+923029333326" style="color:#fff;text-decoration:none">${supportPhone}</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, text, html };
}

export function creditReducedEmail({ name, amount, balance, adjustedAt }: { name: string; amount: number; balance: number; adjustedAt: Date }) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.Shahvex.com").replace(/\/$/, "");
  const safeName = escapeHtml(name);
  const amountLabel = formatPkr(amount);
  const balanceLabel = formatPkr(balance);
  const timeLabel = new Intl.DateTimeFormat("en-PK", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Karachi" }).format(adjustedAt);
  const subject = `${amountLabel} credit adjustment on your Shahvex account`;
  const text = `Hi ${name},\n\nAn administrator corrected your BPO credit balance by removing ${amountLabel}.\n\nAvailable balance: ${balanceLabel}\nAdjusted on: ${timeLabel} (PKT)\n\nPKR is the account credit currency used inside Shahvex.\n\nOpen your workspace: ${siteUrl}/bpo\n\nShahvex`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#fff7f0;font-family:Arial,Helvetica,sans-serif;color:#413932"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 14px;background:#fff7f0"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;overflow:hidden;border:1px solid #f2eae3;border-radius:18px;background:#fff"><tr><td style="padding:24px 30px;border-bottom:1px solid #f8f0e9"><img src="cid:shahvex-logo@shahvex" width="150" alt="Shahvex" style="display:block;width:150px;max-width:100%;height:auto;border:0" /></td></tr><tr><td style="padding:32px 30px 12px"><div style="display:inline-block;padding:7px 11px;border-radius:999px;background:#fff1f2;color:#bd4b57;font-size:11px;font-weight:700">CREDIT BALANCE ADJUSTED</div><h1 style="margin:18px 0 10px;color:#3a322b;font-size:25px">Your PKR balance was corrected</h1><p style="margin:0;color:#888079;font-size:14px;line-height:1.7">Hi ${safeName}, an administrator corrected credits previously added to your BPO account.</p></td></tr><tr><td style="padding:18px 30px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0dfe2;border-radius:14px;background:#fff8f8"><tr><td style="padding:21px 22px;border-bottom:1px solid #f0dfe2;color:#8c847d;font-size:12px">Credits removed</td><td align="right" style="padding:21px 22px;border-bottom:1px solid #f0dfe2;color:#c34d59;font-size:23px;font-weight:800">${amountLabel}</td></tr><tr><td style="padding:17px 22px;color:#8c847d;font-size:12px">Available balance</td><td align="right" style="padding:17px 22px;color:#423a33;font-size:16px;font-weight:800">${balanceLabel}</td></tr></table></td></tr><tr><td style="padding:4px 30px 27px"><p style="margin:0 0 18px;color:#a79f98;font-size:11px;line-height:1.6">Adjusted on ${timeLabel} (PKT). Balances and charges are billed in Pakistani rupees.</p><a href="${siteUrl}/bpo" style="display:inline-block;padding:13px 19px;border-radius:9px;background:#e96016;color:#fff;font-size:13px;font-weight:700;text-decoration:none">Open BPO workspace</a></td></tr><tr><td style="padding:20px 30px;background:#3a322b;color:#c3bbb4;font-size:10px;line-height:1.6">If you have a question about this adjustment, please contact your workspace administrator.</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

type NoticeDetail = { label: string; value: string; emphasize?: boolean };

type BrandedNoticeOptions = {
  subject: string;
  name: string;
  badge: string;
  title: string;
  message: string;
  details?: NoticeDetail[];
  note?: string;
  actionLabel?: string;
  actionPath?: string;
  tone?: "purple" | "green" | "orange" | "red";
};

const noticeTones = {
  purple: { accent: "#e96016", soft: "#fff8f1", border: "#f7efe8" },
  green: { accent: "#14845f", soft: "#eaf8f2", border: "#d6efe5" },
  orange: { accent: "#a96510", soft: "#fff6e7", border: "#f4e2bd" },
  red: { accent: "#bd4b57", soft: "#fff1f2", border: "#f0dadd" },
} as const;

function pakistanTime(value: Date) {
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(value);
}

function brandedNoticeEmail(options: BrandedNoticeOptions) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.Shahvex.com").replace(/\/$/, "");
  const tone = noticeTones[options.tone || "purple"];
  const details = options.details || [];
  const actionUrl = `${siteUrl}${options.actionPath || "/bpo"}`;
  const detailText = details.map(detail => `${detail.label}: ${detail.value}`).join("\n");
  const text = `Hi ${options.name},\n\n${options.message}${detailText ? `\n\n${detailText}` : ""}${options.note ? `\n\n${options.note}` : ""}${options.actionLabel ? `\n\n${options.actionLabel}: ${actionUrl}` : ""}\n\nShahvex`;
  const detailRows = details.map((detail, index) => `<tr><td style="padding:16px 20px;${index < details.length - 1 ? `border-bottom:1px solid ${tone.border};` : ""}color:#8c847d;font-size:12px">${escapeHtml(detail.label)}</td><td align="right" style="padding:16px 20px;${index < details.length - 1 ? `border-bottom:1px solid ${tone.border};` : ""}color:${detail.emphasize ? tone.accent : "#423a33"};font-size:${detail.emphasize ? "19px" : "13px"};font-weight:800">${escapeHtml(detail.value)}</td></tr>`).join("");
  const html = `<!doctype html>
<html>${emailHead}<body style="margin:0;padding:0;background:#fff7f0;font-family:Arial,Helvetica,sans-serif;color:#413932">
  <table class="email-shell" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 14px;background:#fff7f0"><tr><td align="center">
    <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;overflow:hidden;border:1px solid #f2eae3;border-radius:18px;background:#fff;box-shadow:0 12px 35px rgba(232, 82, 10,.08)">
      <tr><td style="padding:24px 30px;border-bottom:1px solid #f8f0e9"><img src="cid:shahvex-logo@shahvex" width="150" alt="Shahvex" style="display:block;width:150px;max-width:100%;height:auto;border:0" /></td></tr>
      <tr><td style="padding:32px 30px 12px"><div style="display:inline-block;padding:7px 11px;border-radius:999px;background:${tone.soft};color:${tone.accent};font-size:11px;font-weight:800;letter-spacing:.35px">${escapeHtml(options.badge)}</div><h1 style="margin:18px 0 10px;color:#3a322b;font-size:25px;line-height:1.25">${escapeHtml(options.title)}</h1><p style="margin:0;color:#888079;font-size:14px;line-height:1.7">Hi ${escapeHtml(options.name)}, ${escapeHtml(options.message)}</p></td></tr>
      ${detailRows ? `<tr><td style="padding:18px 30px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tone.border};border-radius:14px;background:${tone.soft}">${detailRows}</table></td></tr>` : ""}
      <tr><td style="padding:8px 30px 28px">${options.note ? `<p style="margin:0 0 18px;color:#a19992;font-size:11px;line-height:1.65">${escapeHtml(options.note)}</p>` : ""}${options.actionLabel ? `<a href="${actionUrl}" style="display:inline-block;padding:13px 19px;border-radius:9px;background:${tone.accent};color:#fff;font-size:13px;font-weight:700;text-decoration:none">${escapeHtml(options.actionLabel)}</a>` : ""}</td></tr>
      <tr><td style="padding:20px 30px;background:#3a322b;color:#c3bbb4;font-size:10px;line-height:1.7">This is an automated notification from Shahvex.<br><a href="mailto:${supportEmail}" style="color:#fff;text-decoration:none">${supportEmail}</a> &nbsp;·&nbsp; <a href="tel:+923029333326" style="color:#fff;text-decoration:none">${supportPhone}</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject: options.subject, text, html };
}

export function bpoVerificationEmail({ name, code, expiresInMinutes = 10 }: { name: string; code: string; expiresInMinutes?: number }) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.shahvex.com").replace(/\/$/, "");
  const safeName = escapeHtml(name), safeCode = escapeHtml(code);
  const subject = `${code} is your Shahvex verification code`;
  const text = `Hi ${name},\n\nYour Shahvex verification code is ${code}.\nEnter this code in the BPO registration page. It expires in ${expiresInMinutes} minutes and can only be used once.\n\nNever share your code. If you did not request it, you can ignore this email.\n\nShahvex`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>Verify your Shahvex email</title><style>@media screen and (min-width:600px){.otp-body{padding:40px!important}.otp-shell{padding:36px 20px!important}.otp-title{font-size:30px!important}}@media screen and (max-width:350px){.otp-code{font-size:28px!important;letter-spacing:5px!important}}</style></head>
<body style="margin:0;padding:0;background:#efe9e2;font-family:Arial,Helvetica,sans-serif;color:#422717;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Your verification code expires in ${expiresInMinutes} minutes. Complete your Shahvex registration.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="otp-shell" style="width:100%;padding:20px 12px;background:#efe9e2"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;border:1px solid #ffffff;border-radius:22px;background:#fffaf4;overflow:hidden;box-shadow:6px 6px 20px #d2cac0">
<tr><td style="height:5px;background:#ed5a10;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td class="otp-body" style="padding:28px 22px">
<img src="cid:shahvex-logo@shahvex" width="180" height="60" alt="Shahvex" style="display:block;width:180px;max-width:100%;height:auto;border:0;margin-bottom:30px">
<p style="margin:0 0 12px;color:#a23a08;font-size:11px;font-weight:700;letter-spacing:1.8px">EMAIL VERIFICATION</p>
<h1 class="otp-title" style="margin:0 0 16px;font-size:26px;line-height:1.25;letter-spacing:-.6px;color:#422717">One code. You’re connected.</h1>
<p style="margin:0 0 24px;color:#6e5747;font-size:15px;line-height:1.8;overflow-wrap:anywhere">Hi ${safeName},<br>Enter this code on your BPO registration page to verify your email and continue setting up your workspace.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dfcbbb;border-radius:16px;background:#f3e7db"><tr><td align="center" style="padding:24px 12px"><p style="margin:0 0 12px;color:#79604d;font-size:10px;font-weight:700;letter-spacing:1.4px">YOUR ONE-TIME CODE</p><div class="otp-code" style="color:#a23a08;font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:7px;line-height:1.5;white-space:nowrap">${safeCode}</div><p style="margin:12px 0 0;color:#6e5747;font-size:12px;line-height:1.6">Valid for <strong>${expiresInMinutes} minutes</strong> &middot; Single use</p></td></tr></table>
<p style="margin:24px 0 0;color:#6e5747;font-size:13px;line-height:1.8"><strong style="color:#513625">Keep your code private.</strong><br>Shahvex will never ask you to share this code. If you didn’t request it, you can safely ignore this email.</p>
</td></tr><tr><td style="padding:22px;border-top:1px solid #e4d5c6;background:#f3ece4;text-align:center"><p style="margin:0;color:#79604d;font-size:12px;line-height:1.8">Every Call. A New Opportunity.<br><a href="${siteUrl}" style="color:#a23a08;text-decoration:none;font-weight:700">Shahvex</a></p></td></tr>
</table><p style="margin:20px 0 0;color:#79604d;font-size:11px;line-height:1.8">This verification email was sent by Shahvex.</p></td></tr></table></body></html>`;
  return { subject, text, html };
}

export function bpoRegistrationEmail({ name, email }: { name: string; email: string }) {
  return brandedNoticeEmail({
    subject: "Your Shahvex BPO registration was received",
    name,
    badge: "REGISTRATION RECEIVED",
    title: "Welcome to Shahvex",
    message: "your BPO registration has been received successfully. Verify your email to activate access to the workspace.",
    details: [{ label: "Account type", value: "BPO workspace" }, { label: "Next step", value: "Verify email" }],
    actionLabel: "Open verification page",
    actionPath: `/bpo/register?verify=1&email=${encodeURIComponent(email)}`,
    tone: "purple",
  });
}

export function bpoEmailVerifiedEmail({ name }: { name: string }) {
  return brandedNoticeEmail({
    subject: "Your Shahvex email is verified",
    name,
    badge: "EMAIL VERIFIED",
    title: "Your BPO workspace is ready",
    message: "your email address has been verified successfully. You can now sign in to your BPO workspace.",
    details: [{ label: "Account status", value: "Active", emphasize: true }],
    actionLabel: "Sign in to BPO",
    actionPath: "/bpo/login",
    tone: "green",
  });
}

export function twoFactorStatusEmail({ name, enabled, changedAt }: { name: string; enabled: boolean; changedAt: Date }) {
  return brandedNoticeEmail({
    subject: `Shahvex two-factor authentication ${enabled ? "enabled" : "disabled"}`,
    name,
    badge: "SECURITY UPDATE",
    title: `Two-factor authentication ${enabled ? "enabled" : "disabled"}`,
    message: `two-factor authentication was ${enabled ? "enabled on" : "disabled for"} your BPO account.`,
    details: [{ label: "Security status", value: enabled ? "2FA enabled" : "2FA disabled", emphasize: true }, { label: "Changed on", value: `${pakistanTime(changedAt)} PKT` }],
    note: enabled ? "Your account now requires an authenticator code when you sign in." : "Your account will no longer request an authenticator code when you sign in.",
    actionLabel: "Review account settings",
    actionPath: "/bpo",
    tone: enabled ? "green" : "orange",
  });
}

export function bpoFilesUploadedEmail({ name, script, leads, uploadedAt }: { name: string; script: { name: string; size: string; format: string }; leads: { name: string; size: string; format: string }; uploadedAt: Date }) {
  return brandedNoticeEmail({
    subject: "Your BPO files were uploaded successfully",
    name,
    badge: "UPLOAD COMPLETE",
    title: "Your calling files are ready",
    message: "your agent script and leads sheet were uploaded and saved to your BPO workspace.",
    details: [
      { label: "Agent script", value: `${script.name} (${script.size}, ${script.format})` },
      { label: "Leads sheet", value: `${leads.name} (${leads.size}, ${leads.format})` },
      { label: "Uploaded on", value: `${pakistanTime(uploadedAt)} PKT` },
    ],
    actionLabel: "Open BPO workspace",
    actionPath: "/bpo",
    tone: "green",
  });
}

export function bpoBlockedEmail({ name, reason, blockedAt }: { name: string; reason: string; blockedAt: Date }) {
  return brandedNoticeEmail({
    subject: "Your Shahvex BPO account was blocked",
    name,
    badge: "ACCOUNT BLOCKED",
    title: "Access to your BPO account is paused",
    message: "an administrator has blocked access to your BPO workspace.",
    details: [{ label: "Reason", value: reason }, { label: "Blocked on", value: `${pakistanTime(blockedAt)} PKT` }],
    note: "If you believe this was a mistake, please contact your workspace administrator or support team.",
    tone: "red",
  });
}

export function bpoApprovedEmail({ name, approvedAt }: { name: string; approvedAt: Date }) {
  return brandedNoticeEmail({
    subject: "Your Shahvex BPO account is active again",
    name,
    badge: "ACCESS RESTORED",
    title: "Your BPO account has been approved",
    message: "an administrator restored access to your BPO workspace. You can sign in and continue working.",
    details: [{ label: "Account status", value: "Approved", emphasize: true }, { label: "Restored on", value: `${pakistanTime(approvedAt)} PKT` }],
    actionLabel: "Sign in to BPO",
    actionPath: "/bpo/login",
    tone: "green",
  });
}

export function bpoDeletedEmail({ name, deletedAt }: { name: string; deletedAt: Date }) {
  return brandedNoticeEmail({
    subject: "Your Shahvex BPO account was deleted",
    name,
    badge: "ACCOUNT DELETED",
    title: "Your BPO account has been removed",
    message: "an administrator deleted your BPO account and workspace access is no longer available.",
    details: [{ label: "Deleted on", value: `${pakistanTime(deletedAt)} PKT` }],
    note: "If you believe this was a mistake, please contact the Shahvex support team.",
    tone: "red",
  });
}
