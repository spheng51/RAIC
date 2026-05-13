export type RoomVersion = number;

export type ClassroomRoomEventKind =
  | 'presentation.updated'
  | 'collaboration.updated'
  | 'control.updated'
  | 'live_meeting.updated'
  | 'mirofish.attached'
  | 'mirofish.session.updated'
  | 'game_session.updated';

export interface ClassroomRoomEventActor {
  sessionId: string | null;
  userId: string | null;
  role: string | null;
  kind: 'web' | 'classroom' | 'system';
}

export interface ClassroomRoomEvent {
  classroomId: string;
  roomVersion: RoomVersion;
  eventId: string;
  kind: ClassroomRoomEventKind;
  occurredAt: string;
  actor: ClassroomRoomEventActor;
  metadata?: Record<string, unknown>;
}
