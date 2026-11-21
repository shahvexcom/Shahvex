import { pcAiRequest } from "./pc-ai-engine";
import { briefAgentOpening, rephrasedAgentOpening } from "./agent-context-answer";
import { streamAgentReply } from "./agent-test-stream";
import "server-only";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { db } from "./database";
import { decryptCredential } from "./credential-crypto";
import { vicidialRequest, requireVicidialSuccess } from "./vicidial";
import { vicidialLiveConfig, missingVicidialSetup } from "./vicidial-config";
import { requestBridge } from "./vicidial-bridge";
import { scriptHash } from "./vicidial-leads";
import { extractAgentScript } from "./agent-script-extraction";
import { engine, localVoices, warmSelectedVoice, type TestConfig } from "./agent-test";
import { markAgentReady } from "./agent-runtime";
import {
  scriptTestConfig,
  defaultInitialScript,
  initialScriptDetails,
} from "./agent-script-details";
import { campaignSettings } from "./campaign-config";
import { bpoEntitlements, bpoLeadUsage } from "./bpo-entitlements";

export async function assignedVicidial(
  agentId: string,
  client?: Pick<PoolClient, "query">,
) {
  return (
    await (client || (await db())).query(
      `SELECT c.*,v.campaign_id,v.direction FROM voip_agent_assignments v
    JOIN voip_connections c ON c.id=v.connection_id AND c.owner_id=v.owner_id WHERE v.agent_id=$1`,
      [agentId],
    )
  ).rows[0];
}
export async function startVicidialAgent(
  agentId: string,
  options: {
    bpoId?: string;
    dialingSource?: "MANUAL" | "AUTO";
    maxCallDurationSeconds?: number;
  } = {},
) {
  const pool = await db(),
    client = await pool.connect();
  let lock = "";
  try {
    const c = await assignedVicidial(agentId, client);
    if (
      !c ||
      !c.enabled ||
      c.status !== "CONNECTED" ||
      c.direction !== "OUTBOUND"
    )
      throw Error("Assign and verify an outbound VICIdial connection first");
    if (!c.campaign_id?.trim())
      throw Error("Assign a campaign before starting this agent");
    const missing = missingVicidialSetup(
      c.live_config,
      Boolean(c.bridge_secret_ciphertext),
    );
    if (missing.length || !c.media_verified_at)
      throw Error(
        `Complete VoIP setup: ${[...missing, ...(!c.media_verified_at ? ["Test audio bridge"] : [])].join(", ")}`,
      );
    const live = vicidialLiveConfig.parse(c.live_config);
    if (
      live.directAudioMode &&
      !live.directAudioLines.some((line) => line.agentId === agentId)
    )
      throw Error(
        "Assign a dedicated extension route to this agent before starting",
      );
    const mapped = (
      await client.query(
        `SELECT d.*,x.enabled assignment_enabled FROM campaign_agent_assignments x JOIN campaign_definitions d ON d.id=x.campaign_id WHERE x.agent_id=$1`,
        [agentId],
      )
    ).rows[0];
    if (
      mapped &&
      (mapped.deleted_at ||
        mapped.intake_state !== "RUNNING" ||
        !mapped.enabled ||
        !mapped.validated_at ||
        mapped.connection_id !== c.id ||
        mapped.external_campaign_id !== c.campaign_id)
    )
      throw Error(
        "Validate and enable the exact campaign mapping before starting this agent",
      );

    lock = `vicidial:${c.id}`;
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
      lock,
    ]);
    const found = await client.query(
      `SELECT a.id,a.name,a.local_voice_id,a.speaks_first,a.conversation_style,a.daily_call_limit,
      COALESCE(NULLIF(BTRIM(a.agent_script),''),s.script_text,'') script_text,b.bpo_id,b.is_active,b.dialing_mode
      FROM agents a LEFT JOIN LATERAL (SELECT * FROM script_assignments WHERE agent_id=a.id ORDER BY created_at DESC LIMIT 1) s ON TRUE
      LEFT JOIN bpo_created_agents b ON b.agent_id=a.id WHERE a.id=$1 AND a.role='AGENT' AND a.deleted_at IS NULL AND a.status='APPROVED'`,
      [agentId],
    );
    const a = found.rows[0];
    if (a && mapped?.script?.trim()) a.script_text = mapped.script;
    if (!a || !a.local_voice_id)
      throw Error(
        "An approved agent and testing-compatible local voice are required",
      );
    const usesInitialScript = !a.script_text?.trim();
    if (usesInitialScript) {
      const settings = await client.query(
        "SELECT initial_script FROM live_monitor_settings WHERE owner_id=$1",
        [c.owner_id],
      );
      a.script_text =
        settings.rows[0]?.initial_script?.trim() || defaultInitialScript;
    }
    if (
      (a.bpo_id || undefined) !== options.bpoId ||
      (options.bpoId &&
        (!a.is_active ||
          ![options.dialingSource, "BOTH"].includes(a.dialing_mode)))
    )
      throw Error(
        "Agent does not belong to this calling workspace or dialing mode",
      );
    if (options.bpoId) {
      const [limits, usage] = await Promise.all([
        bpoEntitlements(client, options.bpoId),
        bpoLeadUsage(client, options.bpoId),
      ]);
      if (
        usage.calls >= limits.calls ||
        usage.minutes >= limits.minutes ||
        usage.recordings >= limits.recordings
      )
        throw Error("Purchased calls, minutes or recordings allowance reached");
    }
    const counts = await client.query(
      "SELECT COUNT(*) FILTER (WHERE created_at>=date_trunc('day',NOW()))::int today,COUNT(*) FILTER (WHERE status IN ('INITIATED','RINGING','ANSWERED'))::int active FROM agent_calls WHERE agent_id=$1",
      [agentId],
    );
    if (counts.rows[0]?.active)
      throw Error("This agent already has a live call");
    if (Number(counts.rows[0]?.today) >= a.daily_call_limit)
      throw Error("Daily call limit reached");
    const sheet = "VICIDIAL_MANAGED",
      script = scriptHash(a.script_text);
    const saved = await client.query(
      `INSERT INTO vicidial_pools(id,connection_id,owner_id,campaign_id,list_id,sheet_hash,script_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(connection_id,campaign_id,list_id,sheet_hash,script_hash) DO UPDATE SET sheet_hash=EXCLUDED.sheet_hash RETURNING id`,
      [randomUUID(), c.id, c.owner_id, c.campaign_id, "", sheet, script],
    );
    const poolId = saved.rows[0].id;
    const existing = await client.query(
      `SELECT q.agent_id,q.remote_user,q.pool_id,q.ready,p.connection_id,p.owner_id,p.campaign_id
       FROM vicidial_pool_agents q JOIN vicidial_pools p ON p.id=q.pool_id
       WHERE q.agent_id=$1 OR p.connection_id=$2`,
      [agentId, c.id],
    );
    const own = existing.rows.find((r) => r.agent_id === agentId);
    const directLine = live.directAudioLines.find(
      (line) => line.agentId === agentId,
    );
    const remoteUser =
      own?.remote_user ||
      directLine?.remoteUser ||
      live.remoteUsers.find(
        (user) =>
          !existing.rows.some((r) => r.remote_user === user) &&
          !live.directAudioLines.some(
            (line) => line.remoteUser === user && line.agentId !== agentId,
          ),
      );
    if (
      directLine &&
      (directLine.remoteUser !== remoteUser ||
        existing.rows.some(
          (r) => r.agent_id !== agentId && r.remote_user === remoteUser,
        ))
    )
      throw Error(
        "The dedicated prefix line belongs to another agent; stop and correct its mapping first",
      );
    if (!remoteUser || !live.remoteUsers.includes(remoteUser))
      throw Error(
        "No dedicated VICIdial remote user is available; add another Remote Agent user in VoIP",
      );
    const canRefreshIdlePool = own && !own.ready &&
      own.connection_id === c.id && own.owner_id === c.owner_id && own.campaign_id === c.campaign_id;
    if (own && own.pool_id !== poolId && !canRefreshIdlePool)
      throw Error(
        "Stop the existing VICIdial queue before changing this agent's campaign or script",
      );
    if (
      !(await localVoices(c.owner_id)).voices.some(
        (v) => v.id === a.local_voice_id,
      )
    )
      throw Error("Assigned voice is not available to this workspace");
    const details = usesInitialScript
      ? initialScriptDetails(a.script_text)
      : await extractAgentScript(
          c.owner_id,
          a.script_text,
          AbortSignal.timeout(120000),
        );
    const config: TestConfig = scriptTestConfig(
      {
        name: a.name,
        voice: a.local_voice_id,
        first: "ai",
        script: a.script_text,
        style: a.conversation_style || "Professional",
      },
      details,
    );
    await warmSelectedVoice(config.voice);
    const opening = briefAgentOpening(config);
    if (opening) {
      const signal = AbortSignal.timeout(45_000);
      if (process.env.SHAHVEX_PC_AI_URL) {
        const prepared = await pcAiRequest("/tester/prepare-opening", {
          method:"POST", signal, headers:{"content-type":"application/json"}, body:JSON.stringify(config),
        }, c.owner_id);
        if (!prepared.ok) throw Error("Agent opening audio could not be prepared");
        await prepared.body?.cancel();
      } else {
        for (const text of [opening, rephrasedAgentOpening(config)]) {
          if (!text) continue;
          await streamAgentReply({messages:[], fixedSpeech:text, voice:config.voice, openingAudio:true,
            cacheAudio:true, signal, engine, send:async()=>{}, timing:async()=>{}, onText:()=>{}});
        }
      }
    }
    const key = decryptCredential(c.secret_ciphertext),
      bridgeSecret = decryptCredential(c.bridge_secret_ciphertext);
    const capabilities = await requestBridge(
      live.bridgeUrl,
      bridgeSecret,
      "/health",
    );
    if (capabilities.testOnly === true)
      throw Error(
        "The selected audio bridge is in local-test mode; use the production campaign bridge",
      );
    if (
      capabilities.aiOnlyRecording !== true ||
      capabilities.humanAnswerEvents !== true
    )
      throw Error(
        "Update and recheck the audio bridge; campaign handoff and AI-only recording support are required",
      );
    const capacity = Number(capabilities.maxCalls);
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      existing.rows.length + (own ? 0 : 1) > capacity
    )
      throw Error(
        "The audio bridge has no more configured concurrent AI lines; increase verified bridge capacity before enabling another agent",
      );
    // VICIdial owns its lists and dialing. The website never uploads numbers.
    await requestBridge(live.bridgeUrl, bridgeSecret, "/prepare", {
      connectionId: c.id,
      poolId,
      remoteUser,
      campaignId: c.campaign_id,
    });
    const prepared = await client.query(
      `INSERT INTO vicidial_pool_agents(agent_id,pool_id,remote_user,ready,config,dialing_source,max_call_duration_seconds)
      VALUES($1,$2,$3,TRUE,$4::jsonb,$5,$6) ON CONFLICT(agent_id) DO UPDATE SET
        pool_id=EXCLUDED.pool_id,ready=TRUE,config=EXCLUDED.config,dialing_source=EXCLUDED.dialing_source,
        max_call_duration_seconds=EXCLUDED.max_call_duration_seconds,updated_at=NOW()
      WHERE vicidial_pool_agents.remote_user=EXCLUDED.remote_user
        AND (vicidial_pool_agents.pool_id=EXCLUDED.pool_id OR
          ($7::text IS NOT NULL AND vicidial_pool_agents.pool_id=$7 AND NOT vicidial_pool_agents.ready
           AND NOT EXISTS (SELECT 1 FROM ai_agent_runtime_states r WHERE r.agent_id=$1 AND r.call_id IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM agent_calls a WHERE a.agent_id=$1 AND a.status IN ('INITIATED','RINGING','ANSWERED'))))
      RETURNING agent_id`,
      [
        agentId,
        poolId,
        remoteUser,
        JSON.stringify({
          ...config,
          campaignSettings: mapped
            ? campaignSettings.parse(mapped.settings)
            : {},
          transferInGroup: mapped?.transfer_in_group || live.transferInGroup,
        }),
        options.dialingSource || "DIRECT",
        options.maxCallDurationSeconds || 0,
        canRefreshIdlePool ? own.pool_id : null,
      ],
    );
    if (!prepared.rowCount)
      throw Error("The agent route changed during preparation; retry from the current campaign");
    if (c.manage_remote_agents !== false) {
      const active = await vicidialRequest(c.server_url, c.username, key, {
        function: "update_remote_agent",
        agent_user: remoteUser,
        campaign_id: c.campaign_id,
        number_of_lines: "1",
        status: "ACTIVE",
      });
      if (
        !active.includes(
          "NOTICE: update_remote_agent REMOTE AGENT IS ALREADY ACTIVE",
        )
      )
        requireVicidialSuccess(active, "update_remote_agent");
      await client.query(
        "UPDATE vicidial_pool_agents SET line_state='ACTIVE',line_error='' WHERE agent_id=$1",
        [agentId],
      );
    } else
      await client.query(
        "UPDATE vicidial_pool_agents SET line_state='UNKNOWN',line_error='' WHERE agent_id=$1",
        [agentId],
      );
    if (mapped)
      await client.query(
        "UPDATE campaign_agent_assignments SET enabled=TRUE WHERE agent_id=$1",
        [agentId],
      );
    await markAgentReady(agentId, mapped?.id || null, client);
    return { id: poolId, name: a.name, queued: true as const };
  } finally {
    if (lock)
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
        lock,
      ]);
    client.release();
  }
}

