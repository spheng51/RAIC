import type {
  ClassroomPresentationRole,
  ClassroomPresentationViewerKind,
} from '@/lib/types/classroom-presentation';
import type {
  SharedSimulationCollaborationMode,
  SharedSimulationCollaborationState,
} from '@/lib/types/stage';
import type { RoomVersion } from '@/lib/types/live-classroom';

export type ClassroomCollaborationAction =
  | 'freeze'
  | 'unfreeze'
  | 'open'
  | 'close'
  | 'reset_session'
  | 'spotlight'
  | 'clear_spotlight'
  | 'remove_participant';

export type ClassroomCollaborationInteractionReason =
  | 'inactive'
  | 'frozen'
  | 'closed'
  | 'removed'
  | null;

export interface ClassroomCollaborationParticipant {
  sessionId: string;
  userId: string;
  displayName: string;
  role: ClassroomPresentationRole;
  lastSeenAt: string;
  isRemoved: boolean;
  isSpotlighted: boolean;
  canInteract: boolean;
}

export interface ClassroomCollaborationStatePayload {
  roomVersion?: RoomVersion;
  collaborationMode: SharedSimulationCollaborationMode;
  collaborationState: SharedSimulationCollaborationState;
  allowStudentInteraction: boolean;
  spotlightSessionId: string | null;
  participantCount: number;
  participants: ClassroomCollaborationParticipant[];
  mirofishSessionId: string | null;
  lastCollaborationSyncAt: string | null;
  viewerSessionId: string;
  viewerRole: ClassroomPresentationRole;
  viewerKind: ClassroomPresentationViewerKind;
  viewerCanModerateCollaboration: boolean;
  viewerCanInteract: boolean;
  viewerIsRemoved: boolean;
  viewerInteractionReason: ClassroomCollaborationInteractionReason;
  multiUserEnabled: boolean;
}
