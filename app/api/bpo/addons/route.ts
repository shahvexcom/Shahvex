import { randomUUID } from "node:crypto";
import { z } from "zod";
import { bpoEntitlements, bpoUsagePricing } from "@/lib/bpo-entitlements";
import { db } from "@/lib/database";
import { requireApprovedBpo } from "@/lib/bpo-session";

const purchaseSchema = z.object({
  product: z.enum(["AGENT", "CALL", "MINUTE", "RECORDING", "STORAGE"]),
  quantity: z.number().int().min(1).max(1_000_000),
});

const priceFor = (product: z.infer<typeof purchaseSchema>["product"], pricing: Awaited<ReturnType<typeof bpoUsagePricing>>) =>
  product === "AGENT" ? pricing.agentUnitPrice
    : product === "CALL" ? pricing.callUnitPrice
      : product === "MINUTE" ? pricing.minuteUnitPrice
        : product === "RECORDING" ? pricing.recordingUnitPrice
          : pricing.storageUnitPrice;

export async function POST(request: Request) {
  const session = await requireApprovedBpo();
  if (!session) return Response.json({ message: "Unauthenticated" }, { status: 401 });
  const parsed = purchaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "Choose a valid add-on and quantity." }, { status: 400 });

  const pool = await db();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await client.query(`SELECT COALESCE(remaining_credits,0)::float8 remaining_credits
      FROM agents WHERE id=$1 AND role='BPO' AND status='APPROVED' FOR UPDATE`, [session.agentId]);
    if (!account.rows[0]) {
      await client.query("ROLLBACK");
      return Response.json({ message: "Your BPO account is not approved." }, { status: 403 });
    }
    const pricing = await bpoUsagePricing(client);
    const unitPrice = priceFor(parsed.data.product, pricing);
    if (unitPrice <= 0) {
      await client.query("ROLLBACK");
      return Response.json({ message: "This add-on price has not been configured yet. Ask your administrator to set it in BPO Plans." }, { status: 409 });
    }
    const total = Number((unitPrice * parsed.data.quantity).toFixed(2));
    const balance = Number(account.rows[0].remaining_credits || 0);
    if (balance < total) {
      await client.query("ROLLBACK");
      return Response.json({
        message: "Your PKR balance is too low for this add-on.", balance, required: total, shortfall: Number((total - balance).toFixed(2)),
      }, { status: 402 });
    }
    const updated = await client.query(`UPDATE agents SET remaining_credits=remaining_credits-$1,updated_at=NOW()
      WHERE id=$2 AND remaining_credits >= $1 RETURNING remaining_credits::float8 remaining_credits`, [total, session.agentId]);
    if (!updated.rows[0]) throw new Error("Your credit balance changed before this purchase could be completed.");
    await client.query(`INSERT INTO bpo_usage_addon_purchases (id,bpo_id,product_type,quantity,unit_price,total_price,storage_unit)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), session.agentId, parsed.data.product, parsed.data.quantity, unitPrice, total, parsed.data.product === "STORAGE" ? pricing.storageUnit : null]);
    if (total > 0) await client.query("INSERT INTO bpo_credit_transactions (id,bpo_id,amount,loaded_by,transaction_type) VALUES ($1,$2,$3,$4,'ADDON_BUY')", [randomUUID(), session.agentId, total, session.agentId]);
    const entitlements = await bpoEntitlements(client, session.agentId);
    await client.query("COMMIT");
    return Response.json({ message: "Add-on purchased successfully.", balance: Number(updated.rows[0].remaining_credits), entitlements, pricing });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("BPO add-on purchase failed", error);
    return Response.json({ message: "Unable to purchase this add-on right now." }, { status: 500 });
  } finally { client.release(); }
}
