import type { RoomVersion } from '@/lib/types/live-classroom';

export type ClassroomGameSessionMode = 'both' | 'leaderboard' | 'shared-control';
export type ClassroomGameSessionStatus = 'idle' | 'live' | 'paused' | 'completed';

export type ClassroomGameTeacherAction =
  | 'start_round'
  | 'pause'
  | 'resume'
  | 'reset'
  | 'complete'
  | 'set_mode'
  | 'assign_controller'
  | 'clear_controller';

export type ClassroomGameStudentEventType =
  | 'ready'
  | 'progress'
  | 'score'
  | 'complete'
  | 'shared_state'
  | 'control_input'
  | 'bridge_ready';

export interface ClassroomGameSessionPlayer {
  sessionId: string;
  userId: string;
  displayName: string;
  role: string;
  active?: boolean;
  ready: boolean;
  score: number;
  progress: number;
  completed: boolean;
  bridgeReady: boolean;
  lastEventAt: string;
  lastSeenAt: string;
}

export interface ClassroomGameSessionState {
  classroomId: string;
  roundId: string | null;
  roundNumber: number;
  mode: ClassroomGameSessionMode;
  status: ClassroomGameSessionStatus;
  controllerSessionId: string | null;
  latestSharedState: Record<string, unknown> | null;
  players: Record<string, ClassroomGameSessionPlayer>;
  createdAt: string;
  updatedAt: string;
}

export interface ClassroomGameSessionPayload extends ClassroomGameSessionState {
  roomVersion?: RoomVersion;
  participantCount: number;
  participants: ClassroomGameSessionPlayer[];
  leaderboard: ClassroomGameSessionPlayer[];
  viewerSessionId: string;
  viewerRole: string;
  viewerKind: 'web' | 'classroom';
  viewerCanManage: boolean;
  viewerCanSubmit: boolean;
  viewerIsController: boolean;
  multiplayerSupported: boolean;
}
