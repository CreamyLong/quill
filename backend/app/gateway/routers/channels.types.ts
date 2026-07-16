/**
 * Channels API request/response contracts.
 */

export interface ChannelStatusResponse {
  service_running: boolean;
  channels: Record<string, Record<string, unknown>>;
}

export interface ChannelRestartResponse {
  success: boolean;
  message: string;
}
