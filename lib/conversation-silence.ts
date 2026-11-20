import { ConversationSilence as SharedConversationSilence } from '../gateway/conversation-silence.cjs';
/** Shared native/tester policy: 3s question retry, 3s audio check, 3s final warning, 3s goodbye, then hangup. */
export class ConversationSilence extends SharedConversationSilence {}

