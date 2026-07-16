/**
 * User-owned IM channel connection persistence.
 *
 * Ports ``quill.persistence.channel_connections.__init__``.
 */

export {
  CHANNEL_CONNECTIONS_TABLE,
  CHANNEL_CREDENTIALS_TABLE,
  CHANNEL_OAUTH_STATES_TABLE,
  CHANNEL_CONVERSATIONS_TABLE,
  CHANNEL_CONNECTIONS_DDL,
} from "./model.js";
export type {
  ChannelConnectionRow,
  ChannelConversationRow,
  ChannelCredentialRow,
  ChannelOAuthStateRow,
} from "./model.js";
export { ChannelConnectionRepository, ChannelCredentialCipher, InvalidTokenError } from "./sql.js";
