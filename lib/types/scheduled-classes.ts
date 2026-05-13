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

export interface ScheduledClassEvent {
  id: string;
  title: string;
  startsAt: string;
  durationMinutes?: number;
  classroomId?: string;
  multiplayerGame?: ScheduledClassMultiplayerGame;
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
