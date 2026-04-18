import type {
  ClassroomPresentationParticipant,
  ClassroomPresentationRole,
  ClassroomPresentationStatePayload,
  ClassroomPresentationViewerKind,
} from '@/lib/types/classroom-presentation';
import type {
  PresentationSurface,
  SharedSimulation,
  SharedSimulationCollaborationMode,
  SharedSimulationCollaborationState,
  Stage,
} from '@/lib/types/stage';

export function hasAttachedSharedSimulation(
  sharedSimulation: SharedSimulation | null | undefined,
): sharedSimulation is SharedSimulation {
  return Boolean(
    sharedSimulation?.provider === 'mirofish' &&
    sharedSimulation.simulationId &&
    sharedSimulation.runUrl,
  );
}

export function getStageSharedSimulation(
  stage: Pick<Stage, 'sharedSimulation'> | null | undefined,
): SharedSimulation | null {
  const sharedSimulation = stage?.sharedSimulation;
  return hasAttachedSharedSimulation(sharedSimulation) ? sharedSimulation : null;
}

export function hasSharedSimulationReport(
  sharedSimulation: SharedSimulation | null | undefined,
): boolean {
  return Boolean(sharedSimulation?.reportId && sharedSimulation?.reportUrl);
}

export function getActivePresentationSurface(
  sharedSimulation: SharedSimulation | null | undefined,
): PresentationSurface {
  return sharedSimulation?.activeSurface ?? 'lesson';
}

export function getSharedSimulationCollaborationMode(
  sharedSimulation: SharedSimulation | null | undefined,
): SharedSimulationCollaborationMode {
  return sharedSimulation?.collaborationMode === 'multi-user' ? 'multi-user' : 'single-controller';
}

export function isMultiUserSharedSimulation(
  sharedSimulation: SharedSimulation | null | undefined,
): boolean {
  return getSharedSimulationCollaborationMode(sharedSimulation) === 'multi-user';
}

export function getSharedSimulationCollaborationState(
  sharedSimulation: SharedSimulation | null | undefined,
): SharedSimulationCollaborationState {
  return sharedSimulation?.collaborationState ?? 'inactive';
}

export function getSharedSimulationRemovedSessionIds(
  sharedSimulation: SharedSimulation | null | undefined,
): string[] {
  return Array.from(
    new Set((sharedSimulation?.removedParticipantSessionIds ?? []).filter((value) => value.trim())),
  );
}

export function resetSharedSimulationControl(sharedSimulation: SharedSimulation): SharedSimulation {
  return {
    ...sharedSimulation,
    controllerSessionId: undefined,
    controllerRole: 'teacher',
    controlLeaseExpiresAt: undefined,
  };
}

export function hasStudentControlLease(
  sharedSimulation: SharedSimulation | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (isMultiUserSharedSimulation(sharedSimulation)) {
    return false;
  }

  if (!sharedSimulation || sharedSimulation.controllerRole !== 'student') {
    return false;
  }

  if (!sharedSimulation.controllerSessionId || !sharedSimulation.controlLeaseExpiresAt) {
    return false;
  }

  const leaseExpiry = new Date(sharedSimulation.controlLeaseExpiresAt).getTime();
  return !Number.isNaN(leaseExpiry) && leaseExpiry > nowMs;
}

export function normalizeSharedSimulationControl(
  sharedSimulation: SharedSimulation | null | undefined,
  activeSessionIds: Iterable<string>,
  nowMs = Date.now(),
): SharedSimulation | null {
  if (!sharedSimulation) {
    return null;
  }

  if (isMultiUserSharedSimulation(sharedSimulation)) {
    return sharedSimulation;
  }

  if (sharedSimulation.controllerRole !== 'student') {
    return sharedSimulation;
  }

  const sessionIds = new Set(activeSessionIds);
  if (
    !hasStudentControlLease(sharedSimulation, nowMs) ||
    !sharedSimulation.controllerSessionId ||
    !sessionIds.has(sharedSimulation.controllerSessionId)
  ) {
    return resetSharedSimulationControl(sharedSimulation);
  }

  return sharedSimulation;
}

