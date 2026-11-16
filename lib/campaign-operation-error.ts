import { randomUUID } from "node:crypto";

export function campaignOperationFailure(error: unknown) {
  const failure = error as { name?: string; code?: string; constraint?: string } | null;
  const reference = randomUUID();
  // Log metadata only: scripts, credentials and upstream response bodies stay private.
  console.error("Campaign operation failed", { reference, name: failure?.name, code: failure?.code, constraint: failure?.constraint });
  if (failure?.code === "23505") return Response.json({ error: "This campaign mapping or category already exists. Edit the existing entry." }, { status: 409 });
  if (failure?.code === "23503") return Response.json({ error: "The selected category or connection is no longer available. Refresh and select it again." }, { status: 409 });
  if (failure?.name === "TimeoutError" || failure?.name === "AbortError") return Response.json({ error: "Campaign processing timed out. Retry when the AI service is ready." }, { status: 503 });
  return Response.json({ error: `Campaign operation failed. Reference: ${reference}. Check the website server logs.` }, { status: 503 });
}
