/**
 * Channel connections API request/response contracts.
 */

export interface ChannelCredentialFieldResponse {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}

export interface ChannelProviderResponse {
  provider: string;
  display_name: string;
  enabled: boolean;
  configured: boolean;
  connectable: boolean;
  unavailable_reason?: string | null;
  auth_mode: string;
  connection_status: string;
  credential_fields?: ChannelCredentialFieldResponse[];
  credential_values?: Record<string, string>;
}

export interface ChannelProvidersResponse {
  enabled: boolean;
  providers: ChannelProviderResponse[];
}

export interface ChannelConnectionResponse {
  id: string;
  provider: string;
  status: string;
  external_account_id?: string | null;
  external_account_name?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  scopes?: string[];
  metadata?: Record<string, unknown>;
}

export interface ChannelConnectionsResponse {
  connections: ChannelConnectionResponse[];
}

export interface ChannelConnectResponse {
  provider: string;
  mode: string;
  url?: string | null;
  code: string;
  instruction: string;
  expires_in: number;
}

export interface ChannelRuntimeConfigRequest {
  values: Record<string, string>;
}