export function normalizeSharedSimulationState(
  sharedSimulation: SharedSimulation | null | undefined,
  activeSessionIds: Iterable<string>,
  nowMs = Date.now(),
): SharedSimulation | null {
  if (!sharedSimulation) {
    return null;
  }

  if (!isMultiUserSharedSimulation(sharedSimulation)) {
    return normalizeSharedSimulationControl(sharedSimulation, activeSessionIds, nowMs);
  }

  const sessionIds = new Set(activeSessionIds);
  const removedParticipantSessionIds = getSharedSimulationRemovedSessionIds(
    sharedSimulation,
  ).filter((sessionId) => sessionIds.has(sessionId));
  const spotlightSessionId =
    sharedSimulation.spotlightSessionId &&
    sessionIds.has(sharedSimulation.spotlightSessionId) &&
    !removedParticipantSessionIds.includes(sharedSimulation.spotlightSessionId)
      ? sharedSimulation.spotlightSessionId
      : undefined;

  const changed =
    spotlightSessionId !== sharedSimulation.spotlightSessionId ||
    removedParticipantSessionIds.length !==
      getSharedSimulationRemovedSessionIds(sharedSimulation).length;

  if (!changed) {
    return sharedSimulation;
  }

  return {
    ...sharedSimulation,
    spotlightSessionId,
    removedParticipantSessionIds:
      removedParticipantSessionIds.length > 0 ? removedParticipantSessionIds : undefined,
  };
}

export function preserveStageSharedSimulation(
  stage: Stage,
  sharedSimulation: SharedSimulation | null | undefined,
): Stage {
  if (!sharedSimulation) {
    if (!stage.sharedSimulation) {
      return stage;
    }

    const { sharedSimulation: _removed, ...stageWithoutSharedSimulation } = stage;
    return stageWithoutSharedSimulation;
  }

  if (stage.sharedSimulation === sharedSimulation) {
    return stage;
  }

  return {
    ...stage,
    sharedSimulation,
  };
}

function canViewerControlPresentation(
  sharedSimulation: SharedSimulation | null | undefined,
  viewer: {
    id: string;
    kind: ClassroomPresentationViewerKind;
    role: ClassroomPresentationRole;
  },
): boolean {
  if (getSharedSimulationCollaborationMode(sharedSimulation) === 'multi-user') {
    return viewer.kind === 'web' && viewer.role !== 'student';
  }

  if (viewer.kind === 'web' && viewer.role !== 'student') {
    return true;
  }

  return (
    !!sharedSimulation &&
    hasStudentControlLease(sharedSimulation) &&
    sharedSimulation.controllerSessionId === viewer.id
  );
}

function doesViewerOwnSimulationControl(
  sharedSimulation: SharedSimulation | null | undefined,
  viewer: {
    id: string;
    kind: ClassroomPresentationViewerKind;
    role: ClassroomPresentationRole;
  },
): boolean {
  return canSessionInteractWithSharedSimulation(sharedSimulation, viewer);
}

export function mergePresentationStateSharedSimulation(
  previousState: ClassroomPresentationStatePayload,
  nextSharedSimulation: SharedSimulation,
): ClassroomPresentationStatePayload {
  const preservedRunUrl =
    previousState.sharedSimulation?.runUrl ?? previousState.runUrl ?? nextSharedSimulation.runUrl;
  const preservedReportUrl =
    previousState.sharedSimulation?.reportUrl ??
    previousState.reportUrl ??
    nextSharedSimulation.reportUrl ??
    null;
  const mergedSharedSimulation: SharedSimulation = {
    ...nextSharedSimulation,
    runUrl: preservedRunUrl,
    reportUrl: preservedReportUrl ?? undefined,
  };
  const viewer = {
    id: previousState.viewerSessionId,
    kind: previousState.viewerKind,
    role: previousState.viewerRole,
  };

  return {
    ...previousState,
    activeSurface: mergedSharedSimulation.activeSurface,
    controllerSessionId: mergedSharedSimulation.controllerSessionId ?? null,
    controllerRole: mergedSharedSimulation.controllerRole,
    controlLeaseExpiresAt: mergedSharedSimulation.controlLeaseExpiresAt ?? null,
    simulationStatus: mergedSharedSimulation.status,
    reportAvailable: hasSharedSimulationReport(mergedSharedSimulation),
    sharedSimulation: mergedSharedSimulation,
    runUrl: preservedRunUrl,
    reportUrl: preservedReportUrl,
    viewerCanControlPresentation: canViewerControlPresentation(mergedSharedSimulation, viewer),
    viewerHasSimulationControl: doesViewerOwnSimulationControl(mergedSharedSimulation, viewer),
  };
}

