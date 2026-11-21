import { db } from "./database";
import { decryptCredential } from "./credential-crypto";
import { vicidialRequest, requireVicidialSuccess } from "./vicidial";
import { vicidialLiveConfig } from "./vicidial-config";
import { requestBridge } from "./vicidial-bridge";
import { syncVicidialComments, transferVicidialCall } from "./vicidial-results";

/** Returns null only for a non-VICIdial call; existing provider code is preserved. */
export async function vicidialCallCommand(
  id: string,
  action: string,
  agentId?: string,
  controllerOnly = false,
  nativeOnly = false,
) {
  const pool = await db();
  const a = (
    await pool.query(
      `SELECT a.*,c.live_config,c.server_url,c.username,c.secret_ciphertext,c.bridge_secret_ciphertext FROM agent_calls a JOIN voip_connections c ON c.id=a.voip_connection_id
    WHERE a.id=$1 AND a.telephony_provider IN ('VICIDIAL','AUDIOSOCKET') AND ($2::text IS NULL OR a.agent_id=$2) AND (NOT $3::boolean OR NOT EXISTS(SELECT 1 FROM bpo_created_agents b WHERE b.agent_id=a.agent_id))`,
      [id, agentId || null, controllerOnly],
    )
  ).rows[0];
  if (!a) return null;
  const hangupInitiation = nativeOnly ? null : JSON.stringify({
    reason: agentId ? "agent_hangup" : "admin_hangup",
    source: "website_call_control",
    decidedAt: new Date().toISOString(),
  });
  try {
    if (
      a.telephony_provider === "AUDIOSOCKET" &&
      !a.vicidial_call_id &&
      ["sync-comments", "transfer"].includes(action)
    )
      throw Error(
        "This direct audio call is not linked to a native VICIdial call; native sync and transfer are unavailable",
      );
    if (action === "sync-comments") {
      await syncVicidialComments(id);
      return Response.json({ message: "VICIdial comments synchronized." });
    }
    if (action === "transfer") {
      await syncVicidialComments(id);
      await transferVicidialCall(id);
      return Response.json({
        message: "Human transfer submitted; waiting for dialer confirmation.",
      });
    }
    if (!["ANSWERED", "RINGING", "INITIATED"].includes(a.status))
      throw Error("This call has ended");
    if (action === "hangup" && a.telephony_provider === "AUDIOSOCKET" && !a.vicidial_call_id) {
      if (nativeOnly) return Response.json({ message:"Native call identity is pending", nativeHangupPending:true },{status:409});
      const live = vicidialLiveConfig.parse(a.live_config);
      const result = await requestBridge(
        live.bridgeUrl,
        decryptCredential(a.bridge_secret_ciphertext),
        "/command",
        { callId: id, action: "close-audio" },
      );
      if (result.accepted !== true)
        throw Error("Audio bridge did not confirm call closure");
      await pool.query(
        "UPDATE agent_calls SET ending_requested=TRUE,conversation_state=CASE WHEN status IN ('COMPLETED','FAILED') THEN conversation_state ELSE 'ENDING' END,end_initiation=COALESCE(end_initiation,$2::jsonb),updated_at=NOW() WHERE id=$1",
        [id, hangupInitiation],
      );
      return Response.json({ message: "Closing direct audio call." });
    }
    if (action === "hangup") {
      if (a.customer_ended || ["PREPARING", "UNCERTAIN", "SUBMITTED", "ANSWERED"].includes(a.transfer_status))
        throw Error("This AI call is no longer eligible for native hangup");
      const response = await vicidialRequest(
          a.server_url,
          a.username,
          decryptCredential(a.secret_ciphertext),
          {
            function: "ra_call_control",
            agent_user: a.vicidial_agent_user,
            value: a.vicidial_call_id,
            stage: "HANGUP",
          },
          true,
        );
      // The exact historical caller-code fences a retry from a newer call.
      const nativeAlreadyEnded = /ERROR:.*no active call found/i.test(response);
      if (!nativeAlreadyEnded) requireVicidialSuccess(response, "ra_call_control");
      if (a.telephony_provider === "AUDIOSOCKET" && !nativeOnly) {
        const live = vicidialLiveConfig.parse(a.live_config);
        const closed = await requestBridge(live.bridgeUrl,decryptCredential(a.bridge_secret_ciphertext),"/command",{callId:id,action:"close-audio"});
        if (closed.accepted !== true) throw Error("Native hangup submitted. AI audio closure is not yet confirmed");
      }
      await pool.query(
        "UPDATE agent_calls SET ending_requested=TRUE,conversation_state=CASE WHEN status IN ('COMPLETED','FAILED') THEN conversation_state ELSE 'ENDING' END,end_initiation=COALESCE(end_initiation,$2::jsonb),updated_at=NOW() WHERE id=$1",
        [id, nativeAlreadyEnded ? null : hangupInitiation],
      );
      return Response.json({
        message: "Ending call; waiting for VICIdial confirmation.",
      });
    }
    if (action === "record-start" || action === "record-stop") {
      if (a.ai_leg_released || a.transfer_status === "ANSWERED")
        throw Error("AI recording has ended");
      const live = vicidialLiveConfig.parse(a.live_config);
      const result = await requestBridge(
        live.bridgeUrl,
        decryptCredential(a.bridge_secret_ciphertext),
        "/command",
        { callId: id, action },
      );
      if (
        result.accepted !== true ||
        typeof result.recordingActive !== "boolean"
      )
        throw Error("Recording control was not confirmed");
      await pool.query(
        `UPDATE agent_calls SET recording_active=$1,ai_recording_id=COALESCE($2,ai_recording_id),recording_size_bytes=COALESCE($3,recording_size_bytes),updated_at=NOW() WHERE id=$4 AND status='ANSWERED' AND NOT ai_leg_released`,
        [
          result.recordingActive,
          result.aiRecordingId || null,
          result.recordingSize || null,
          id,
        ],
      );
      return Response.json({
        message: result.recordingActive
          ? "AI recording started."
          : "AI recording stopped. The call continues.",
        recording_active: result.recordingActive,
        ai_recording_id: result.aiRecordingId || a.ai_recording_id,
      });
    }
    if (action === "hold" || action === "resume") {
      const live = vicidialLiveConfig.parse(a.live_config);
      const result = await requestBridge(
        live.bridgeUrl,
        decryptCredential(a.bridge_secret_ciphertext),
        "/command",
        { callId: id, action },
      );
      if (result.accepted !== true)
        throw Error("Audio bridge did not accept the hold command");
      await pool.query(
        "UPDATE agent_calls SET on_hold=$1,conversation_state=$2,updated_at=NOW() WHERE id=$3 AND status='ANSWERED' AND NOT ai_leg_released",
        [action === "hold", action === "hold" ? "ON_HOLD" : "LISTENING", id],
      );
      return Response.json({
        message: action === "hold" ? "AI audio paused." : "AI audio resumed.",
      });
    }
    throw Error("Unsupported VICIdial call action");
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof Error ? error.message : "VICIdial command failed",
      },
      { status: 409 },
    );
  }
}

