/** Implement only against the client's confirmed VICIdial/Asterisk contract. */
export type CallReference = {
  provider: "VICIDIAL";
  externalId: string;
  sessionId: string;
};
export type AudioFormat = {
  codec: "pcm_s16le";
  sampleRate: 8000 | 16000 | 24000 | 48000;
  channels: 1;
};
export type CallEvent = {
  eventId: string;
  call: CallReference;
  sequence: number;
  at: string;
} & (
  | { type: "ringing" | "answered" | "ended"; reason?: string }
  | { type: "recording"; recordingId: string }
  | { type: "result"; disposition: string }
);
export interface VicidialAdapter {
  capabilities(): Promise<{
    inbound: boolean;
    outbound: boolean;
    media: AudioFormat[];
    transfer: boolean;
    recording: boolean;
  }>;
  originate(input: {
    idempotencyKey: string;
    campaignId: string;
    agentId: string;
    to: string;
    from: string;
    sessionId: string;
  }): Promise<CallReference>;
  audio(call: CallReference, signal: AbortSignal): AsyncIterable<Uint8Array>;
  play(
    call: CallReference,
    audio: AsyncIterable<Uint8Array>,
    format: AudioFormat,
    signal: AbortSignal,
  ): Promise<void>;
  stopPlayback(call: CallReference): Promise<void>;
  transfer(
    call: CallReference,
    allowlistedDestination: string,
    idempotencyKey: string,
  ): Promise<void>;
  hangup(call: CallReference, idempotencyKey: string): Promise<void>;
  events(signal: AbortSignal): AsyncIterable<CallEvent>;
}
