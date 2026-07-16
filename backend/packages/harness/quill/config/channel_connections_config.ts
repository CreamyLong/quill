/**
 * Configuration for user-owned IM channel connections.
 *
 * Mirrors `quill.config.channel_connections_config` from the Python backend.
 */

export interface SlackChannelConnectionConfig {
  enabled: boolean;
}

export interface TelegramChannelConnectionConfig {
  enabled: boolean;
  botUsername: string;
}

export interface DiscordChannelConnectionConfig {
  enabled: boolean;
}

export interface BindingCodeChannelConnectionConfig {
  enabled: boolean;
}

/** Return whether a Slack connection is considered configured. */
export function slackConfigured(_config: SlackChannelConnectionConfig): boolean {
  return true;
}

/** Return whether a Telegram connection is considered configured. */
export function telegramConfigured(config: TelegramChannelConnectionConfig): boolean {
  return Boolean(config.botUsername);
}

/** Return whether a Discord connection is considered configured. */
export function discordConfigured(_config: DiscordChannelConnectionConfig): boolean {
  return true;
}

/** Return whether a binding-code connection is considered configured. */
export function bindingCodeConfigured(_config: BindingCodeChannelConnectionConfig): boolean {
  return true;
}

/** Top-level config for browser-connectable IM channels. */
export interface ChannelConnectionsConfig {
  enabled: boolean;
  requireBoundIdentity: boolean;
  slack: SlackChannelConnectionConfig;
  telegram: TelegramChannelConnectionConfig;
  discord: DiscordChannelConnectionConfig;
  feishu: BindingCodeChannelConnectionConfig;
  dingtalk: BindingCodeChannelConnectionConfig;
  wechat: BindingCodeChannelConnectionConfig;
  wecom: BindingCodeChannelConnectionConfig;
}

export function buildChannelConnectionsConfig(input: Partial<ChannelConnectionsConfig> = {}): ChannelConnectionsConfig {
  return {
    enabled: input.enabled ?? false,
    requireBoundIdentity: input.requireBoundIdentity ?? true,
    slack: input.slack ?? { enabled: false },
    telegram: input.telegram ?? { enabled: false, botUsername: "" },
    discord: input.discord ?? { enabled: false },
    feishu: input.feishu ?? { enabled: false },
    dingtalk: input.dingtalk ?? { enabled: false },
    wechat: input.wechat ?? { enabled: false },
    wecom: input.wecom ?? { enabled: false },
  };
}

type ProviderKey = "slack" | "telegram" | "discord" | "feishu" | "dingtalk" | "wechat" | "wecom";

function providerConfigured(provider: ProviderKey, config: ChannelConnectionsConfig): boolean {
  switch (provider) {
    case "slack":
      return slackConfigured(config.slack);
    case "telegram":
      return telegramConfigured(config.telegram);
    case "discord":
      return discordConfigured(config.discord);
    default:
      return bindingCodeConfigured(config[provider]);
  }
}

/** Return the enabled/configured status for a provider. */
export function providerStatus(config: ChannelConnectionsConfig, provider: string): { enabled: boolean; configured: boolean } {
  if (!(provider in config)) {
    return { enabled: false, configured: false };
  }
  const sub = (config as unknown as Record<string, unknown>)[provider] as { enabled?: unknown } | undefined;
  if (sub === undefined || sub === null || typeof sub !== "object") {
    return { enabled: false, configured: false };
  }
  const enabled = Boolean((sub as { enabled?: unknown }).enabled);
  return {
    enabled,
    configured: enabled && providerConfigured(provider as ProviderKey, config),
  };
}
