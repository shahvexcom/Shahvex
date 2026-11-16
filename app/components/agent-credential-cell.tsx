"use client";
import { useState } from "react";
import { AgentTestPanel } from "./agent-test-panel";
export function AgentCredentialCell({agentId,agentName,avatarUrl}: {agentId:string;agentName?:string;avatarUrl?:string;groqLabel?:string;telnyxLabel?:string}) {
  const [voice,setVoice] = useState("");
  return <div className="agent-credential-summary"><AgentTestPanel agentId={agentId} agentName={agentName} avatarUrl={avatarUrl} onVoiceChange={setVoice}/><small>{voice ? `Local voice: ${voice}` : "Local voice: select in tester"}</small></div>;
}
