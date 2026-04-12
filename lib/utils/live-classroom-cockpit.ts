import type {
  ClassroomPresentationParticipant,
  ClassroomPresentationStatePayload,
} from '@/lib/types/classroom-presentation';
import type { PresentationSurface } from '@/lib/types/stage';

export interface LiveClassroomApprovalItem {
  id: string;
  type: 'scene' | 'surface' | 'teacher_prompt' | 'whiteboard';
  summary: string;
  preview: string;
  targetSurface?: PresentationSurface;
  action:
    | {
        kind: 'set-surface';
        surface: PresentationSurface;
      }
    | {
        kind: 'next-scene';
      }
    | {
        kind: 'replay-scene';
      }
    | {
        kind: 'teacher-prompt';
        prompt: string;
      }
    | {
        kind: 'toggle-whiteboard';
        open: boolean;
      };
}

interface BuildLiveClassroomApprovalItemsInput {
  readonly currentSceneId?: string | null;
  readonly currentSceneTitle?: string | null;
  readonly activeSurface: PresentationSurface;
  readonly whiteboardOpen: boolean;
  readonly reportAvailable: boolean;
  readonly playbackCompleted: boolean;
  readonly hasNextScene: boolean;
  readonly hasSharedSimulation: boolean;
}

export interface LiveClassroomStudentPulse {
  studentCount: number;
  teacherCount: number;
  activeStudents: ClassroomPresentationParticipant[];
  controllerCount: number;
}

export function canShowLiveClassroomCockpit(
  state: Pick<ClassroomPresentationStatePayload, 'viewerKind' | 'viewerRole'> | null | undefined,
) {
  return Boolean(state && state.viewerKind === 'web' && state.viewerRole !== 'student');
}

export function getLiveClassroomSurfaceLabel(
  surface: PresentationSurface,
  whiteboardOpen: boolean,
) {
  if (surface === 'lesson' && whiteboardOpen) {
    return 'Whiteboard';
  }

  if (surface === 'simulation') {
    return 'Simulation';
  }

  if (surface === 'report') {
    return 'Report';
  }

  return 'Lesson';
}

export function buildLiveClassroomStudentPulse(
  participants: ClassroomPresentationParticipant[],
): LiveClassroomStudentPulse {
  const activeStudents = participants.filter((participant) => participant.role === 'student');
  const teacherCount = participants.filter((participant) => participant.role !== 'student').length;

  return {
    studentCount: activeStudents.length,
    teacherCount,
    activeStudents,
    controllerCount: activeStudents.filter((participant) => participant.isController).length,
  };
}

export function buildLiveClassroomApprovalItems({
  currentSceneId,
  currentSceneTitle,
  activeSurface,
  whiteboardOpen,
  reportAvailable,
  playbackCompleted,
  hasNextScene,
  hasSharedSimulation,
}: BuildLiveClassroomApprovalItemsInput): LiveClassroomApprovalItem[] {
  const sceneLabel = currentSceneTitle?.trim() || 'the current scene';
  const sceneKey = currentSceneId || 'current-scene';
  const approvals: LiveClassroomApprovalItem[] = [];

  if (activeSurface !== 'lesson') {
    approvals.push({
      id: `surface-recover-${activeSurface}`,
      type: 'surface',
      summary: 'Return the class to the lesson',
      preview: 'Bring everyone back to the primary lesson surface before continuing.',
      targetSurface: 'lesson',
      action: {
        kind: 'set-surface',
        surface: 'lesson',
      },
    });
  }

  if (hasSharedSimulation && activeSurface === 'lesson') {
    approvals.push({
      id: 'surface-open-simulation',
      type: 'surface',
      summary: 'Open the live simulation',
      preview: 'Switch the shared classroom surface from the lesson into the simulation.',
      targetSurface: 'simulation',
      action: {
        kind: 'set-surface',
        surface: 'simulation',
      },
    });
  }

  if (reportAvailable && activeSurface !== 'report') {
    approvals.push({
      id: 'surface-open-report',
      type: 'surface',
      summary: 'Show the simulation report',
      preview: 'Open the report pane so the class can review the current simulation outcome.',
      targetSurface: 'report',
      action: {
        kind: 'set-surface',
        surface: 'report',
      },
    });
  }

  if (activeSurface === 'lesson' && !whiteboardOpen) {
    approvals.push({
      id: `whiteboard-open-${sceneKey}`,
      type: 'whiteboard',
      summary: 'Open the whiteboard for emphasis',
      preview: 'Bring the whiteboard forward to annotate or reinforce the current explanation.',
      action: {
        kind: 'toggle-whiteboard',
        open: true,
      },
    });
  }

  approvals.push({
    id: `prompt-recap-${sceneKey}`,
    type: 'teacher_prompt',
    summary: 'Ask for a quick recap',
    preview: `Have the AI teacher restate ${sceneLabel} in simpler language and end with one check-for-understanding question.`,
    action: {
      kind: 'teacher-prompt',
      prompt: `Give the class a quick recap of ${sceneLabel} in simpler language. Keep it concise, make it teacher-friendly, and end with one quick check-for-understanding question.`,
    },
  });

  if (playbackCompleted) {
    approvals.push({
      id: `scene-replay-${sceneKey}`,
      type: 'scene',
      summary: 'Replay the current scene',
      preview: 'Restart the scene from the beginning so the teacher can reinforce the explanation.',
      action: {
        kind: 'replay-scene',
      },
    });
  }

  if (playbackCompleted && hasNextScene) {
    approvals.unshift({
      id: `scene-next-${sceneKey}`,
      type: 'scene',
      summary: 'Advance to the next scene',
      preview: 'Move the class forward now that the current scene has finished.',
      action: {
        kind: 'next-scene',
      },
    });
  }

  return approvals;
}
