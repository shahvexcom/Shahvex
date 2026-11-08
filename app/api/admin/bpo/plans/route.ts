import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { bpoUsagePricing } from "@/lib/bpo-entitlements";
import { db } from "@/lib/database";
import { ADMIN_SESSION_COOKIE, readSession } from "@/lib/session";

const planFields = z.object({
  name: z.string().trim().min(2, "Plan name must be at least 2 characters.").max(100),
  description: z.string().trim().min(2, "Description must be at least 2 characters.").max(2_000),
  price: z.number().min(0).max(10_000_000).refine(Number.isFinite, "Enter a valid price."),
  isActive: z.boolean(),
  planBadge: z.enum(["STANDARD", "RECOMMENDED", "EXCLUSIVE"]),
  planKind: z.enum(["STANDARD", "CUSTOM"]),
  assignedBpoId: z.string().trim().min(1, "Choose the BPO user for this custom offer.").optional(),
  benefits: z.array(z.string().trim().min(1).max(300)).min(1, "Add at least one plan benefit.").max(50).transform(items => [...new Set(items)]),
  agentLimit: z.number().int().min(0).max(10_000_000),
  callLimit: z.number().int().min(0).max(10_000_000),
  totalMinutes: z.number().int().min(0).max(10_000_000),
  storageAmount: z.number().positive().max(10_000_000).refine(Number.isFinite, "Enter valid storage."),
  storageUnit: z.enum(["MB", "GB"]),
});

const validateCustomOffer = (value: { planKind: "STANDARD" | "CUSTOM"; assignedBpoId?: string; price: number }, context: z.RefinementCtx) => {
  if (value.planKind === "CUSTOM" && !value.assignedBpoId) {
    context.addIssue({ code: "custom", path: ["assignedBpoId"], message: "Choose the BPO user for this custom offer." });
  }
  if (value.planKind === "CUSTOM" && value.price <= 0) {
    context.addIssue({ code: "custom", path: ["price"], message: "Enter the PKR amount to deduct for this custom plan." });
  }
};

const createSchema = planFields.superRefine(validateCustomOffer);
const updateSchema = planFields.extend({ id: z.string().uuid() });
const pricingSchema = z.object({
  action: z.literal("save-usage-pricing"),
  agentUnitPrice: z.number().min(0).max(10_000_000).refine(Number.isFinite),
  callUnitPrice: z.number().min(0).max(10_000_000).refine(Number.isFinite),
  minuteUnitPrice: z.number().min(0).max(10_000_000).refine(Number.isFinite),
  recordingUnitPrice: z.number().min(0).max(10_000_000).refine(Number.isFinite),
  storageUnitPrice: z.number().min(0).max(10_000_000).refine(Number.isFinite),
  storageUnit: z.enum(["MB", "GB"]),
});

async function requireAdmin() {
  const session = await readSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  return session?.role === "ADMIN" ? session : null;
}

const fields = "id,name,description,price::float8 price,is_active,plan_badge,plan_kind,assigned_bpo_id,benefits,agent_limit,call_limit,total_minutes,storage_amount::float8 storage_amount,storage_unit,created_at,updated_at";

async function ensureAssignedBpo(client: Awaited<ReturnType<typeof db>>, planKind: "STANDARD" | "CUSTOM", assignedBpoId?: string) {
  if (planKind !== "CUSTOM") return null;
  const result = await client.query("SELECT id FROM agents WHERE id=$1 AND role='BPO'", [assignedBpoId]);
  return result.rows[0]?.id ?? null;
}

