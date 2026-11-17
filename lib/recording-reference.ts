/** A call keeps one recording serial across Stop/Start, downloads and completion. */
export function recordingReference(call: { id: string; recording_serial?: string | number | null }, local = false) {
  const value = String(call.recording_serial ?? "");
  if (/^[1-9]\d*$/.test(value)) return `REC-${value.padStart(6, "0")}`;
  // Local test sessions have no database call row; retain their complete UUID.
  return `${local ? "LOCAL" : "CALL"}-${call.id.toUpperCase()}`;
}
export function parseRecordingReference(input: string) {
  const match = /^(?:REC[-\s]?)?0*([1-9]\d{0,18})$/i.exec(input.trim());
  if (!match || BigInt(match[1]) > BigInt("9223372036854775807")) return null;
  return BigInt(match[1]).toString();
}
