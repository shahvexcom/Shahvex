import type { Metadata } from "next";
import { AgentTestPanel } from "@/app/components/agent-test-panel";
import { demoLink } from "@/lib/agent-demo";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Private agent test", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function AgentDemoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await demoLink(token);
  if (!link) notFound();
  return <main className="admin-card" style={{ maxWidth: 780, margin: "8vh auto", padding: 32 }}>
    <p>SHAHVEX · PRIVATE AGENT TEST</p><h1>{link.name}</h1>
    <p>Have a voice conversation with your assigned agent. You can end the session and download your recording at any time. Sessions last up to 15 minutes.</p>
    <AgentTestPanel agentId={link.agent_id} agentName={link.name} avatarUrl={link.avatar_url || ""} demoToken={token}/>
  </main>;
}
