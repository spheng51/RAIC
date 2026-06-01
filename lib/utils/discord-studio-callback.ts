export interface DiscordStudioCallbackFeedback {
  readonly messageKey: string;
  readonly toastKind: 'error' | 'success';
  readonly shouldRefreshConnection: true;
}

const DISCORD_STUDIO_CALLBACK_FEEDBACK: Record<string, DiscordStudioCallbackFeedback> = {
  connected: {
    messageKey: 'home.schedule.discord.connected',
    toastKind: 'success',
    shouldRefreshConnection: true,
  },
  error: {
    messageKey: 'home.schedule.discord.connectionFailed',
    toastKind: 'error',
    shouldRefreshConnection: true,
  },
  invalid_state: {
    messageKey: 'home.schedule.discord.invalidState',
    toastKind: 'error',
    shouldRefreshConnection: true,
  },
  missing_guild: {
    messageKey: 'home.schedule.discord.missingGuild',
    toastKind: 'error',
    shouldRefreshConnection: true,
  },
  not_configured: {
    messageKey: 'home.schedule.discord.notConfigured',
    toastKind: 'error',
    shouldRefreshConnection: true,
  },
};

export function getDiscordStudioCallbackFeedback(
  status: string | null,
): DiscordStudioCallbackFeedback | null {
  if (!status) {
    return null;
  }

  return DISCORD_STUDIO_CALLBACK_FEEDBACK[status] ?? DISCORD_STUDIO_CALLBACK_FEEDBACK.error;
}