export async function GET() {
  if (!await requireAdmin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const client = await db();
  const [plans, bpoUsers, usagePricing] = await Promise.all([
    client.query(`SELECT ${fields} FROM bpo_plans ORDER BY updated_at DESC`),
    client.query("SELECT id,name,email,status FROM agents WHERE role='BPO' ORDER BY name ASC"),
    bpoUsagePricing(client),
  ]);
  return Response.json({ plans: plans.rows, bpoUsers: bpoUsers.rows, usagePricing }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const pricing = pricingSchema.safeParse(body);
  if (pricing.success) {
    const value = pricing.data;
    const result = await (await db()).query(`UPDATE bpo_usage_pricing SET agent_unit_price=$1,call_unit_price=$2,minute_unit_price=$3,
      recording_unit_price=$4,storage_unit_price=$5,storage_unit=$6,updated_by=$7,updated_at=NOW() WHERE id=1
      RETURNING agent_unit_price::float8 agent_unit_price,call_unit_price::float8 call_unit_price,minute_unit_price::float8 minute_unit_price,recording_unit_price::float8 recording_unit_price,storage_unit_price::float8 storage_unit_price,storage_unit`,
      [value.agentUnitPrice, value.callUnitPrice, value.minuteUnitPrice, value.recordingUnitPrice, value.storageUnitPrice, value.storageUnit, admin.agentId]);
    const row = result.rows[0];
    return Response.json({ message: "BPO usage prices updated.", usagePricing: { agentUnitPrice: Number(row.agent_unit_price), callUnitPrice: Number(row.call_unit_price), minuteUnitPrice: Number(row.minute_unit_price), recordingUnitPrice: Number(row.recording_unit_price), storageUnitPrice: Number(row.storage_unit_price), storageUnit: row.storage_unit === "MB" ? "MB" : "GB" } });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Invalid plan details." }, { status: 400 });
  const value = parsed.data;
  const client = await db();
  const isCustom = value.planKind === "CUSTOM";
  if (isCustom) {
    const connection = await client.connect();
    try {
      await connection.query("BEGIN");
      const bpo = await connection.query(
        "SELECT id,COALESCE(remaining_credits,0)::float8 remaining_credits FROM agents WHERE id=$1 AND role='BPO' AND status='APPROVED' FOR UPDATE",
        [value.assignedBpoId],
      );
      const selectedBpo = bpo.rows[0];
      if (!selectedBpo) {
        await connection.query("ROLLBACK");
        return Response.json({ message: "The selected BPO user must be an approved account." }, { status: 400 });
      }
      const balance = Number(selectedBpo.remaining_credits || 0);
      if (balance < value.price) {
        await connection.query("ROLLBACK");
        return Response.json({ message: `This BPO user needs ${value.price - balance} more PKR for this custom plan.` }, { status: 402 });
      }
      const planId = randomUUID();
      const created = await connection.query(
        `INSERT INTO bpo_plans (id,name,description,price,is_active,is_recommended,plan_badge,plan_kind,assigned_bpo_id,benefits,agent_limit,call_limit,total_minutes,storage_amount,storage_unit,created_by)
         VALUES ($1,$2,$3,$4,TRUE,FALSE,'CUSTOM','CUSTOM',$5,$6::jsonb,$7,$8,$9,$10,$11,$12) RETURNING ${fields}`,
        [planId, value.name, value.description, value.price, selectedBpo.id, JSON.stringify(value.benefits), value.agentLimit, value.callLimit, value.totalMinutes, value.storageAmount, value.storageUnit, admin.agentId],
      );
      const charged = await connection.query(
        `UPDATE agents SET remaining_credits=remaining_credits-$1,updated_at=NOW()
         WHERE id=$2 AND remaining_credits >= $1 RETURNING COALESCE(remaining_credits,0)::float8 remaining_credits`,
        [value.price, selectedBpo.id],
      );
      if (!charged.rows[0]) throw new Error("Custom plan balance changed before it could be charged.");
      await connection.query(
        `INSERT INTO bpo_plan_purchases (id,bpo_id,plan_id,plan_name,price,plan_badge,benefits,agent_limit,call_limit,total_minutes,storage_amount,storage_unit,is_active)
         VALUES ($1,$2,$3,$4,$5,'CUSTOM',$6::jsonb,$7,$8,$9,$10,$11,TRUE)`,
        [randomUUID(), selectedBpo.id, planId, value.name, value.price, JSON.stringify(value.benefits), value.agentLimit, value.callLimit, value.totalMinutes, value.storageAmount, value.storageUnit],
      );
      await connection.query(
        "INSERT INTO bpo_credit_transactions (id,bpo_id,amount,loaded_by,transaction_type) VALUES ($1,$2,$3,$4,'PLAN_BUY')",
        [randomUUID(), selectedBpo.id, value.price, admin.agentId],
      );
      await connection.query("COMMIT");
      return Response.json({ message: `Custom plan created, ${value.price} PKR deducted, and activated immediately.`, plan: created.rows[0], balance: Number(charged.rows[0].remaining_credits) }, { status: 201 });
    } catch (error) {
      await connection.query("ROLLBACK").catch(() => undefined);
      console.error("Custom BPO plan creation failed", error);
      return Response.json({ message: "Unable to create and activate this custom plan right now." }, { status: 500 });
    } finally {
      connection.release();
    }
  }
  const assignedBpoId = await ensureAssignedBpo(client, value.planKind, value.assignedBpoId);
  const created = await client.query(
    `INSERT INTO bpo_plans (id,name,description,price,is_active,is_recommended,plan_badge,plan_kind,assigned_bpo_id,benefits,agent_limit,call_limit,total_minutes,storage_amount,storage_unit,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16) RETURNING ${fields}`,
    [randomUUID(), value.name, value.description, value.price, value.isActive, value.planBadge === "RECOMMENDED", value.planBadge, value.planKind, assignedBpoId, JSON.stringify(value.benefits), value.agentLimit, value.callLimit, value.totalMinutes, value.storageAmount, value.storageUnit, admin.agentId],
  );
  return Response.json({ message: "Plan created.", plan: created.rows[0] }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!await requireAdmin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Invalid plan details." }, { status: 400 });
  const value = parsed.data;
  if (value.planKind === "CUSTOM" && !value.assignedBpoId) {
    return Response.json({ message: "Choose the BPO user for this custom offer." }, { status: 400 });
  }
  const client = await db();
  const existing = await client.query("SELECT plan_kind,assigned_bpo_id,price::float8 price FROM bpo_plans WHERE id=$1", [value.id]);
  if (!existing.rows[0]) return Response.json({ message: "Plan not found." }, { status: 404 });
  if (existing.rows[0].plan_kind !== value.planKind) {
    return Response.json({ message: "Plan type cannot be changed after creation. Create a new plan instead." }, { status: 409 });
  }
  if (value.planKind === "CUSTOM" && existing.rows[0].assigned_bpo_id !== value.assignedBpoId) {
    return Response.json({ message: "The BPO user cannot be changed after this custom plan is activated." }, { status: 409 });
  }
  const assignedBpoId = await ensureAssignedBpo(client, value.planKind, value.assignedBpoId);
  if (value.planKind === "CUSTOM" && !assignedBpoId) return Response.json({ message: "The selected BPO user no longer exists." }, { status: 404 });
  const isCustom = value.planKind === "CUSTOM";
  const updated = await client.query(
    `UPDATE bpo_plans SET name=$1,description=$2,price=$3,is_active=$4,is_recommended=$5,plan_badge=$6,plan_kind=$7,assigned_bpo_id=$8,benefits=$9::jsonb,agent_limit=$10,call_limit=$11,total_minutes=$12,
      storage_amount=$13,storage_unit=$14,updated_at=NOW() WHERE id=$15 RETURNING ${fields}`,
    [value.name, value.description, isCustom ? Number(existing.rows[0].price) : value.price, value.isActive, !isCustom && value.planBadge === "RECOMMENDED", isCustom ? "CUSTOM" : value.planBadge, value.planKind, assignedBpoId, JSON.stringify(value.benefits), value.agentLimit, value.callLimit, value.totalMinutes, value.storageAmount, value.storageUnit, value.id],
  );
  const plan = updated.rows[0];
  if (!plan) return Response.json({ message: "Plan not found." }, { status: 404 });
  if (isCustom) {
    await client.query(
      `UPDATE bpo_plan_purchases SET plan_name=$1,plan_badge='CUSTOM',benefits=$2::jsonb,agent_limit=$3,call_limit=$4,total_minutes=$5,storage_amount=$6,storage_unit=$7
       WHERE bpo_id=$8 AND plan_id=$9 AND is_active=TRUE`,
      [plan.name, JSON.stringify(plan.benefits), plan.agent_limit, plan.call_limit, plan.total_minutes, plan.storage_amount, plan.storage_unit, assignedBpoId, plan.id],
    );
  }
  return Response.json({ message: isCustom ? "Custom plan updated and the active user plan has been refreshed." : "Plan updated.", plan });
}

export async function DELETE(request: Request) {
  if (!await requireAdmin()) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) return Response.json({ message: "A valid plan id is required." }, { status: 400 });
  try {
    const deleted = await (await db()).query("DELETE FROM bpo_plans WHERE id=$1 RETURNING id", [id]);
    return deleted.rows[0]
      ? Response.json({ message: "Plan deleted.", deletedId: id })
      : Response.json({ message: "Plan not found." }, { status: 404 });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "23503") {
      return Response.json({ message: "This plan has been purchased. Set it inactive instead of deleting it." }, { status: 409 });
    }
    return Response.json({ message: "Unable to delete this plan right now." }, { status: 500 });
  }
}