export function getSharedSimulationFingerprint(
  sharedSimulation: SharedSimulation | null | undefined,
) {
  if (!sharedSimulation) {
    return null;
  }

  return {
    provider: sharedSimulation.provider,
    simulationId: sharedSimulation.simulationId,
    reportId: sharedSimulation.reportId ?? null,
    activeSurface: sharedSimulation.activeSurface,
    controllerSessionId: sharedSimulation.controllerSessionId ?? null,
    controllerRole: sharedSimulation.controllerRole,
    controlLeaseExpiresAt: sharedSimulation.controlLeaseExpiresAt ?? null,
    status: sharedSimulation.status,
    runUrl: sharedSimulation.runUrl,
    reportUrl: sharedSimulation.reportUrl ?? null,
  };
}

export function buildMiroFishExportNotice(
  sharedSimulation: SharedSimulation | null | undefined,
): string | null {
  if (!hasAttachedSharedSimulation(sharedSimulation)) {
    return null;
  }

  const lines = [
    'This classroom has an attached MiroFish simulation.',
    'MiroFish remains a classroom-side experience and is not embedded in this export.',
    `Simulation ID: ${sharedSimulation.simulationId}`,
  ];

  if (sharedSimulation.reportId) {
    lines.push(`Report ID: ${sharedSimulation.reportId}`);
  }

  lines.push(
    'Open the classroom in Open-RAIC to access the live lesson, simulation, or report pane.',
  );

  return lines.join('\n');
}

export function getControllerDisplayName(
  sharedSimulation: SharedSimulation | null | undefined,
  participants: ClassroomPresentationParticipant[],
) {
  if (!sharedSimulation || sharedSimulation.controllerRole === 'teacher') {
    return 'Teacher';
  }

  return (
    participants.find(
      (participant) => participant.sessionId === sharedSimulation.controllerSessionId,
    )?.displayName || 'Student controller'
  );
}

export function canSessionInteractWithSharedSimulation(
  sharedSimulation: SharedSimulation | null | undefined,
  session: Pick<{ id: string; kind: 'web' | 'classroom'; role: string }, 'id' | 'kind' | 'role'>,
): boolean {
  if (!sharedSimulation) {
    return false;
  }

  if (!isMultiUserSharedSimulation(sharedSimulation)) {
    if (sharedSimulation.controllerRole === 'teacher') {
      return session.kind === 'web' && session.role !== 'student';
    }

    return (
      hasStudentControlLease(sharedSimulation) &&
      sharedSimulation.controllerSessionId === session.id
    );
  }

  const isTeacherViewer = session.kind === 'web' && session.role !== 'student';
  const collaborationState = getSharedSimulationCollaborationState(sharedSimulation);

  if (isTeacherViewer) {
    return collaborationState !== 'closed';
  }

  if (session.kind !== 'classroom' || session.role !== 'student') {
    return false;
  }

  if (getSharedSimulationRemovedSessionIds(sharedSimulation).includes(session.id)) {
    return false;
  }

  if (collaborationState !== 'live') {
    return false;
  }

  return sharedSimulation.allowStudentInteraction !== false;
}

export function getSharedSimulationInteractionReason(
  sharedSimulation: SharedSimulation | null | undefined,
  session: Pick<{ id: string; kind: 'web' | 'classroom'; role: string }, 'id' | 'kind' | 'role'>,
) {
  if (!sharedSimulation || !isMultiUserSharedSimulation(sharedSimulation)) {
    return null;
  }

  const isTeacherViewer = session.kind === 'web' && session.role !== 'student';
  if (isTeacherViewer) {
    return getSharedSimulationCollaborationState(sharedSimulation) === 'closed' ? 'closed' : null;
  }

  if (getSharedSimulationRemovedSessionIds(sharedSimulation).includes(session.id)) {
    return 'removed' as const;
  }

  switch (getSharedSimulationCollaborationState(sharedSimulation)) {
    case 'frozen':
      return 'frozen' as const;
    case 'closed':
      return 'closed' as const;
    case 'inactive':
    case 'error':
      return 'inactive' as const;
    default:
      return sharedSimulation.allowStudentInteraction === false ? ('frozen' as const) : null;
  }
}

export function formatLeaseCountdown(
  expiresAt: string | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (!expiresAt) {
    return null;
  }

  const remainingMs = new Date(expiresAt).getTime() - nowMs;
  if (Number.isNaN(remainingMs)) {
    return null;
  }

  if (remainingMs <= 0) {
    return 'Expired';
  }

  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s remaining`;
  }

  return `${seconds}s remaining`;
}
