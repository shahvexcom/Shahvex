import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, AGENT_SESSION_COOKIE, BPO_SESSION_COOKIE, readSession } from "./lib/session";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const userAgent = request.headers.get("user-agent") || "";
  const isSocialCrawler = /facebookexternalhit|facebot|WhatsApp|Twitterbot|LinkedInBot|Slackbot|TelegramBot|Discordbot|Googlebot/i.test(userAgent);
  // Social networks must receive the public HTML head to read OG title, description and image.
  if (pathname === "/" && isSocialCrawler) return NextResponse.next();

  const agentSession = await readSession(request.cookies.get(AGENT_SESSION_COOKIE)?.value);
  const bpoSession = await readSession(request.cookies.get(BPO_SESSION_COOKIE)?.value);
  const adminSession = await readSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
  const isAgentAuthPage = pathname === "/login" || pathname === "/register";
  const isBpoAuthPage = pathname === "/bpo/login" || pathname === "/bpo/register";
  const isAdminAuthPage = pathname === "/controler/login";
  const isAgentPage = pathname.startsWith("/agent");
  const isBopPage = pathname.startsWith("/bpo");
  const isAdminPage = !isAdminAuthPage && (pathname === "/controler" || pathname.startsWith("/controler/"));

  if (isAgentAuthPage && agentSession?.role === "AGENT") {
    return NextResponse.redirect(new URL("/bpo/login", request.url));
  }
  if (isAdminAuthPage && adminSession?.role === "ADMIN") {
    return NextResponse.redirect(new URL("/controler", request.url));
  }
  if (isBpoAuthPage && bpoSession?.role === "BPO") {
    return NextResponse.redirect(new URL("/bpo", request.url));
  }
  if (isAgentPage || isAgentAuthPage) {
    return NextResponse.redirect(new URL(pathname === "/register" ? "/bpo/register" : "/bpo/login", request.url));
  }
  if (isBopPage && !isBpoAuthPage && (!bpoSession || bpoSession.role !== "BPO")) return NextResponse.redirect(new URL("/bpo/login", request.url));
  if (isAdminPage && (!adminSession || adminSession.role !== "ADMIN")) {
    return NextResponse.redirect(new URL("/controler/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/login", "/register", "/auth", "/agent/:path*", "/bpo/:path*", "/controler", "/controler/:path*"] };

