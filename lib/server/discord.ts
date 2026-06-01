import 'server-only';

export const DISCORD_OAUTH_STATE_COOKIE = 'raic_discord_oauth_state';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
export const DISCORD_OAUTH_SCOPES = 'bot applications.commands identify guilds';
export const DISCORD_OAUTH_PERMISSION_BITS = '8589937664';

export interface DiscordConfig {
  clientId: string;
  clientSecret: string;
  botToken: string;
}

export interface DiscordChannelSummary {
  id: string;
  name: string;
  type?: number;
}

export interface DiscordGuildSummary {
  id: string;
  name: string;
}

export interface DiscordScheduledEventPayload {
  name: string;
  description?: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  privacy_level: 2;
  entity_type: 3;
  entity_metadata: { location: string };
}

export interface DiscordScheduledEventSummary {
  id: string;
  guild_id?: string;
  name?: string;
  channel_id?: string | null;
  entity_metadata?: { location?: string };
  url?: string;
}

export interface DiscordMessageSummary {
  id: string;
}

export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseText?: string,
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

export function getDiscordConfig(): DiscordConfig | null {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!clientId || !clientSecret || !botToken) {
    return null;
  }

  return { clientId, clientSecret, botToken };
}

function getRequiredDiscordConfig(): DiscordConfig {
  const config = getDiscordConfig();
  if (!config) {
    throw new Error('Discord integration is not configured.');
  }
  return config;
}

export function buildDiscordOAuthUrl(input: { origin: string; state: string }): string {
  const config = getRequiredDiscordConfig();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set(
    'redirect_uri',
    `${new URL(input.origin).origin}/api/integrations/discord/oauth/callback`,
  );
  url.searchParams.set('scope', DISCORD_OAUTH_SCOPES);
  url.searchParams.set('permissions', DISCORD_OAUTH_PERMISSION_BITS);
  url.searchParams.set('state', input.state);
  return url.toString();
}

async function readDiscordResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    let message = text || response.statusText;
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error_description?: unknown };
      message =
        (typeof parsed.message === 'string' && parsed.message) ||
        (typeof parsed.error_description === 'string' && parsed.error_description) ||
        message;
    } catch {
      // Keep Discord's raw response text when it is not JSON.
    }
    throw new DiscordApiError('Discord request failed', response.status, message);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

async function discordApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getRequiredDiscordConfig();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bot ${config.botToken}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  return readDiscordResponse<T>(response);
}

export async function exchangeDiscordOAuthCode(input: {
  code: string;
  redirectUri: string;
}): Promise<unknown> {
  const config = getRequiredDiscordConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  });

  const response = await fetch(`${DISCORD_API_BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  return readDiscordResponse<unknown>(response);
}

export async function getDiscordGuild(guildId: string): Promise<DiscordGuildSummary> {
  return discordApi<DiscordGuildSummary>(`/guilds/${encodeURIComponent(guildId)}`);
}

export async function listDiscordGuildChannels(guildId: string): Promise<DiscordChannelSummary[]> {
  const channels = await discordApi<DiscordChannelSummary[]>(
    `/guilds/${encodeURIComponent(guildId)}/channels`,
  );
  return channels.filter((channel) => channel.type === 0 || channel.type === 5);
}

export async function createDiscordScheduledEvent(
  guildId: string,
  payload: DiscordScheduledEventPayload,
): Promise<DiscordScheduledEventSummary> {
  return discordApi<DiscordScheduledEventSummary>(
    `/guilds/${encodeURIComponent(guildId)}/scheduled-events`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export async function updateDiscordScheduledEvent(
  guildId: string,
  eventId: string,
  payload: DiscordScheduledEventPayload,
): Promise<DiscordScheduledEventSummary> {
  return discordApi<DiscordScheduledEventSummary>(
    `/guilds/${encodeURIComponent(guildId)}/scheduled-events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteDiscordScheduledEvent(guildId: string, eventId: string): Promise<void> {
  await discordApi(
    `/guilds/${encodeURIComponent(guildId)}/scheduled-events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
    },
  );
}

export async function sendDiscordChannelMessage(
  channelId: string,
  input: { content: string },
): Promise<DiscordMessageSummary> {
  return discordApi<DiscordMessageSummary>(`/channels/${encodeURIComponent(channelId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function normalizeDiscordError(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `Discord request failed (${error.status}). ${error.responseText || error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
