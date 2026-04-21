import type {
  PresentationSurface,
  SharedSimulation,
  SharedSimulationStatus,
} from '@/lib/types/stage';
import type { RoomVersion } from '@/lib/types/live-classroom';

export type ClassroomPresentationRole = 'teacher' | 'student' | 'org_admin' | 'system_admin';
export type ClassroomPresentationViewerKind = 'web' | 'classroom';

export interface ClassroomPresentationParticipant {
  sessionId: string;
  userId: string;
  displayName: string;
  role: ClassroomPresentationRole;
  lastSeenAt: string;
  isController: boolean;
}

export interface ClassroomPresentationStatePayload {
  roomVersion?: RoomVersion;
  activeSurface: PresentationSurface;
  controllerSessionId: string | null;
  controllerRole: 'teacher' | 'student';
  controlLeaseExpiresAt: string | null;
  simulationStatus: SharedSimulationStatus | null;
  reportAvailable: boolean;
  sharedSimulation: SharedSimulation | null;
  runUrl: string | null;
  reportUrl: string | null;
  viewerSessionId: string;
  viewerRole: ClassroomPresentationRole;
  viewerKind: ClassroomPresentationViewerKind;
  viewerCanManageSimulation: boolean;
  viewerCanControlPresentation: boolean;
  viewerHasSimulationControl: boolean;
  participants: ClassroomPresentationParticipant[];
}
