import { ConversationSilence as SharedConversationSilence } from '../gateway/conversation-silence.cjs';
/** Shared native/tester policy: 5s, 4s, 3s goodbye, then 5s before hangup. */
export class ConversationSilence extends SharedConversationSilence {}
