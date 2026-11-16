/** Compare the browser origin with the HTTP host, since Next's internal URL
 * may use the listening address (0.0.0.0) during local development. */
export function isSameRequestOrigin(request: Request): boolean {
  const value = request.headers.get("origin");
  if (!value) return false;
  try {
    const origin = new URL(value);
    const internal = new URL(request.url);
    const host = request.headers.get("host") || internal.host;
    const expected = new URL(`${internal.protocol}//${host}`);
    return value === origin.origin && origin.origin === expected.origin;
  } catch {
    return false;
  }
}
