import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";
import { db } from "@/lib/database";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  if (!session || session.role !== "ADMIN") return Response.json({ message: "Unauthenticated" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ message: "Same-origin request required" }, { status: 403 });
  const admin = (await (await db()).query("SELECT admin_role,admin_permissions FROM agents WHERE id=$1 AND role='ADMIN' AND status='APPROVED'", [session.agentId])).rows[0];
  if (!admin || (admin.admin_role !== "SUPER_ADMIN" && !admin.admin_permissions?.some((p: string) => ["dashboard", "reports", "agents"].includes(p)))) return Response.json({ message: "Report access denied" }, { status: 403 });
  let browser;
  try {
    const raw = await request.text();
    if (raw.length > 10_000_000) return Response.json({ message: "Report is too large for PDF. Use Excel or CSV." }, { status: 413 });
    const { html } = JSON.parse(raw);
    if (typeof html !== "string") return Response.json({ message: "Report content required" }, { status: 400 });
    const logo = await readFile(path.join(process.cwd(), "public/img/logo.png.png"));
    const content = html.replace(/<img\b[^>]*>/gi, `<img src="data:image/png;base64,${logo.toString("base64")}" alt="Shahvex AI">`);
    if (process.platform === "win32") browser = await chromium.launch({ channel: "msedge", headless: true });
    else {
      const serverChromium = (await import("@sparticuz/chromium")).default;
      browser = await chromium.launch({ executablePath: await serverChromium.executablePath(), args: serverChromium.args, headless: true });
    }
    const page = await browser.newPage({ javaScriptEnabled: false });
    // Reports cannot access network services or local files through the renderer.
    await page.route("**/*", route => route.abort());
    await page.setContent(content, { waitUntil: "load", timeout: 15000 });
    const pdf = await page.pdf({ format: "A4", landscape: true, printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: '<div style="width:100%;text-align:right;margin:0 35px;font-size:8px;color:#92745b">SHAHVEX AI · Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>', margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" } });
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="shahvex-report.pdf"', "Cache-Control": "no-store" } });
  } catch { return Response.json({ message: "Unable to generate PDF. Please retry or choose Excel or Word." }, { status: 503 }); }
  finally { await browser?.close(); }
}
