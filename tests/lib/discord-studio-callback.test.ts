import { describe, expect, it } from 'vitest';
import { getDiscordStudioCallbackFeedback } from '@/lib/utils/discord-studio-callback';

describe('getDiscordStudioCallbackFeedback', () => {
  it('ignores missing Discord callback status', () => {
    expect(getDiscordStudioCallbackFeedback(null)).toBeNull();
  });

  it.each([
    ['connected', 'success', 'home.schedule.discord.connected'],
    ['invalid_state', 'error', 'home.schedule.discord.invalidState'],
    ['missing_guild', 'error', 'home.schedule.discord.missingGuild'],
    ['error', 'error', 'home.schedule.discord.connectionFailed'],
  ])(
    'maps %s to Studio feedback and refreshes the connection snapshot',
    (status, toastKind, key) => {
      expect(getDiscordStudioCallbackFeedback(status)).toEqual({
        messageKey: key,
        toastKind,
        shouldRefreshConnection: true,
      });
    },
  );

  it('treats unknown callback statuses as recoverable connection failures', () => {
    expect(getDiscordStudioCallbackFeedback('unexpected')).toEqual({
      messageKey: 'home.schedule.discord.connectionFailed',
      toastKind: 'error',
      shouldRefreshConnection: true,
    });
  });
});
