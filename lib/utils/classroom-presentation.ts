import type { ClassroomPresentationParticipant } from '@/lib/types/classroom-presentation';
import type { PresentationSurface, SharedSimulation, Stage } from '@/lib/types/stage';

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
    'Open the classroom in OpenMAIC to access the live lesson, simulation, or report pane.',
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
