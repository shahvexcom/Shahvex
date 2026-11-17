// PostgreSQL assigns every existing row and every new call a durable unique number.
// IF NOT EXISTS preserves all assigned values and the identity sequence on restart.
export const recordingSerialSchema = `
ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS recording_serial BIGINT GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX IF NOT EXISTS agent_calls_recording_serial_unique ON agent_calls(recording_serial);
`;
