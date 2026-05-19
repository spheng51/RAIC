export type ScheduledClassMultiplayerGameMode = 'both' | 'leaderboard' | 'shared-control';
export type ScheduledClassMultiplayerLinkPolicy = 'always_open';

export interface ScheduledClassMultiplayerGame {
  enabled: boolean;
  mode: ScheduledClassMultiplayerGameMode;
  linkPolicy: ScheduledClassMultiplayerLinkPolicy;
  inviteExpiresAt?: string;
  joinTokenId?: string;
  inviteUrl?: string;
}

export interface ScheduledClassMultiplayerGameInput {
  enabled?: boolean;
  mode?: ScheduledClassMultiplayerGameMode;
  linkPolicy?: ScheduledClassMultiplayerLinkPolicy;
  inviteExpiresAt?: string | null;
  joinTokenId?: string | null;
  inviteUrl?: string | null;
}

export interface ScheduledClassDiscordSync {
  enabled: boolean;
  connectionId?: string;
  guildId?: string;
  guildName?: string;
  channelId?: string;
  channelName?: string;
  joinTokenId?: string;
  inviteUrl?: string;
  scheduledEventId?: string;
  scheduledEventUrl?: string;
  lastSyncedAt?: string;
  syncWarning?: string;
  reminderSentAt?: string;
  reminderMessageId?: string;
}

export interface ScheduledClassEvent {
  id: string;
  title: string;
  startsAt: string;
  durationMinutes?: number;
  classroomId?: string;
  multiplayerGame?: ScheduledClassMultiplayerGame;
  discordSync?: ScheduledClassDiscordSync;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledClassEventInput {
  title: string;
  startsAt: string;
  durationMinutes?: number | null;
  classroomId?: string | null;
  multiplayerGame?: ScheduledClassMultiplayerGameInput | null;
}

export interface ScheduledClassGenerationInput {
  title: string;
  startsAt: string;
  durationMinutes?: number;
  multiplayerGame?: ScheduledClassMultiplayerGameInput | null;
}

export interface DiscordConnectionSummary {
  id: string;
  guildId: string;
  guildName: string;
  channelId: string | null;
  channelName: string | null;
}

export interface DiscordChannelSummary {
  id: string;
  name: string;
}

export interface DiscordIntegrationSnapshot {
  configured: boolean;
  connection: DiscordConnectionSummary | null;
  channels: DiscordChannelSummary[];
}