export async function stopVicidialAgent(
  agentId: string,
  options: { disableAssignment?: boolean } = {},
) {
  const pool = await db();
  const row = (
    await pool.query(
      `SELECT q.remote_user,c.* FROM vicidial_pool_agents q JOIN vicidial_pools p ON p.id=q.pool_id JOIN voip_connections c ON c.id=p.connection_id WHERE q.agent_id=$1`,
      [agentId],
    )
  ).rows[0];
  const c = row;
  if (options.disableAssignment)
    await pool.query(
      "UPDATE campaign_agent_assignments SET enabled=FALSE WHERE agent_id=$1",
      [agentId],
    );
  await pool.query(
    "UPDATE ai_agent_runtime_states SET state='OFFLINE',updated_at=NOW() WHERE agent_id=$1 AND call_id IS NULL",
    [agentId],
  );
  if (!row) return;
  await pool.query(
    "UPDATE vicidial_pool_agents SET ready=FALSE,updated_at=NOW() WHERE agent_id=$1",
    [agentId],
  );
  if (c.manage_remote_agents === false) {
    await pool.query(
      "DELETE FROM vicidial_pool_agents WHERE agent_id=$1 AND NOT EXISTS(SELECT 1 FROM ai_agent_runtime_states r WHERE r.agent_id=$1 AND r.call_id IS NOT NULL)",
      [agentId],
    );
    return;
  }
  const response = await vicidialRequest(
    c.server_url,
    c.username,
    decryptCredential(c.secret_ciphertext),
    {
      function: "update_remote_agent",
      agent_user: row.remote_user,
      status: "INACTIVE",
    },
  );
  if (
    !response.includes(
      "NOTICE: update_remote_agent REMOTE AGENT IS ALREADY INACTIVE",
    )
  )
    requireVicidialSuccess(response, "update_remote_agent");
  await pool.query(
    "UPDATE vicidial_pool_agents SET line_state='INACTIVE',line_error='' WHERE agent_id=$1",
    [agentId],
  );
  await pool.query(
    "DELETE FROM vicidial_pool_agents WHERE agent_id=$1 AND NOT EXISTS(SELECT 1 FROM ai_agent_runtime_states r WHERE r.agent_id=$1 AND r.call_id IS NOT NULL)",
    [agentId],
  );
}
