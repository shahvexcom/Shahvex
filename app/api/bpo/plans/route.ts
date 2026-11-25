import { randomUUID } from "node:crypto";
import { z } from "zod";
import { bpoEntitlements, bpoLeadUsage, bpoUsagePricing } from "@/lib/bpo-entitlements";
import { getBpoStorageSummary } from "@/lib/bpo-storage";
import { db } from "@/lib/database";
import { requireApprovedBpo } from "@/lib/bpo-session";

const planFields = "id,name,description,price::float8 price,plan_badge,plan_kind,benefits,agent_limit,call_limit,total_minutes,storage_amount::float8 storage_amount,storage_unit,updated_at";
const purchaseFields = "id,plan_id,plan_name,price::float8 price,plan_badge,benefits,agent_limit,call_limit,total_minutes,storage_amount::float8 storage_amount,storage_unit,purchased_at";
const purchaseSchema = z.object({ planId: z.string().uuid() });
function number(value: unknown) {
  return Number(value || 0);
}

export async function GET() {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });

  try {
    const client = await db();
    const [plans, purchases, account, callUsage, agentUsage, storage, entitlements, usagePricing] = await Promise.all([
      client.query(`SELECT ${planFields} FROM bpo_plans
        WHERE is_active=TRUE AND (plan_kind='STANDARD' OR (plan_kind='CUSTOM' AND assigned_bpo_id=$1))
        ORDER BY updated_at DESC`, [session.agentId]),
      client.query(`SELECT ${purchaseFields} FROM bpo_plan_purchases WHERE bpo_id=$1 AND is_active=TRUE ORDER BY purchased_at DESC`, [session.agentId]),
      client.query("SELECT COALESCE(remaining_credits,0)::float8 remaining_credits FROM agents WHERE id=$1 AND role='BPO'", [session.agentId]),
      bpoLeadUsage(client, session.agentId),
      client.query("SELECT COUNT(*)::int agents FROM bpo_created_agents b JOIN agents a ON a.id=b.agent_id WHERE b.bpo_id=$1 AND a.deleted_at IS NULL", [session.agentId]),
      getBpoStorageSummary(client, session.agentId),
      bpoEntitlements(client, session.agentId),
      bpoUsagePricing(client),
    ]);
    return Response.json({
      plans: plans.rows,
      activePurchases: purchases.rows,
      balance: Number(account.rows[0]?.remaining_credits ?? 0),
      usage: {
        agents: number(agentUsage.rows[0]?.agents),
        calls: callUsage.calls,
        minutes: callUsage.minutes,
        recordings: callUsage.recordings,
        storageBytes: storage.usedBytes,
        limits: { ...entitlements, storageBytes: storage.limitBytes },
      },
      usagePricing,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ message: "Unable to load plans right now." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = purchaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "Select a valid plan." }, { status: 400 });

  const client = await db();
  const connection = await client.connect();
  try {
    await connection.query("BEGIN");
    const bpo = await connection.query(
      "SELECT id FROM agents WHERE id=$1 AND role='BPO' AND status='APPROVED' FOR UPDATE",
      [session.agentId],
    );
    if (!bpo.rows[0]) {
      await connection.query("ROLLBACK");
      return Response.json({ message: "Your BPO account is not approved." }, { status: 403 });
    }
    const planResult = await connection.query(
      `SELECT id,name,price::float8 price,plan_badge,plan_kind,benefits,agent_limit,call_limit,total_minutes,storage_amount::float8 storage_amount,storage_unit
       FROM bpo_plans WHERE id=$1 AND is_active=TRUE FOR UPDATE`,
      [parsed.data.planId],
    );
    const plan = planResult.rows[0];
    if (!plan) {
      await connection.query("ROLLBACK");
      return Response.json({ message: "This plan is no longer available." }, { status: 404 });
    }
    if (plan.plan_kind === "CUSTOM") {
      await connection.query("ROLLBACK");
      return Response.json({ message: "This custom offer cannot be bought with PKR. Please contact support to arrange it." }, { status: 403 });
    }

    const activePlans = await connection.query(
      "SELECT plan_id,plan_badge FROM bpo_plan_purchases WHERE bpo_id=$1 AND is_active=TRUE FOR UPDATE",
      [session.agentId],
    );
    if (activePlans.rows.some(activePlan => activePlan.plan_id === plan.id)) {
      await connection.query("ROLLBACK");
      return Response.json({ message: "You already have this plan active. Choose a different plan." }, { status: 409 });
    }
    if (activePlans.rows.filter(activePlan => activePlan.plan_badge !== "CUSTOM").length >= 2) {
      await connection.query("ROLLBACK");
      return Response.json({ message: "You can have up to two regular active plans at one time." }, { status: 409 });
    }

    const price = Number(plan.price || 0);
    const account = await connection.query(
      `UPDATE agents SET remaining_credits=remaining_credits-$1,updated_at=NOW()
       WHERE id=$2 AND role='BPO' AND status='APPROVED' AND remaining_credits >= $1
       RETURNING COALESCE(remaining_credits,0)::float8 remaining_credits`,
      [price, session.agentId],
    );
    if (!account.rows[0]) {
      const current = await connection.query("SELECT COALESCE(remaining_credits,0)::float8 remaining_credits FROM agents WHERE id=$1 AND role='BPO'", [session.agentId]);
      await connection.query("ROLLBACK");
      const balance = Number(current.rows[0]?.remaining_credits ?? 0);
      return Response.json({
        message: "Your PKR balance is too low for this plan.",
        balance,
        required: price,
        shortfall: Math.max(0, price - balance),
      }, { status: 402 });
    }

    await connection.query(
      `INSERT INTO bpo_plan_purchases (id,bpo_id,plan_id,plan_name,price,plan_badge,benefits,agent_limit,call_limit,total_minutes,storage_amount,storage_unit,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,TRUE)
       RETURNING id`,
      [randomUUID(), session.agentId, plan.id, plan.name, price, plan.plan_badge, JSON.stringify(plan.benefits), plan.agent_limit, plan.call_limit, plan.total_minutes, plan.storage_amount, plan.storage_unit],
    );
    if (price > 0) {
      await connection.query(
        "INSERT INTO bpo_credit_transactions (id,bpo_id,amount,loaded_by,transaction_type) VALUES ($1,$2,$3,$4,'PLAN_BUY')",
        [randomUUID(), session.agentId, price, session.agentId],
      );
    }
    const purchases = await connection.query(
      `SELECT ${purchaseFields} FROM bpo_plan_purchases WHERE bpo_id=$1 AND is_active=TRUE ORDER BY purchased_at DESC`,
      [session.agentId],
    );
    await connection.query("COMMIT");
    return Response.json({
      message: `${plan.name} has been added to your active plans.`,
      activePurchases: purchases.rows,
      balance: Number(account.rows[0].remaining_credits),
    });
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    console.error("BPO plan purchase failed", error);
    return Response.json({ message: "Unable to buy this plan right now." }, { status: 500 });
  } finally {
    connection.release();
  }
}
