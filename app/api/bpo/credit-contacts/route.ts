import { getBpoCreditContacts } from "@/lib/bpo-credit-contacts";
import { requireApprovedBpo } from "@/lib/bpo-session";

export async function GET() {
  if (!await requireApprovedBpo()) {
    return Response.json({ message: "Account access is blocked." }, { status: 403 });
  }

  return Response.json(
    { creditContacts: await getBpoCreditContacts() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
