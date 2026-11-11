/** Cancellation is advisory: the next upload still passes server BUSY admission. */
export async function cancelBrowserTurn(url: string) {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(3000) });
  } catch {
    // A lost cancellation acknowledgement must not poison all future turns.
    return;
  }
  if (response.ok) return;
  const failure = await response.json();
  if (response.status === 409 && failure.code === "BUSY") return;
  throw Error(failure.error || "Unable to interrupt the previous turn");
}
